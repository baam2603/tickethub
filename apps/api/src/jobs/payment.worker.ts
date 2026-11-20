import { setTimeout as delay } from "node:timers/promises";
import {
  flushPaymentMonitoring,
  initializePaymentMonitoring,
  paymentSignal,
} from "../monitoring/payment-monitoring";
import { sqlClient } from "../database/db";
import { VnpayApi } from "../payments/vnpay-api";
import { processPaymentOutboxOnce } from "./payment-outbox";

const api = new VnpayApi();
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});
async function main() {
  initializePaymentMonitoring();
  if (
    process.env.ENABLE_VNPAY_REFUNDS !== "true" &&
    process.env.ENABLE_PAYMENT_EMAIL !== "true"
  )
    throw new Error("Enable a payment worker handler before starting");
  do {
    const processed = await processPaymentOutboxOnce(api);
    if (process.argv.includes("--once")) break;
    if (!processed) await delay(1000);
  } while (!stopping);
}
main()
  .catch(() => {
    paymentSignal("payment.worker.failed", "error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushPaymentMonitoring();
    await api.onModuleDestroy();
    await sqlClient.end();
  });
