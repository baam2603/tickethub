import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  OrderStatus,
  TransactionStatus,
  PaymentProvider,
  OutboxStatus,
  SeatStatus,
  TicketStatus,
} from "@tickethub/shared";

import { db } from "../database/db";
import {
  orders,
  transactions,
  orderItems,
  ticketTypes,
  seats,
  outbox,
  tickets,
  auditLog,
} from "../database/schema";

import { settleLatePayment } from "./late-payment";
import { parseVnpayDate } from "./vnpay-api";
import type { VerifyPaymentResult } from "./payment-gateway.interface";
import { VnpayGateway } from "./vnpay.gateway";
import { toVnpayAmount } from "./vnpay-amount";
import { decideVnpayIpn, type IpnDecision } from "./vnpay-ipn.decision";

import { EventReadCacheService } from "../events/event-read-cache.service";

@Injectable()
export class VnpayIpnService {
  private readonly gateway = new VnpayGateway();

  constructor(
    @Inject(EventReadCacheService)
    private readonly eventReadCacheService: EventReadCacheService,
  ) {}

  async process(params: Record<string, string>): Promise<IpnDecision> {
    // 1. Xac minh chu ky va merchant VNPay
    const verified = this.gateway.verifyCallback(params);

    if (!verified.verified || !verified.transactionRef) {
      return "INVALID_SIGNATURE";
    }

    return this.settleVerified(params, verified);
  }

