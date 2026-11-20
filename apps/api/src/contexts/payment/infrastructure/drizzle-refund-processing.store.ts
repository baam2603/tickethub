import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  OrderStatus,
  OutboxStatus,
  RefundStatus,
  TransactionStatus,
} from "@tickethub/shared";
import { db } from "../../../database/db";
import {
  auditLog,
  orders,
  outbox,
  refunds,
  transactions,
} from "../../../database/schema";
import type { RefundRequestedPayload } from "../domain/refund-processing";
import type {
  RefundOrderContext,
  RefundOutboxEvent,
  RefundProcessingStore,
} from "../domain/refund-processing.ports";

const EVENT_TYPE = "REFUND_REQUESTED";

export class DrizzleRefundProcessingStore implements RefundProcessingStore {
  findPending(limit: number, now: Date): Promise<RefundOutboxEvent[]> {
    return db
      .select({
        id: outbox.id,
        payload: outbox.payload,
        retryCount: outbox.retryCount,
        verifying: sql<boolean>`coalesce(${outbox.errorMessage} = 'REFUND_QUERYDR_PENDING', false)`,
      })
      .from(outbox)
      .where(
        and(
          eq(outbox.eventType, EVENT_TYPE),
          eq(outbox.status, OutboxStatus.PENDING),
          lte(outbox.nextRetryAt, now),
        ),
      )
      .orderBy(asc(outbox.createdAt))
      .limit(limit);
  }

  async claim(eventId: string, now: Date): Promise<boolean> {
    const [claimed] = await db
      .update(outbox)
      .set({ status: OutboxStatus.PROCESSING, updatedAt: now })
      .where(
        and(
          eq(outbox.id, eventId),
          eq(outbox.eventType, EVENT_TYPE),
          eq(outbox.status, OutboxStatus.PENDING),
          lte(outbox.nextRetryAt, now),
        ),
      )
      .returning({ id: outbox.id });
    return Boolean(claimed);
  }

  async loadContext(
    payload: RefundRequestedPayload,
    verifying = false,
  ): Promise<RefundOrderContext | null> {
    const [order] = await db
      .select({
        id: orders.id,
        orderCode: orders.orderCode,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, payload.orderId))
      .limit(1);
    if (!order) return null;

    const [tx, duplicate] = await db
      .select({
        transactionRef: transactions.transactionRef,
        providerTxNumber: transactions.providerTxNumber,
        createdAt: transactions.createdAt,
        rawCallback: transactions.rawCallback,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.orderId, payload.orderId),
          eq(transactions.status, TransactionStatus.SUCCESS),
          eq(transactions.provider, "VNPAY"),
        ),
      )
      .limit(2);
    if (!tx || duplicate || !/^\d{1,15}$/.test(tx.providerTxNumber ?? ""))
      return null;

    const pendingRefunds = await db
      .select({ id: refunds.id, amount: refunds.amount })
      .from(refunds)
      .where(
        and(
          inArray(refunds.id, payload.refundIds),
          eq(refunds.orderId, payload.orderId),
          eq(
            refunds.status,
            verifying ? RefundStatus.PROCESSING : RefundStatus.PENDING,
          ),
        ),
      );

