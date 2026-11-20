import { env } from "../config/env.config";
import {
  flushPaymentMonitoring,
  initializePaymentMonitoring,
  paymentSignal,
} from "./payment-monitoring";

async function main() {
  if (!env.SENTRY_DSN) throw new Error("SENTRY_DSN is not configured");
  initializePaymentMonitoring();
  paymentSignal("payment.monitoring.smoke_test", "warning");
  if (!(await flushPaymentMonitoring()))
    throw new Error("Sentry transport flush timed out");
  console.log(
    "Sentry transport flushed. Verify the smoke event and alert delivery in Sentry.",
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Payment monitoring check failed",
  );
  process.exitCode = 1;
});
