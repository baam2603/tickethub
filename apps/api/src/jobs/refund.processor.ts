import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  OrderStatus,
  PaymentProvider,
  RefundStatus,
  TransactionStatus,
} from "@tickethub/shared";
import { db } from "../database/db";
import {
  auditLog,
  orders,
  outbox,
  refunds,
  transactions,
  tickets,
} from "../database/schema";
import { env } from "../config/env.config";
import { VnpayApi, type RefundPayment } from "../payments/vnpay-api";
import { hasVnpayCredentials } from "../payments/vnpay-config";
import { toVnpayAmount } from "../payments/vnpay-amount";

export async function processRefund(refundId: string, api: VnpayApi) {
  return processRefundGroup([refundId], api);
}

export async function processRefundGroup(refundIds: string[], api: VnpayApi) {
  const ids = [...new Set(refundIds)].sort();
  if (!ids.length) throw new Error("Refund IDs required");
  // Mỗi vòng chỉ gửi một nhóm chưa từng gửi hoặc đối soát nhóm đã có request ID.
  // Legacy đã gửi riêng từng vé tiếp tục đối soát riêng, không gom và gửi lại.
  for (let remaining = ids.length; remaining > 0; remaining--) {
    if (!(await processNextGroup(ids, api))) return;
  }
}

