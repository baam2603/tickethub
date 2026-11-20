import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  OutboxStatus,
  RefundStatus,
  SeatStatus,
  TicketStatus,
  type RefundExecuteResponse,
} from "@tickethub/shared";
import { db } from "../../../database/db";
import {
  auditLog,
  events,
  idempotencyKeys,
  orderItems,
  orders,
  outbox,
  refunds,
  seats,
  ticketTypes,
  tickets,
} from "../../../database/schema";
import type {
  NewRefundRecord,
  RefundEventInfo,
  RefundQueryPort,
  RefundRequestedOutboxPayload,
  RefundTransaction,
  RefundUnitOfWork,
} from "../domain/refund.ports";
import type { RefundableOrder, RefundableTicket } from "../domain/refund-rules";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbReader = typeof db | DbTx;

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function toOrder(row: typeof orders.$inferSelect): RefundableOrder {
  return {
    id: row.id,
    orderCode: row.orderCode,
    userId: row.userId,
    eventId: row.eventId,
    status: row.status,
    totalAmount: Number(row.totalAmount),
    finalAmount: Number(row.finalAmount),
  };
}

async function sumRefunded(reader: DbReader, orderId: string) {
  const rows = await reader
    .select()
    .from(refunds)
    .where(eq(refunds.orderId, orderId));
  return rows.reduce((sum, r) => sum + Number(r.amount), 0);
}

async function snapshotPrices(reader: DbReader, orderId: string) {
  const rows = await reader
    .select({
      seatId: orderItems.seatId,
      typeId: orderItems.ticketTypeId,
      price: orderItems.unitPrice,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return new Map(rows.map((row) => [row.seatId ?? row.typeId, row.price]));
}

export class DrizzleRefundQuery implements RefundQueryPort {
  async findOrderWithEvent(orderId: string) {
    const row = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      with: { event: true },
    });
    if (!row) return null;
    const event: RefundEventInfo | null = row.event
      ? {
          refundPolicyType: row.event.refundPolicyType,
          startTime: row.event.startTime,
        }
      : null;
    return { order: toOrder(row), event };
  }

  async findOrderTickets(
    orderId: string,
    ticketIds: string[],
  ): Promise<RefundableTicket[]> {
    const rows = await db.query.tickets.findMany({
      where: and(eq(tickets.orderId, orderId), inArray(tickets.id, ticketIds)),
      with: { ticketType: true, seat: true },
    });
    const prices = await snapshotPrices(db, orderId);
    return rows.map((t) => ({
      id: t.id,
      ticketCode: t.ticketCode,
      status: t.status,
      ticketTypeId: t.ticketTypeId,
      seatId: t.seatId,
      eventId: t.eventId,
      unitPrice: Number(
        prices.get(t.seatId ?? t.ticketTypeId) ?? t.ticketType?.price ?? 0,
      ),
      seatLabel: t.seat
        ? `Hàng ${t.seat.rowLabel} - Ghế ${t.seat.seatNumber}`
        : t.ticketType?.name || "GA",
    }));
  }

  sumRefundedAmount(orderId: string) {
    return sumRefunded(db, orderId);
  }

  async findIdempotentResponse(
    key: string,
  ): Promise<RefundExecuteResponse | null> {
    const row = await db.query.idempotencyKeys.findFirst({
      where: eq(idempotencyKeys.key, key),
    });
    return row?.responseBody
      ? (row.responseBody as RefundExecuteResponse)
      : null;
  }
}

class DrizzleRefundTransaction implements RefundTransaction {
  constructor(private readonly tx: DbTx) {}

  async lockOrder(orderId: string) {
    const [row] = await this.tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");
    return row ? toOrder(row) : null;
  }

