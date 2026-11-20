import { createHash } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { db } from "../database/db";
import { events, orders, refunds, transactions } from "../database/schema";
import { calculatePayout } from "./payout-calculator";

export type SettlementTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function lockSettlementEvent(
  tx: SettlementTransaction,
  eventId: string,
) {
  const [event] = await tx
    .select({
      id: events.id,
      organizerId: events.organizerId,
      title: events.title,
      status: events.status,
      endTime: events.endTime,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .for("no key update");
  if (!event) throw new NotFoundException("EVENT_NOT_FOUND");
  return event;
}

export function assertSettlementClosed(
  event: Awaited<ReturnType<typeof lockSettlementEvent>>,
) {
  if (event.status !== "ENDED" && event.status !== "CANCELLED") {
    throw new ConflictException("EVENT_NOT_CLOSED_FOR_SETTLEMENT");
  }
}

export async function readSettlementLedger(
  tx: SettlementTransaction,
  eventId: string,
) {
  // Thanh toán và hoàn tiền đều khóa order trước khi cập nhật số liệu.
  const eventOrders = await tx
    .select({
      id: orders.id,
      code: orders.orderCode,
      status: orders.status,
      amount: orders.finalAmount,
    })
    .from(orders)
    .where(eq(orders.eventId, eventId))
    .orderBy(orders.id)
    .for("update");
  const payments = await tx
    .select({
      orderId: transactions.orderId,
      ref: transactions.transactionRef,
      number: transactions.providerTxNumber,
      amount: transactions.amount,
      status: transactions.status,
      bankCode: transactions.bankCode,
      payDate: transactions.payDate,
    })
    .from(transactions)
    .innerJoin(orders, eq(orders.id, transactions.orderId))
    .where(and(eq(orders.eventId, eventId), eq(transactions.provider, "VNPAY")))
    .orderBy(transactions.id);
  const eventRefunds = await tx
    .select({
      id: refunds.id,
      orderId: refunds.orderId,
      number: refunds.providerRefundRef,
      amount: refunds.amount,
      status: refunds.status,
      processedAt: refunds.processedAt,
    })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .where(eq(orders.eventId, eventId))
    .orderBy(refunds.id);
  const ledgerHash = hash(
    JSON.stringify([eventOrders, payments, eventRefunds]),
  );
  const calculation = calculatePayout(
    payments
      .filter((row) => row.status === "SUCCESS")
      .reduce((sum, row) => sum + Number(row.amount), 0),
    eventRefunds
      .filter((row) => row.status === "COMPLETED")
      .reduce((sum, row) => sum + Number(row.amount), 0),
  );
  return { eventOrders, payments, eventRefunds, ledgerHash, calculation };
}
