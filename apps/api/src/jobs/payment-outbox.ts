import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { OutboxStatus } from "@tickethub/shared";
import { env } from "../config/env.config";
import { db } from "../database/db";
import { outbox, refunds } from "../database/schema";
import { VnpayApi } from "../payments/vnpay-api";
import { processRefund } from "./refund.processor";
import { sendPaymentEmail } from "./payment-email";

const RefundEventSchema = z.union([
  z.object({ refundId: z.string().uuid() }).transform((v) => [v.refundId]),
  z
    .object({ refundIds: z.array(z.string().uuid()).min(1).max(100) })
    .transform((v) => [...new Set(v.refundIds)]),
]);
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
          lte(outbox.nextRetryAt, sql`clock_timestamp()`),
          or(
            eq(outbox.status, OutboxStatus.PENDING),
            and(
              eq(outbox.status, OutboxStatus.PROCESSING),
              lte(
                outbox.updatedAt,
                sql`clock_timestamp() - interval '5 minutes'`,
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(outbox.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!found) return null;
    const [claimed] = await tx
      .update(outbox)
      .set({
        status: OutboxStatus.PROCESSING,
        updatedAt: sql`date_trunc('milliseconds', clock_timestamp())`,
      })
      .where(eq(outbox.id, found.id))
      .returning();
    return claimed!;
  });
  if (!event) return false;
  try {
    if (event.eventType === "REFUND_REQUESTED") {
      for (const refundId of RefundEventSchema.parse(event.payload))
        await processRefund(refundId, api);
    } else await sendPaymentEmail(event.id, event.eventType, event.payload);
    await db
      .update(outbox)
      .set({
        status: OutboxStatus.COMPLETED,
        errorMessage: null,
        updatedAt: sql`date_trunc('milliseconds', clock_timestamp())`,
      })
      .where(
        and(
          eq(outbox.id, event.id),
          eq(outbox.status, OutboxStatus.PROCESSING),
          eq(outbox.updatedAt, event.updatedAt),
        ),
      );
  } catch (error) {
    const retries = event.retryCount + 1;
    if (event.eventType === "REFUND_REQUESTED") {
      const parsed = RefundEventSchema.safeParse(event.payload);
      if (parsed.success)
        await db
          .update(refunds)
          .set({
            nextRetryAt: sql`clock_timestamp() + ${Math.min(3600000, 2000 * 2 ** retries)} * interval '1 millisecond'`,
            errorMessage:
              retries >= 8
                ? "MANUAL_RECONCILIATION_REQUIRED"
                : "PROVIDER_RESULT_REQUIRES_CONFIRMATION",
            updatedAt: sql`date_trunc('milliseconds', clock_timestamp())`,
          })
          .where(
            and(
              inArray(refunds.id, parsed.data),
              inArray(refunds.status, ["PENDING", "PROCESSING"]),
            ),
          );
    }
    await db
      .update(outbox)
      .set({
        status: retries >= 8 ? OutboxStatus.FAILED : OutboxStatus.PENDING,
        retryCount: retries,
        nextRetryAt: sql`clock_timestamp() + ${Math.min(3600000, 2000 * 2 ** retries)} * interval '1 millisecond'`,
        errorMessage:
          error instanceof Error ? error.message : "Payment worker failure",
        updatedAt: sql`date_trunc('milliseconds', clock_timestamp())`,
      })
      .where(
        and(
          eq(outbox.id, event.id),
          eq(outbox.status, OutboxStatus.PROCESSING),
          eq(outbox.updatedAt, event.updatedAt),
        ),
      );
  }
  return true;
}