    return { order, transaction: tx, pendingRefunds };
  }

  async markRefundsProcessing(
    refundIds: string[],
    now: Date,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [first] = await tx
        .select({ orderId: refunds.orderId })
        .from(refunds)
        .where(eq(refunds.id, refundIds[0]!));
      if (!first) return false;
      await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.id, first.orderId))
        .for("update");
      const [safety] = await tx.execute<{ safe: boolean }>(sql`
        SELECT
          NOT EXISTS (
            SELECT 1 FROM refunds WHERE order_id = ${first.orderId} AND status = 'PROCESSING'
          ) AND
          (SELECT coalesce(sum(amount), 0) FROM refunds WHERE order_id = ${first.orderId} AND
             (status = 'COMPLETED' OR id IN (${sql.join(
               refundIds.map((id) => sql`${id}`),
               sql`, `,
             )})))
          <= (SELECT max(amount) FROM transactions WHERE order_id = ${first.orderId} AND provider = 'VNPAY' AND status = 'SUCCESS')
          AS safe
      `);
      if (!safety?.safe) return false;
      const ready = await tx
        .select({ id: refunds.id })
        .from(refunds)
        .where(
          and(
            inArray(refunds.id, refundIds),
            eq(refunds.orderId, first.orderId),
            eq(refunds.status, RefundStatus.PENDING),
          ),
        )
        .for("update");
      if (ready.length !== refundIds.length) return false;
      await tx
        .update(refunds)
        .set({ status: RefundStatus.PROCESSING, updatedAt: now })
        .where(inArray(refunds.id, refundIds));
      return true;
    });
  }

  async scheduleVerification(
    eventId: string,
    attempts: number,
    nextRetryAt: Date,
  ) {
    await db
      .update(outbox)
      .set({
        status: OutboxStatus.PENDING,
        retryCount: attempts,
        nextRetryAt,
        errorMessage: "REFUND_QUERYDR_PENDING",
        updatedAt: new Date(),
      })
      .where(
        and(eq(outbox.id, eventId), eq(outbox.status, OutboxStatus.PROCESSING)),
      );
  }

  async complete(input: {
    eventId: string;
    refundIds: string[];
    orderId: string;
    providerRefundRef: string;
    orderBecomesRefunded: boolean;
    now: Date;
  }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(refunds)
        .set({
          status: RefundStatus.COMPLETED,
          providerRefundRef: input.providerRefundRef,
          processedAt: input.now,
          errorMessage: null,
          updatedAt: input.now,
        })
        .where(inArray(refunds.id, input.refundIds));
      if (input.orderBecomesRefunded) {
        await tx
          .update(orders)
          .set({ status: OrderStatus.REFUNDED, updatedAt: input.now })
          .where(
            and(
              eq(orders.id, input.orderId),
              eq(orders.status, OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING),
            ),
          );
      }
      await tx.insert(outbox).values({
        eventType: "REFUND_COMPLETED",
        payload: { orderId: input.orderId, refundIds: input.refundIds },
      });
      await tx
        .update(outbox)
        .set({
          status: OutboxStatus.COMPLETED,
          errorMessage: null,
          updatedAt: input.now,
        })
        .where(eq(outbox.id, input.eventId));
    });
  }

  async reject(input: {
    eventId: string;
    refundIds: string[];
    message: string;
    now: Date;
  }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(refunds)
        .set({
          status: RefundStatus.FAILED,
          errorMessage: input.message,
          processedAt: input.now,
          updatedAt: input.now,
        })
        .where(inArray(refunds.id, input.refundIds));
      await tx
        .update(outbox)
        .set({
          status: OutboxStatus.FAILED,
          errorMessage: input.message,
          updatedAt: input.now,
        })
        .where(eq(outbox.id, input.eventId));
    });
  }

  async releaseForRetry(input: {
    eventId: string;
    refundIds: string[];
    retryCount: number;
    nextRetryAt: Date;
    giveUp: boolean;
    message: string;
    now: Date;
  }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(refunds)
        .set({
          status: RefundStatus.PENDING,
          retryCount: input.retryCount,
          errorMessage: input.message,
          updatedAt: input.now,
        })
        .where(inArray(refunds.id, input.refundIds));
      await tx
        .update(outbox)
        .set({
          status: input.giveUp ? OutboxStatus.FAILED : OutboxStatus.PENDING,
          retryCount: input.retryCount,
          nextRetryAt: input.nextRetryAt,
          errorMessage: input.message,
          updatedAt: input.now,
        })
        .where(eq(outbox.id, input.eventId));
      if (input.giveUp)
        await tx.insert(auditLog).values({
          actorRole: "SYSTEM",
          action: "VNPAY_REFUND_MANUAL_REVIEW",
          targetType: "OUTBOX",
          targetId: input.eventId,
          changes: {
            attempts: input.retryCount,
            reason: "REFUND_PROVIDER_UNREACHABLE",
          },
        });
    });
  }

  async failEvent(eventId: string, message: string, now: Date): Promise<void> {
    await db.transaction(async (tx) => {
      const [failed] = await tx
        .update(outbox)
        .set({
          status: OutboxStatus.FAILED,
          errorMessage: message,
          updatedAt: now,
        })
        .where(
          and(
            eq(outbox.id, eventId),
            eq(outbox.status, OutboxStatus.PROCESSING),
          ),
        )
        .returning({ id: outbox.id });
      if (failed)
        await tx.insert(auditLog).values({
          actorRole: "SYSTEM",
          action: "VNPAY_REFUND_MANUAL_REVIEW",
          targetType: "OUTBOX",
          targetId: eventId,
          changes: { reason: message },
        });
    });
  }

  async annotateUncertain(
    eventId: string,
    message: string,
    now: Date,
  ): Promise<void> {
    await db
      .update(outbox)
      .set({ errorMessage: message, updatedAt: now })
      .where(eq(outbox.id, eventId));
  }
}