  async settleVerified(
    params: Record<string, string>,
    verified: VerifyPaymentResult,
    source: "IPN" | "QUERYDR" = "IPN",
  ): Promise<IpnDecision> {
    if (!verified.verified || !verified.transactionRef)
      return "INVALID_SIGNATURE";
    // 2. Tim giao dich do Backend da tao
    const existing = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.transactionRef, verified.transactionRef),
        eq(transactions.provider, PaymentProvider.VNPAY),
      ),
    });

    if (!existing) {
      return "ORDER_NOT_FOUND";
    }
    const finalSuccess =
      params.vnp_ResponseCode === "00" && params.vnp_TransactionStatus === "00";
    const finalFailure =
      params.vnp_TransactionStatus === "02" &&
      (source === "QUERYDR"
        ? params.vnp_ResponseCode === "00"
        : params.vnp_ResponseCode !== "00" && params.vnp_ResponseCode !== "07");
    if (!finalSuccess && !finalFailure) {
      return "MANUAL_REVIEW";
    }
    // 3. Tat ca thay doi phai nam trong mot DB transaction
    const decision = await db.transaction(async (tx): Promise<IpnDecision> => {
      // Khoa order truoc, tuong thich voi Booking Cleanup
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, existing.orderId))
        .for("update");

      if (!order) {
        return "ORDER_NOT_FOUND";
      }

      // Khoa transaction de ngan callback xu ly trung
      const [transaction] = await tx
        .select()
        .from(transactions)
        .where(eq(transactions.id, existing.id))
        .for("update");

      if (!transaction || transaction.orderId !== order.id) {
        return "MANUAL_REVIEW";
      }

      // 4. So sanh so tien tu VNPay, transaction, order
      const callbackAmount = params.vnp_Amount;
      const transactionAmount = toVnpayAmount(transaction.amount);
      const orderAmount = toVnpayAmount(order.finalAmount);

      const amountMatches =
        transactionAmount !== null &&
        orderAmount !== null &&
        callbackAmount === transactionAmount &&
        callbackAmount === orderAmount;

      // Callback that bai da ghi nhan truoc do
      if (
        amountMatches &&
        transaction.status === TransactionStatus.FAILED &&
        order.status === OrderStatus.FAILED &&
        !verified.success
      ) {
        return "ALREADY_PROCESSED";
      }

      if (
        amountMatches &&
        transaction.status === TransactionStatus.SUCCESS &&
        [OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING, OrderStatus.REFUNDED].some(
          (status) => status === order.status,
        )
      )
        return "ALREADY_PROCESSED";
      const now = new Date();

      const decision = decideVnpayIpn({
        signatureValid: true,
        transactionFound: true,
        amountMatches,
        orderStatus: order.status,
        transactionStatus: transaction.status,
        paymentSuccessful: verified.success,
        orderExpired: now >= order.expiresAt,
      });

      if (
        decision === "MANUAL_REVIEW" &&
        verified.success &&
        amountMatches &&
        transaction.status === TransactionStatus.PENDING &&
        transaction.vnpCreateDate &&
        (order.status === OrderStatus.EXPIRED ||
          (order.status === OrderStatus.PENDING && now >= order.expiresAt)) &&
        /^\d{1,15}$/.test(params.vnp_TransactionNo ?? "") &&
        parseVnpayDate(params.vnp_PayDate)
      ) {
        return settleLatePayment(tx, order, transaction, params);
      }
      if (decision !== "APPLY_SUCCESS" && decision !== "RECORD_FAILURE") {
        // Ghi nhan callback thanh toan thanh cong
        // nhung khong the xac nhan don hang.
        if (decision === "MANUAL_REVIEW" && verified.success && amountMatches) {
          // Order va transaction da duoc khoa
          // FOR UPDATE o phia tren.
          const [existingAudit] = await tx
            .select({ id: auditLog.id })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.action, `VNPAY_${source}_MANUAL_REVIEW`),
                eq(auditLog.targetType, "TRANSACTION"),
                eq(auditLog.targetId, transaction.id),
              ),
            )
            .limit(1);

          if (!existingAudit) {
            // Chi luu nhung truong callback can doi soat.
            // Khong luu merchant secret.
            const callbackEvidence = {
              vnp_TxnRef: params.vnp_TxnRef ?? null,
              vnp_Amount: params.vnp_Amount ?? null,
              vnp_ResponseCode: params.vnp_ResponseCode ?? null,
              vnp_TransactionStatus: params.vnp_TransactionStatus ?? null,
              vnp_TransactionNo: params.vnp_TransactionNo ?? null,
              vnp_PayDate: params.vnp_PayDate ?? null,
              vnp_BankCode: params.vnp_BankCode ?? null,
            };

            await tx
              .update(transactions)
              .set({
                rawCallback: callbackEvidence,
                responseCode: params.vnp_ResponseCode ?? null,
                providerTxNumber: verified.providerTransactionId ?? null,
                updatedAt: new Date(),
              })
              .where(eq(transactions.id, transaction.id));

            await tx.insert(auditLog).values({
              actorRole: "SYSTEM",
              action: `VNPAY_${source}_MANUAL_REVIEW`,
              targetType: "TRANSACTION",
              targetId: transaction.id,
              changes: {
                orderId: order.id,
                orderCode: order.orderCode,
                orderStatus: order.status,
                transactionStatus: transaction.status,
                reason: "SUCCESS_CALLBACK_REQUIRES_REVIEW",
                callback: callbackEvidence,
                recordedAt: new Date().toISOString(),
              },
            });
          }
        }

        return decision;
      }

      // 5. Doc cac ve thuoc don hang
      const items = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));

      if (items.length === 0) {
        return "MANUAL_REVIEW";
      }

      // Kiem tra du lieu ve truoc khi cap nhat.
      // Mot ghe co so chi tuong ung voi mot ve.

      const seatedIds = items.flatMap((item) =>
        item.seatId === null ? [] : [item.seatId],
      );

      if (
        items.some(
          (item) =>
            item.quantity <= 0 || (item.seatId !== null && item.quantity !== 1),
        ) ||
        new Set(seatedIds).size !== seatedIds.length
      ) {
        return "MANUAL_REVIEW";
      }

      // 6. Cap nhat ton kho GA, co dieu kien chong am so ve
      for (const item of items) {
        if (item.seatId !== null) {
          const updatedSeats = await tx
            .update(seats)
            .set({
              status:
                decision === "APPLY_SUCCESS"
                  ? SeatStatus.SOLD
                  : SeatStatus.AVAILABLE,

              holdOrderId: null,
              holdExpiresAt: null,

              version: sql`${seats.version} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(seats.id, item.seatId),
                eq(seats.eventId, order.eventId),
                eq(seats.ticketTypeId, item.ticketTypeId),
                eq(seats.status, SeatStatus.HELD),
                eq(seats.holdOrderId, order.id),

                ...(decision === "APPLY_SUCCESS"
                  ? [gte(seats.holdExpiresAt, now)]
                  : []),
              ),
            )
            .returning({ id: seats.id });

          if (updatedSeats.length !== 1) {
            throw new Error(
              "VNPAY_SEAT_CONFLICT: seat reservation is no longer valid",
            );
          }

          continue;
        }

        const updated = await tx
          .update(ticketTypes)
          .set({
            heldCount: sql`${ticketTypes.heldCount} - ${item.quantity}`,
            ...(decision === "APPLY_SUCCESS"
              ? {
                  soldCount: sql`${ticketTypes.soldCount} + ${item.quantity}`,
                }
              : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(ticketTypes.id, item.ticketTypeId),
              eq(ticketTypes.eventId, order.eventId),
              eq(ticketTypes.isSeated, false),
              gte(ticketTypes.heldCount, item.quantity),
            ),
          )
          .returning({ id: ticketTypes.id });

        // Rollback toan bo neu du lieu kho ve bat nhat
        if (updated.length !== 1) {
          throw new Error(
            "VNPAY_INVENTORY_CONFLICT: manual reconciliation required",
          );
        }
      }

      // 7. Cap nhat giao dich
      await tx
        .update(transactions)
        .set({
          status:
            decision === "APPLY_SUCCESS"
              ? TransactionStatus.SUCCESS
              : TransactionStatus.FAILED,
          responseCode: params.vnp_ResponseCode ?? null,
          providerTxNumber: verified.providerTransactionId ?? null,
          bankCode: params.vnp_BankCode ?? null,
          payDate: parseVnpayDate(params.vnp_PayDate),
          rawCallback: params,
          updatedAt: now,
        })
        .where(eq(transactions.id, transaction.id));

      // 8. Cap nhat order trong cung transaction
      await tx
        .update(orders)
        .set({
          status:
            decision === "APPLY_SUCCESS"
              ? OrderStatus.PAID
              : OrderStatus.FAILED,
          paidAt: decision === "APPLY_SUCCESS" ? now : null,
          updatedAt: now,
        })
        .where(eq(orders.id, order.id));

      // Ghi su kien ORDER_PAID trong cung DB transaction.
      // Callback lap lai khong duoc tao them su kien.
      if (decision === "APPLY_SUCCESS") {
        const ticketRows = items.flatMap((item) =>
          Array.from({ length: item.quantity }, () => ({
            ticketCode: `TK${randomBytes(15).toString("hex").toUpperCase()}`,
            orderId: order.id,
            userId: order.userId,
            eventId: order.eventId,
            ticketTypeId: item.ticketTypeId,
            seatId: item.seatId,
            status: TicketStatus.SOLD,
          })),
        );

        const issuedTickets = await tx
          .insert(tickets)
          .values(ticketRows)
          .returning({ id: tickets.id });

        await tx.insert(outbox).values({
          eventType: "ORDER_PAID",
          status: OutboxStatus.PENDING,
          payload: {
            orderId: order.id,
            orderCode: order.orderCode,
            userId: order.userId,
            eventId: order.eventId,
            transactionId: transaction.id,
            transactionRef: transaction.transactionRef,
            provider: PaymentProvider.VNPAY,
            amount: order.finalAmount,
            ticketIds: issuedTickets.map((ticket) => ticket.id),
            paidAt: now.toISOString(),
          },
        });
      }
      return decision;
    });

    // Redis chỉ được invalidated sau khi transaction DB commit thành công.
    // Callback trùng, sai chữ ký, hoặc manual review không đổi tồn kho.
    if (
      decision === "APPLY_SUCCESS" ||
      decision === "RECORD_FAILURE" ||
      decision === "REFUND_PENDING"
    ) {
      const [affectedOrder] = await db
        .select({ eventId: orders.eventId })
        .from(orders)
        .where(eq(orders.id, existing.orderId))
        .limit(1);

      if (affectedOrder) {
        await this.eventReadCacheService.invalidate(affectedOrder.eventId);
      }
    }

    return decision;
  }
}