  async lockTickets(
    orderId: string,
    ticketIds: string[],
  ): Promise<RefundableTicket[]> {
    const rows = await this.tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.orderId, orderId), inArray(tickets.id, ticketIds)))
      .for("update");
    if (rows.length === 0) return [];

    const ttRows = await this.tx
      .select()
      .from(ticketTypes)
      .where(
        inArray(
          ticketTypes.id,
          rows.map((t) => t.ticketTypeId),
        ),
      );
    const prices = await snapshotPrices(this.tx, orderId);
    const priceByType = new Map(ttRows.map((tt) => [tt.id, tt.price]));

    return rows.map((t) => ({
      id: t.id,
      ticketCode: t.ticketCode,
      status: t.status,
      ticketTypeId: t.ticketTypeId,
      seatId: t.seatId,
      eventId: t.eventId,
      unitPrice: Number(
        prices.get(t.seatId ?? t.ticketTypeId) ??
          priceByType.get(t.ticketTypeId) ??
          0,
      ),
      seatLabel: "GA",
    }));
  }

  async findEvent(eventId: string): Promise<RefundEventInfo | null> {
    const event = await this.tx.query.events.findFirst({
      where: eq(events.id, eventId),
    });
    return event
      ? {
          refundPolicyType: event.refundPolicyType,
          startTime: event.startTime,
        }
      : null;
  }

  sumRefundedAmount(orderId: string) {
    return sumRefunded(this.tx, orderId);
  }

  async cancelTickets(ticketIds: string[], at: Date) {
    await this.tx
      .update(tickets)
      .set({ status: TicketStatus.CANCELLED, updatedAt: at })
      .where(inArray(tickets.id, ticketIds));
  }

  async releaseSeats(seatIds: string[], at: Date) {
    await this.tx
      .update(seats)
      .set({
        status: SeatStatus.AVAILABLE,
        holdOrderId: null,
        holdExpiresAt: null,
        version: sql`${seats.version} + 1`,
        updatedAt: at,
      })
      .where(inArray(seats.id, seatIds));
  }

  async decrementSoldCount(counts: ReadonlyMap<string, number>, at: Date) {
    for (const [ticketTypeId, count] of counts) {
      await this.tx
        .update(ticketTypes)
        .set({
          soldCount: sql`${ticketTypes.soldCount} - ${count}`,
          updatedAt: at,
        })
        .where(
          and(
            eq(ticketTypes.id, ticketTypeId),
            gte(ticketTypes.soldCount, count),
          ),
        );
    }
  }

  async insertRefunds(
    orderId: string,
    reason: string,
    rows: NewRefundRecord[],
  ) {
    const inserted = await this.tx
      .insert(refunds)
      .values(
        rows.map((r) => ({
          orderId,
          ticketId: r.ticketId,
          amount: String(r.amount),
          reason,
          status: RefundStatus.PENDING,
          idempotencyKey: r.idempotencyKey,
        })),
      )
      .returning({ id: refunds.id });
    return inserted.map((r) => r.id);
  }

  async countUncancelledTickets(orderId: string) {
    const [row] = await this.tx
      .select({ count: sql<number>`count(*)` })
      .from(tickets)
      .where(
        and(
          eq(tickets.orderId, orderId),
          sql`${tickets.status} != ${TicketStatus.CANCELLED}`,
        ),
      );
    return Number(row?.count || 0);
  }

  async markOrderRefunded(orderId: string, at: Date) {
    await this.tx
      .update(orders)
      .set({ status: "REFUNDED", updatedAt: at })
      .where(eq(orders.id, orderId));
  }

  async enqueueRefundRequested(payload: RefundRequestedOutboxPayload) {
    await this.tx.insert(outbox).values({
      eventType: "REFUND_REQUESTED",
      status: OutboxStatus.PENDING,
      payload,
    });
  }

  async writeAuditLog(entry: {
    actorId: string;
    actorRole: string;
    orderId: string;
    changes: Record<string, unknown>;
  }) {
    await this.tx.insert(auditLog).values({
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: "TICKET_REFUND_REQUESTED",
      targetType: "ORDER",
      targetId: entry.orderId,
      changes: entry.changes,
    });
  }

  async saveIdempotentResponse(
    key: string,
    userId: string,
    response: RefundExecuteResponse,
  ) {
    await this.tx.insert(idempotencyKeys).values({
      key,
      userId,
      path: "/api/v1/refund/request",
      responseStatus: 201,
      responseBody: response,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    });
  }
}

export class DrizzleRefundUnitOfWork implements RefundUnitOfWork {
  run<T>(work: (tx: RefundTransaction) => Promise<T>): Promise<T> {
    return db.transaction((tx) => work(new DrizzleRefundTransaction(tx)));
  }
}
