import { setTimeout as delay } from "node:timers/promises";
import { ServiceUnavailableException } from "@nestjs/common";
import { paymentSignal } from "../monitoring/payment-monitoring";

export async function retryPayoutApproval<T>(
  payoutId: string,
  approve: () => Promise<T>,
) {
  // PostgreSQL xác nhận rollback ở các mã này. Mất kết nối khi COMMIT có kết quả bất định.
  const recheckable = new Set(["40001", "40P01", "55P03"]);
  for (let attempt = 1; ; attempt++) {
    try {
      return await approve();
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      const retry = [error, cause].some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "code" in value &&
          typeof value.code === "string" &&
          recheckable.has(value.code),
      );
      if (!retry) throw error;
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
