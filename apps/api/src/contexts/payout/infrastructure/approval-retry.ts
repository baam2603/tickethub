import { setTimeout as delay } from "node:timers/promises";
import { ServiceUnavailableException } from "@nestjs/common";
import { paymentSignal } from "../../../shared-kernel/payment-monitoring";

// These PostgreSQL errors confirm rollback. A lost connection during COMMIT does not.
const rollbackCodes = new Set(["40001", "40P01", "55P03"]);
export function isApprovalRollback(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;
  return [error, cause].some(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "string" &&
      rollbackCodes.has(value.code),
  );
}

export async function retryPayoutApproval<T>(
  payoutId: string,
  approve: () => Promise<T>,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await approve();
    } catch (error) {
      if (!isApprovalRollback(error)) throw error;
      if (attempt === 3) {
        paymentSignal("payout.approval.manual_review", "error", {
          payoutId,
          attempts: attempt,
        });
        throw new ServiceUnavailableException(
          "PAYOUT_APPROVAL_RETRY_EXHAUSTED",
        );
      }
      await delay(50 * attempt);
    }
  }
}
