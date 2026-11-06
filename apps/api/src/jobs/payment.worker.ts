import { setTimeout as delay } from "node:timers/promises";
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
    console.error("Payment worker failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await api.onModuleDestroy();
    await sqlClient.end();
  });
