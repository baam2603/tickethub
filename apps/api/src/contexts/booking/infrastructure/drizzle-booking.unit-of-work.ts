import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { OrderStatus, OutboxStatus, SeatStatus } from "@tickethub/shared";
import { db } from "../../../database/db";
import {
  events,
  orderItems,
  orders,
  outbox,
  seats,
  ticketTypes,
} from "../../../database/schema";
import type {
  CandidateSeat,
  ExpirySweepResult,
  LockedExplicitSeat,
  NewPendingOrder,
  OrderItemDraft,
  StandingInventory,
} from "../domain/booking.models";
import type {
  BookingTransaction,
  BookingUnitOfWork,
} from "../domain/booking.ports";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Ghe con trong, hoac dang giu nhung da qua han giu. */
const isTakeable = (now: Date) =>
  or(
    eq(seats.status, SeatStatus.AVAILABLE),
    and(eq(seats.status, SeatStatus.HELD), lt(seats.holdExpiresAt, now)),
  );

const releasedSeatValues = (now: Date) => ({
  status: SeatStatus.AVAILABLE,
  holdOrderId: null,
  holdExpiresAt: null,
  version: sql`${seats.version} + 1`,
  updatedAt: now,
});

const candidateColumns = {
  id: seats.id,
  zoneName: seats.zoneName,
  rowLabel: seats.rowLabel,
  seatNumber: seats.seatNumber,
  ticketTypeId: seats.ticketTypeId,
};

class DrizzleBookingTransaction implements BookingTransaction {
  constructor(private readonly tx: DbTx) {}

  async lockEventForBooking(eventId: string) {
    const [event] = await this.tx
      .select({ status: events.status })
      .from(events)
      .where(eq(events.id, eventId))
      .for("share");
    return event ?? null;
  }

  lockSeatsById(
    eventId: string,
    sortedIds: string[],
  ): Promise<LockedExplicitSeat[]> {
    return this.tx
      .select({ ...candidateColumns, status: seats.status })
      .from(seats)
      .where(and(inArray(seats.id, sortedIds), eq(seats.eventId, eventId)))
      .orderBy(asc(seats.id))
      .for("update");
  }

