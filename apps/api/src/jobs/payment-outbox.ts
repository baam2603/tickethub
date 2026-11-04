import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import { z } from "zod";
import { OutboxStatus } from "@tickethub/shared";
import { env } from "../config/env.config";
import { db } from "../database/db";
import { outbox, refunds } from "../database/schema";
import { VnpayApi } from "../payments/vnpay-api";
import { processRefund } from "./refund.processor";
import { sendPaymentEmail } from "./payment-email";

export async function processPaymentOutboxOnce(
  api: VnpayApi,
  targetId?: string,
) {
  // Worker chua duoc cau hinh khong duoc tieu hao retry budget cua su kien.
  const enabledTypes: string[] = [];
  if (process.env.ENABLE_PAYMENT_EMAIL === "true" && env.RESEND_API_KEY)
    enabledTypes.push("ORDER_PAID", "REFUND_COMPLETED");
  if (
    process.env.ENABLE_VNPAY_REFUNDS === "true" &&
    env.VNPAY_TMN_CODE !== "TEST_TMN_CODE" &&
    env.VNPAY_HASH_SECRET !== "TEST_HASH_SECRET" &&
    env.VNPAY_HASH_SECRET.trim()
  )
    enabledTypes.push("REFUND_REQUESTED");
  if (!enabledTypes.length) return false;
  const event = await db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(outbox)
      .where(
        and(
          targetId ? eq(outbox.id, targetId) : undefined,
          inArray(outbox.eventType, enabledTypes),
          lte(outbox.nextRetryAt, new Date()),
          or(
            eq(outbox.status, OutboxStatus.PENDING),
            and(
              eq(outbox.status, OutboxStatus.PROCESSING),
              lte(outbox.updatedAt, new Date(Date.now() - 300000)),
            ),
          ),
        ),
      )
      .orderBy(asc(outbox.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!found) return null;
    await tx
      .update(outbox)
      .set({ status: OutboxStatus.PROCESSING, updatedAt: new Date() })
      .where(eq(outbox.id, found.id));
    return found;
  });
  if (!event) return false;
  try {
    if (event.eventType === "REFUND_REQUESTED") {
      const { refundId } = z
        .object({ refundId: z.string().uuid() })
        .parse(event.payload);
      await processRefund(refundId, api);
    } else await sendPaymentEmail(event.id, event.eventType, event.payload);
    await db
      .update(outbox)
      .set({
        status: OutboxStatus.COMPLETED,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(outbox.id, event.id));
  } catch (error) {
    const retries = event.retryCount + 1;
    if (event.eventType === "REFUND_REQUESTED") {
      const parsed = z
        .object({ refundId: z.string().uuid() })
        .safeParse(event.payload);
      if (parsed.success)
        await db
          .update(refunds)
          .set({
            nextRetryAt: new Date(
              Date.now() + Math.min(3600000, 2000 * 2 ** retries),
            ),
            errorMessage:
              retries >= 8
                ? "MANUAL_RECONCILIATION_REQUIRED"
                : "PROVIDER_RESULT_REQUIRES_CONFIRMATION",
            updatedAt: new Date(),
          })
          .where(eq(refunds.id, parsed.data.refundId));
    }
    await db
      .update(outbox)
      .set({
        status: retries >= 8 ? OutboxStatus.FAILED : OutboxStatus.PENDING,
        retryCount: retries,
        nextRetryAt: new Date(
          Date.now() + Math.min(3600000, 2000 * 2 ** retries),
        ),
        errorMessage:
          error instanceof Error ? error.message : "Payment worker failure",
        updatedAt: new Date(),
      })
      .where(eq(outbox.id, event.id));
  }
  return true;
}
