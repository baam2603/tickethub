import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "../database/db";
import { outbox } from "../database/schema";
import { paymentSignal } from "../monitoring/payment-monitoring";
import {
  ApprovalIntentSchema,
  PAYOUT_APPROVAL_RETRY,
} from "../payouts/approval-intent";
import { isApprovalRollback } from "../payouts/approval-retry";
import { PayoutsService } from "../payouts/payouts.service";

const payouts = new PayoutsService();

export async function processPayoutApprovalRetry() {
  const result = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.eventType, PAYOUT_APPROVAL_RETRY),
          eq(outbox.status, "PENDING"),
          lte(outbox.nextRetryAt, sql`clock_timestamp()`),
        ),
      )
      .orderBy(asc(outbox.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return null;

    const attempts = job.retryCount + 1;
    let status: "COMPLETED" | "PENDING" | "FAILED" = "COMPLETED";
    let errorCode: string | null = null;
    const parsed = ApprovalIntentSchema.safeParse(job.payload);
    try {
      if (!parsed.success) throw parsed.error;
      const intent = parsed.data;
      // A savepoint lets the worker record a retry after a confirmed rollback.
      await tx.transaction((savepoint) =>
        payouts.applyApproval(
          savepoint,
          intent.payoutId,
          intent.adminUserId,
          intent,
          intent,
        ),
      );
    } catch (error) {
      const retryable = isApprovalRollback(error);
      status = retryable && attempts < 3 ? "PENDING" : "FAILED";
      errorCode = retryable
        ? "PAYOUT_APPROVAL_ROLLBACK"
        : "PAYOUT_APPROVAL_REQUIRES_REVIEW";
    }

    // The approval and its job state commit atomically.
    await tx
      .update(outbox)
      .set({
        status,
        retryCount: attempts,
        errorMessage: errorCode,
        nextRetryAt: sql`clock_timestamp() + interval '5 seconds'`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(outbox.id, job.id));
    return { jobId: job.id, status, attempts, payoutId: parsed.data?.payoutId };
  });
  if (result?.status === "FAILED")
    paymentSignal("payout.approval.manual_review", "error", {
      jobId: result.jobId,
      ...(result.payoutId ? { payoutId: result.payoutId } : {}),
      attempts: result.attempts,
    });
  return result !== null;
}