  async holdAvailableSeats(
    eventId: string,
    ids: string[],
    now: Date,
    expiresAt: Date,
  ) {
    const updated = await this.tx
      .update(seats)
      .set({
        status: SeatStatus.HELD,
        holdExpiresAt: expiresAt,
        version: sql`${seats.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          inArray(seats.id, ids),
          eq(seats.eventId, eventId),
          isTakeable(now),
        ),
      )
      .returning({ id: seats.id });
    return updated.map((s) => s.id);
  }

  listAvailableSeats(
    eventId: string,
    ticketTypeId: string,
    now: Date,
  ): Promise<CandidateSeat[]> {
    return this.tx
      .select(candidateColumns)
      .from(seats)
      .where(
        and(
          eq(seats.eventId, eventId),
          eq(seats.ticketTypeId, ticketTypeId),
          isTakeable(now),
        ),
      )
      .orderBy(asc(seats.rowLabel), asc(seats.seatNumber));
  }

  lockAvailableSeatsSkipLocked(
    eventId: string,
    ids: string[],
    now: Date,
  ): Promise<CandidateSeat[]> {
    return this.tx
      .select(candidateColumns)
      .from(seats)
      .where(
        and(
          inArray(seats.id, ids),
          eq(seats.eventId, eventId),
          isTakeable(now),
        ),
      )
      .orderBy(asc(seats.id))
      .for("update", { skipLocked: true });
  }

  async markSeatsHeld(ids: string[], now: Date, expiresAt: Date) {
    await this.tx
      .update(seats)
      .set({
        status: SeatStatus.HELD,
        holdExpiresAt: expiresAt,
        version: sql`${seats.version} + 1`,
        updatedAt: now,
      })
      .where(inArray(seats.id, ids));
  }

  async lockStandingTicketType(
    eventId: string,
    ticketTypeId: string,
  ): Promise<StandingInventory | null> {
    const [row] = await this.tx
      .select({
        id: ticketTypes.id,
        capacity: ticketTypes.capacity,
        heldCount: ticketTypes.heldCount,
        soldCount: ticketTypes.soldCount,
        isSeated: ticketTypes.isSeated,
      })
      .from(ticketTypes)
      .where(
        and(eq(ticketTypes.id, ticketTypeId), eq(ticketTypes.eventId, eventId)),
      )
      .for("update");
    return row ?? null;
  }

  async incrementHeldCount(ticketTypeId: string, qty: number, now: Date) {
    await this.tx
      .update(ticketTypes)
      .set({
        heldCount: sql`${ticketTypes.heldCount} + ${qty}`,
        updatedAt: now,
      })
      .where(eq(ticketTypes.id, ticketTypeId));
  }

  async insertPendingOrder(order: NewPendingOrder) {
    const [created] = await this.tx
      .insert(orders)
      .values({
        orderCode: order.orderCode,
        userId: order.userId,
        eventId: order.eventId,
        totalAmount: order.totalAmount,
        discountAmount: "0.00",
        finalAmount: order.totalAmount,
        status: OrderStatus.PENDING,
        expiresAt: order.expiresAt,
      })
      .returning();
    if (!created) throw new Error("Không thể tạo bản ghi đơn hàng");
    return { id: created.id, orderCode: created.orderCode };
  }

  async assignHoldOrder(seatIds: string[], orderId: string) {
    await this.tx
      .update(seats)
      .set({ holdOrderId: orderId })
      .where(inArray(seats.id, seatIds));
  }

  async insertOrderItems(orderId: string, items: OrderItemDraft[]) {
    await this.tx.insert(orderItems).values(
      items.map((i) => ({
        orderId,
        ticketTypeId: i.ticketTypeId,
        seatId: i.seatId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        subtotal: i.subtotal,
      })),
    );
  }

  async enqueueOutbox(eventType: string, payload: Record<string, unknown>) {
    await this.tx
      .insert(outbox)
      .values({ eventType, payload, status: OutboxStatus.PENDING });
  }

  async cancelPendingOrder(orderId: string, userId: string) {
    const updated = await this.tx
      .update(orders)
      .set({ status: OrderStatus.CANCELLED, updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.userId, userId),
          eq(orders.status, OrderStatus.PENDING),
        ),
      )
      .returning({ id: orders.id });
    return updated.length === 1;
  }

  async releaseSeatsOfOrder(orderId: string, now: Date) {
    await this.tx
      .update(seats)
      .set(releasedSeatValues(now))
      .where(eq(seats.holdOrderId, orderId));
  }

  async decrementHeldCount(ticketTypeId: string, qty: number, now: Date) {
    await this.tx
      .update(ticketTypes)
      .set({
        heldCount: sql`GREATEST(0, ${ticketTypes.heldCount} - ${qty})`,
        updatedAt: now,
      })
      .where(eq(ticketTypes.id, ticketTypeId));
  }

  async sweepExpired(now: Date): Promise<ExpirySweepResult> {
    const expiredOrders = await this.tx
      .select({ id: orders.id, eventId: orders.eventId })
      .from(orders)
      .where(
        and(eq(orders.status, OrderStatus.PENDING), lt(orders.expiresAt, now)),
      )
      .for("update");

    const expiredSeatEvents = await this.tx
      .selectDistinct({ eventId: seats.eventId })
      .from(seats)
      .where(
        and(eq(seats.status, SeatStatus.HELD), lt(seats.holdExpiresAt, now)),
      );

    const affectedEventIds = Array.from(
      new Set([
        ...expiredOrders.map((o) => o.eventId),
        ...expiredSeatEvents.map((s) => s.eventId),
      ]),
    );

    const staleHeld = and(
      eq(seats.status, SeatStatus.HELD),
      lt(seats.holdExpiresAt, now),
    );

    // Van don cac ghe HELD qua han du khong co don hang nao het han
    if (expiredOrders.length === 0) {
      const releasedSeatRecords = await this.tx
        .update(seats)
        .set(releasedSeatValues(now))
        .where(staleHeld)
        .returning({ id: seats.id, eventId: seats.eventId });
      return { expiredOrdersCount: 0, affectedEventIds, releasedSeatRecords };
    }

    const expiredOrderIds = expiredOrders.map((o) => o.id);

    await this.tx
      .update(orders)
      .set({ status: OrderStatus.EXPIRED, updatedAt: now })
      .where(inArray(orders.id, expiredOrderIds));

    const releasedSeatRecords = await this.tx
      .update(seats)
      .set(releasedSeatValues(now))
      .where(or(inArray(seats.holdOrderId, expiredOrderIds), staleHeld))
      .returning({ id: seats.id, eventId: seats.eventId });

    const standingItems = await this.tx
      .select({
        ticketTypeId: orderItems.ticketTypeId,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(
        and(
          inArray(orderItems.orderId, expiredOrderIds),
          sql`${orderItems.seatId} IS NULL`,
        ),
      );
    for (const item of standingItems) {
      await this.decrementHeldCount(item.ticketTypeId, item.quantity, now);
    }

    return {
      expiredOrdersCount: expiredOrderIds.length,
      affectedEventIds,
      releasedSeatRecords,
    };
  }
}

export class DrizzleBookingUnitOfWork implements BookingUnitOfWork {
  run<T>(work: (tx: BookingTransaction) => Promise<T>): Promise<T> {
    return db.transaction((tx) => work(new DrizzleBookingTransaction(tx)));
  }
}
