import { runPaymentEmailWorker } from "./payment.composition";

runPaymentEmailWorker().catch(() => {
  console.error("Payment email worker could not run");
  process.exitCode = 1;
});
