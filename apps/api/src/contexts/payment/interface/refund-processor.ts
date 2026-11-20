import { VnpayQueryGateway } from "../infrastructure/vnpay-query.gateway";
/**
 * Tien trinh nen: tieu thu outbox REFUND_REQUESTED va goi API hoan tien VNPay.
 * Can ENABLE_VNPAY_REFUND_PROCESSING=true va thong tin dang nhap VNPay that.
 */
import { isIP } from "node:net";
import { env } from "../../../config/env.config";
import { sqlClient } from "../../../database/db";
import { ProcessRefundRequestsUseCase } from "../application/process-refund-requests.use-case";
import { assertRefundProcessingAllowed } from "../domain/refund-processor-guard";
import { DrizzleRefundProcessingStore } from "../infrastructure/drizzle-refund-processing.store";
import { VnpayRefundGateway } from "../infrastructure/vnpay-refund.gateway";

async function main() {
  assertRefundProcessingAllowed({
    ENABLE_VNPAY_REFUND_PROCESSING: process.env.ENABLE_VNPAY_REFUND_PROCESSING,
    VNPAY_TMN_CODE: env.VNPAY_TMN_CODE,
    VNPAY_HASH_SECRET: env.VNPAY_HASH_SECRET,
  });

  const endpoint = new URL(env.VNPAY_API_URL);
  if (endpoint.protocol !== "https:")
    throw new Error("VNPay refund endpoint requires HTTPS");
  const refundIp = process.env.VNPAY_REFUND_IP?.trim();
  if (!refundIp || !isIP(refundIp))
    throw new Error("Set VNPAY_REFUND_IP to the merchant's configured IP");

  const useCase = new ProcessRefundRequestsUseCase(
    new DrizzleRefundProcessingStore(),
    new VnpayRefundGateway({
      apiUrl: env.VNPAY_API_URL,
      tmnCode: env.VNPAY_TMN_CODE,
      hashSecret: env.VNPAY_HASH_SECRET,
    }),
    { ipAddress: refundIp, createBy: "tickethub-system" },
    console,
    new VnpayQueryGateway(),
  );
  await useCase.run();
}

main()
  .catch((error: unknown) => {
    console.error("[Refund] Fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sqlClient.end();
  });
