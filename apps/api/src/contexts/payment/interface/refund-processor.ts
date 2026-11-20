import { isIP } from "node:net";
import {
  flushPaymentMonitoring,
  initializePaymentMonitoring,
  paymentSignal,
} from "../../../shared-kernel/payment-monitoring";
/**
 * Tien trinh nen: tieu thu outbox REFUND_REQUESTED va goi API hoan tien VNPay.
 * Can ENABLE_VNPAY_REFUND_PROCESSING=true va thong tin dang nhap VNPay that.
 */
import { env } from "../../../config/env.config";
import { sqlClient } from "../../../database/db";
import { ProcessRefundRequestsUseCase } from "../application/process-refund-requests.use-case";
import { assertRefundProcessingAllowed } from "../domain/refund-processor-guard";
import { DrizzleRefundProcessingStore } from "../infrastructure/drizzle-refund-processing.store";
import { VnpayRefundGateway } from "../infrastructure/vnpay-refund.gateway";

async function main() {
  initializePaymentMonitoring();
  assertRefundProcessingAllowed({
    ENABLE_VNPAY_REFUND_PROCESSING: process.env.ENABLE_VNPAY_REFUND_PROCESSING,
    VNPAY_TMN_CODE: env.VNPAY_TMN_CODE,
    VNPAY_HASH_SECRET: env.VNPAY_HASH_SECRET,
  });

  if (!isIP(env.VNPAY_REFUND_IP))
    throw new Error("Set VNPAY_REFUND_IP to the merchant's configured IP");
  if (
    env.NODE_ENV === "production" &&
    new URL(env.VNPAY_API_URL).protocol !== "https:"
  )
    throw new Error("Production VNPay refund endpoint requires HTTPS");

  const useCase = new ProcessRefundRequestsUseCase(
    new DrizzleRefundProcessingStore(),
    new VnpayRefundGateway({
      apiUrl: env.VNPAY_API_URL,
      tmnCode: env.VNPAY_TMN_CODE,
      hashSecret: env.VNPAY_HASH_SECRET,
    }),
    { ipAddress: env.VNPAY_REFUND_IP, createBy: "tickethub-system" },
    { log() {}, warn() {}, error() {} },
  );
  const result = await useCase.run();
  console.log(
    JSON.stringify({ event: "vnpay.refund.batch_completed", ...result }),
  );
  if (result.uncertain || result.failed || result.rejected)
    paymentSignal("vnpay.refund.manual_review", "warning", {
      uncertain: result.uncertain,
      failed: result.failed,
      rejected: result.rejected,
    });
}

main()
  .catch(() => {
    paymentSignal("vnpay.refund.worker_failed", "error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushPaymentMonitoring();
    await sqlClient.end();
  });
