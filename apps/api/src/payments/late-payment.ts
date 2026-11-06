import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  EventStatus,
  OrderStatus,
  OutboxStatus,
  RefundStatus,
  SeatStatus,
  TicketStatus,
  TransactionStatus,
} from "@tickethub/shared";
import { db } from "../database/db";
import {
  events,
  orderItems,
  orders,
  outbox,
  refunds,
  seats,
  tickets,
  ticketTypes,
  transactions,
} from "../database/schema";
import { parseVnpayDate } from "./vnpay-api";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class ReservationLost extends Error {}

export async function settleLatePayment(
  tx: Tx,
  order: typeof orders.$inferSelect,
  payment: typeof transactions.$inferSelect,
  params: Record<string, string>,
) {
  const now = new Date();
  const items = await tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  if (
    !items.length ||
    items.some((i) => i.quantity < 1 || (i.seatId && i.quantity !== 1))
  )
    return "MANUAL_REVIEW" as const;
  const seatIds = items.flatMap((i) => (i.seatId ? [i.seatId] : []));
  if (new Set(seatIds).size !== seatIds.length) return "MANUAL_REVIEW" as const;
  // Savepoint: neu mot hang ve khong du kho, rollback TOAN BO phan kho truoc khi tao refund.
  let restored = false;
  try {
    await tx.transaction(async (stock) => {
      const [event] = await stock
        .select()
        .from(events)
        .where(eq(events.id, order.eventId));
      if (
        order.status === OrderStatus.CANCELLED ||
        event?.status !== EventStatus.PUBLISHED
      )
        throw new ReservationLost();
      if (seatIds.length)
        await stock
          .select()
          .from(seats)
          .where(inArray(seats.id, seatIds))
          .orderBy(asc(seats.id))
          .for("update");
      for (const item of [...items].sort((a, b) =>
        a.ticketTypeId.localeCompare(b.ticketTypeId),
      )) {
        if (item.seatId) {
          const updated = await stock
            .update(seats)
            .set({
              status: SeatStatus.SOLD,
              holdOrderId: null,
              holdExpiresAt: null,
              updatedAt: now,
              version: sql`${seats.version} + 1`,
            })
            .where(
              and(
                eq(seats.id, item.seatId),
                eq(seats.eventId, order.eventId),
                eq(seats.ticketTypeId, item.ticketTypeId),
                or(
                  eq(seats.status, SeatStatus.AVAILABLE),
                  and(
                    eq(seats.status, SeatStatus.HELD),
                    eq(seats.holdOrderId, order.id),
                  ),
                ),
              ),
            )
            .returning();
          if (updated.length !== 1) throw new ReservationLost();
        } else {
          const held = order.status === OrderStatus.PENDING ? item.quantity : 0;
          const updated = await stock
            .update(ticketTypes)
            .set({
              soldCount: sql`${ticketTypes.soldCount} + ${item.quantity}`,
              heldCount: sql`${ticketTypes.heldCount} - ${held}`,
              updatedAt: now,
            })
            .where(
              and(
                eq(ticketTypes.id, item.ticketTypeId),
                eq(ticketTypes.eventId, order.eventId),
                eq(ticketTypes.isSeated, false),
                gte(ticketTypes.heldCount, held),
                sql`${ticketTypes.capacity} - ${ticketTypes.soldCount} - ${ticketTypes.heldCount} + ${held} >= ${item.quantity}`,
              ),
            )
            .returning();
          if (updated.length !== 1) throw new ReservationLost();
        }
      }
    });
    restored = true;
  } catch (error) {
    if (!(error instanceof ReservationLost)) throw error;
  }

  await tx
    .update(transactions)
    .set({
      status: TransactionStatus.SUCCESS,
      providerTxNumber: params.vnp_TransactionNo!,
      payDate: parseVnpayDate(params.vnp_PayDate),
      responseCode: "00",
      rawCallback: params,
      updatedAt: now,
    })
    .where(eq(transactions.id, payment.id));
  if (restored) {
    const issued = await tx
      .insert(tickets)
      .values(
        items.flatMap((item) =>
          Array.from({ length: item.quantity }, () => ({
            ticketCode: `TK${randomBytes(15).toString("hex").toUpperCase()}`,
            orderId: order.id,
            userId: order.userId,
            eventId: order.eventId,
            ticketTypeId: item.ticketTypeId,
            seatId: item.seatId,
            status: TicketStatus.SOLD,
          })),
        ),
      )
      .returning();
    await tx
      .update(orders)
      .set({ status: OrderStatus.PAID, paidAt: now, updatedAt: now })
      .where(eq(orders.id, order.id));
    await tx.insert(outbox).values({
      eventType: "ORDER_PAID",
      payload: {
        orderId: order.id,
        userId: order.userId,
        ticketIds: issued.map((t) => t.id),
      },
      status: OutboxStatus.PENDING,
    });
    return "APPLY_SUCCESS" as const;
  }

  // Chi giai phong phan giu cho cua don nay, khong dong vao ve cua nguoi khac.
  if (order.status === OrderStatus.PENDING) {
    await tx
      .update(seats)
      .set({
        status: SeatStatus.AVAILABLE,
        holdOrderId: null,
        holdExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(eq(seats.holdOrderId, order.id), eq(seats.status, SeatStatus.HELD)),
      );
    for (const item of items.filter((i) => !i.seatId)) {
      await tx
        .update(ticketTypes)
        .set({
          heldCount: sql`GREATEST(0, ${ticketTypes.heldCount} - ${item.quantity})`,
          updatedAt: now,
        })
        .where(eq(ticketTypes.id, item.ticketTypeId));
    }
  }
  const [refund] = await tx
    .insert(refunds)
    .values({
      orderId: order.id,
      amount: order.finalAmount,
      reason: "LATE_PAYMENT_INVENTORY_LOST",
      status: RefundStatus.PENDING,
      idempotencyKey: `late:${payment.id}`,
    })
    .onConflictDoNothing()
    .returning();
  await tx
    .update(orders)
    .set({
      status: OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
      paidAt: now,
      updatedAt: now,
    })
    .where(eq(orders.id, order.id));
  if (refund)
    await tx.insert(outbox).values({
      eventType: "REFUND_REQUESTED",
      status: OutboxStatus.PENDING,
      payload: { orderId: order.id, refundId: refund.id },
    });
  return "REFUND_PENDING" as const;
}
