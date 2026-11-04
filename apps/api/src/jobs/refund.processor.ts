import { and, eq, inArray, sql } from "drizzle-orm";
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
import { toVnpayAmount } from "../payments/vnpay-amount";

export async function processRefund(refundId: string, api: VnpayApi) {
  if (process.env.ENABLE_VNPAY_REFUNDS !== "true")
    throw new Error("VNPay refund worker is disabled");
  if (
    env.VNPAY_TMN_CODE === "TEST_TMN_CODE" ||
    env.VNPAY_HASH_SECRET === "TEST_HASH_SECRET" ||
    !env.VNPAY_HASH_SECRET.trim()
  )
    throw new Error("VNPay credentials not configured");
  // Order -> Refund -> Payment, giong thu tu khoa cua IPN.
  const reservation = await db.transaction(async (tx) => {
    const original = await tx.query.refunds.findFirst({
      where: eq(refunds.id, refundId),
    });
    if (!original) throw new Error("Refund not found");
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, original.orderId))
      .for("update");
    const [refund] = await tx
      .select()
      .from(refunds)
      .where(eq(refunds.id, refundId))
      .for("update");
    if (!refund || refund.status === RefundStatus.COMPLETED) return null;
    if (
      ![RefundStatus.PENDING, RefundStatus.PROCESSING].some(
        (s) => s === refund.status,
      )
    )
      throw new Error("Refund requires manual review");
    if (!order) throw new Error("Refund order not found");
    if (refund.reason === "LATE_PAYMENT_INVENTORY_LOST") {
      if (
        order.status !== OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING ||
        refund.ticketId !== null
      )
        throw new Error("Invalid late refund state");
    } else {
      if (order.status !== OrderStatus.PAID)
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
    const payment = await tx.query.transactions.findFirst({
      where: and(
        eq(transactions.orderId, refund.orderId),
        eq(transactions.provider, PaymentProvider.VNPAY),
        eq(transactions.status, TransactionStatus.SUCCESS),
      ),
    });
    const amount = toVnpayAmount(refund.amount);
    const originalAmount = payment && toVnpayAmount(payment.amount);
    if (
      !payment?.vnpCreateDate ||
      !payment.providerTxNumber ||
      !amount ||
      !originalAmount ||
      BigInt(amount) > BigInt(originalAmount)
    )
      throw new Error("Verified original payment metadata required");
    const others = await tx
      .select({ total: sql<string>`COALESCE(SUM(${refunds.amount}), 0)` })
      .from(refunds)
      .where(
        and(
          eq(refunds.orderId, refund.orderId),
          sql`${refunds.id} <> ${refund.id}`,
          inArray(refunds.status, [
            RefundStatus.PROCESSING,
            RefundStatus.COMPLETED,
          ]),
        ),
      );
    if (
      Number(others[0]?.total ?? "0") + Number(refund.amount) >
      Number(payment.amount)
    )
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
    await tx
      .update(refunds)
      .set({
        status: RefundStatus.PROCESSING,
        providerRequestId: requestId,
        lastAttemptAt: send ? new Date() : refund.lastAttemptAt,
        retryCount: sql`${refunds.retryCount} + 1`,
        errorMessage: "PROVIDER_RESULT_REQUIRES_CONFIRMATION",
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refund.id));
    return { send, payload, orderId: refund.orderId };
  });
  if (!reservation) return;
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
      .where(eq(refunds.id, refundId))
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
        processedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refundId));
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
        .set({ status: OrderStatus.REFUNDED, updatedAt: new Date() })
        .where(eq(orders.id, order.id));
    await tx.insert(auditLog).values({
      actorRole: "SYSTEM",
      action: "REFUND_COMPLETED",
      targetType: "REFUND",
      targetId: refundId,
      changes: {
        requestId: payload.requestId,
        providerRefundRef: response.vnp_TransactionNo,
        amount: refund.amount,
      },
    });
    await tx.insert(outbox).values({
      eventType: "REFUND_COMPLETED",
      payload: { orderId: order.id, refundId },
    });
  });
}