async function processNextGroup(refundIds: string[], api: VnpayApi) {
  if (process.env.ENABLE_VNPAY_REFUNDS !== "true")
    throw new Error("VNPay refund worker is disabled");
  if (!hasVnpayCredentials())
    throw new Error("VNPay credentials not configured");
  // Order -> Refund -> Payment, giong thu tu khoa cua IPN.
  const reservation = await db.transaction(async (tx) => {
    const original = await tx.query.refunds.findFirst({
      where: eq(refunds.id, refundIds[0]!),
    });
    if (!original) throw new Error("Refund not found");
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, original.orderId))
      .for("update");
    if (!order) throw new Error("Refund order not found");
    const all = await tx
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, order.id))
      .orderBy(asc(refunds.id))
      .for("update");
    const requested = refundIds.map((id) => all.find((row) => row.id === id));
    if (requested.some((row) => !row))
      throw new Error("Refund IDs must belong to one order");
    const active = requested.filter(
      (row): row is typeof refunds.$inferSelect =>
        !!row && row.status !== RefundStatus.COMPLETED,
    );
    if (!active.length) return null;
    const submitted = active.find(
      (row) =>
        row.providerGroupId ||
        row.providerRequestId ||
        row.status === RefundStatus.PROCESSING,
    );
    const group = submitted
      ? submitted.providerGroupId
        ? all.filter((row) => row.providerGroupId === submitted.providerGroupId)
        : [submitted]
      : active;
    const refund = submitted?.providerGroupId
      ? group.find((row) => row.id === submitted.providerGroupId)
      : group[0];
    if (
      !refund ||
      group.some(
        (row) =>
          ![RefundStatus.PENDING, RefundStatus.PROCESSING].some(
            (status) => status === row.status,
          ),
      )
    )
      throw new Error("Refund group requires manual review");
    if (submitted && !refund.providerRequestId)
      throw new Error("Submitted refund is missing its persisted request ID");
    if (group.some((row) => row.id !== refund.id && row.providerRequestId))
      throw new Error("Refund group has multiple provider requests");
    const groupIds = group.map((row) => row.id);
    for (const refund of group) {
      if (refund.reason === "LATE_PAYMENT_INVENTORY_LOST") {
        if (
          order.status !== OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING ||
          refund.ticketId !== null
        )
          throw new Error("Invalid late refund state");
      } else {
        if (
          ![OrderStatus.PAID, OrderStatus.REFUNDED].some(
            (status) => status === order.status,
          )
        )
          throw new Error("Refund order is not paid");
        const revoked = await tx
          .select()
          .from(tickets)
          .where(
            and(
              eq(tickets.orderId, order.id),
              refund.ticketId ? eq(tickets.id, refund.ticketId) : undefined,
            ),
          );
        if (
          !revoked.length ||
          revoked.some((ticket) => ticket.status !== "CANCELLED")
        )
          throw new Error(
            "Tickets must be revoked by the cancellation transaction before refund",
          );
      }
    }
    const payment = await tx.query.transactions.findFirst({
      where: and(
        eq(transactions.orderId, refund.orderId),
        eq(transactions.provider, PaymentProvider.VNPAY),
        eq(transactions.status, TransactionStatus.SUCCESS),
      ),
    });
    const amountMinor = group.reduce((total, row) => {
      const value = toVnpayAmount(row.amount);
      if (!value) throw new Error("Invalid refund amount");
      return total + BigInt(value);
    }, 0n);
    const amount = amountMinor.toString();
    if (
      refund.providerAmount &&
      toVnpayAmount(refund.providerAmount) !== amount
    )
      throw new Error("Persisted refund group amount changed");
    const originalAmount = payment && toVnpayAmount(payment.amount);
    if (
      !payment?.vnpCreateDate ||
      !payment.providerTxNumber ||
      !amount ||
      !originalAmount ||
      BigInt(amount) > BigInt(originalAmount)
    )
      throw new Error("Verified original payment metadata required");
    const otherMinor = all
      .filter(
        (row) =>
          !groupIds.includes(row.id) &&
          [RefundStatus.PROCESSING, RefundStatus.COMPLETED].some(
            (status) => status === row.status,
          ),
      )
      .reduce((total, row) => total + BigInt(toVnpayAmount(row.amount)!), 0n);
    if (otherMinor + amountMinor > BigInt(originalAmount))
      throw new Error("Refund exceeds captured amount");
    const send =
      refund.status === RefundStatus.PENDING && !refund.providerRequestId;
    const requestId =
      refund.providerRequestId ?? randomBytes(16).toString("hex");
    const payload: RefundPayment = {
      requestId,
      transactionRef: payment.transactionRef,
      transactionDate: payment.vnpCreateDate,
      amountMinor: amount,
      originalAmountMinor: originalAmount,
      transactionNo: payment.providerTxNumber,
      ipAddress: env.VNPAY_REFUND_IP,
    };
    // Leader giữ request ID duy nhất; các vé con tham chiếu leader qua providerGroupId.
    if (send)
      await tx
        .update(refunds)
        .set({
          providerRequestId: requestId,
          providerAmount: `${amountMinor / 100n}.${(amountMinor % 100n).toString().padStart(2, "0")}`,
        })
        .where(eq(refunds.id, refund.id));
    await tx
      .update(refunds)
      .set({
        status: RefundStatus.PROCESSING,
        ...(send ? { providerGroupId: refund.id } : {}),
        lastAttemptAt: send ? sql`clock_timestamp()` : refund.lastAttemptAt,
        retryCount: sql`${refunds.retryCount} + 1`,
        errorMessage: "PROVIDER_RESULT_REQUIRES_CONFIRMATION",
        updatedAt: sql`date_trunc('milliseconds',clock_timestamp())`,
      })
      .where(inArray(refunds.id, groupIds));
    return {
      send,
      payload,
      orderId: refund.orderId,
      groupIds,
      leaderId: refund.id,
    };
  });
  if (!reservation) return false;
  // HTTP NGOAI DB transaction. Ket qua khong ro khong duoc gui refund lai.
  const { payload } = reservation;
  const response = reservation.send
    ? await api.refund(payload)
    : await api.queryTransaction(payload);
  const expectedType =
    payload.amountMinor === payload.originalAmountMinor ? "02" : "03";
  if (
    response.vnp_ResponseCode !== "00" ||
    response.vnp_TransactionStatus !== "00" ||
    response.vnp_TransactionType !== expectedType ||
    response.vnp_Amount !== payload.amountMinor ||
    (!reservation.send &&
      expectedType === "03" &&
      response.vnp_OrderInfo !== `Refund TicketHub ${payload.requestId}`) ||
    !/^\d{1,15}$/.test(response.vnp_TransactionNo ?? "")
  )
    throw new Error("Refund result inconclusive; reconcile without resending");
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, reservation.orderId))
      .for("update");
    const [refund] = await tx
      .select()
      .from(refunds)
      .where(eq(refunds.id, reservation.leaderId))
      .for("update");
    if (!order || !refund || refund.status === RefundStatus.COMPLETED) return;
    if (
      refund.providerRequestId !== payload.requestId ||
      refund.status !== RefundStatus.PROCESSING
    )
      throw new Error("Refund ownership changed");
    await tx
      .update(refunds)
      .set({
        status: RefundStatus.COMPLETED,
        providerRefundRef: response.vnp_TransactionNo!,
        processedAt: sql`clock_timestamp()`,
        errorMessage: null,
        updatedAt: sql`date_trunc('milliseconds',clock_timestamp())`,
      })
      .where(inArray(refunds.id, reservation.groupIds));
    const [completed] = await tx
      .select({ total: sql<string>`COALESCE(SUM(${refunds.amount}), 0)` })
      .from(refunds)
      .where(
        and(
          eq(refunds.orderId, order.id),
          eq(refunds.status, RefundStatus.COMPLETED),
        ),
      );
    if (
      order.status === OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING ||
      Number(completed?.total ?? "0") >= Number(order.finalAmount)
    )
      await tx
        .update(orders)
        .set({
          status: OrderStatus.REFUNDED,
          updatedAt: sql`date_trunc('milliseconds',clock_timestamp())`,
        })
        .where(eq(orders.id, order.id));
    await tx.insert(auditLog).values({
      actorRole: "SYSTEM",
      action: "REFUND_COMPLETED",
      targetType: "REFUND",
      targetId: reservation.leaderId,
      changes: {
        requestId: payload.requestId,
        providerRefundRef: response.vnp_TransactionNo,
        amount: `${BigInt(payload.amountMinor) / 100n}.${(BigInt(payload.amountMinor) % 100n).toString().padStart(2, "0")}`,
        amountMinor: payload.amountMinor,
        refundIds: reservation.groupIds,
      },
    });
    await tx.insert(outbox).values({
      eventType: "REFUND_COMPLETED",
      payload: {
        orderId: order.id,
        refundId: reservation.leaderId,
        refundIds: reservation.groupIds,
      },
    });
  });
  return true;
}
