import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../../database/db";
import {
  flushPaymentMonitoring,
  initializePaymentMonitoring,
  paymentSignal,
} from "../../shared-kernel/payment-monitoring";
import { processPayoutApprovalRetry } from "./payout-approval.worker";
import {
  cleanupAdminSettlementExports,
  processAdminSettlementExport,
} from "./infrastructure/admin-settlement-exports";

let stopping = false;
process.once("SIGTERM", () => {
  stopping = true;
});
process.once("SIGINT", () => {
  stopping = true;
});

async function main() {
  initializePaymentMonitoring();
  let refreshed = 0;
  do {
    const once = process.argv.includes("--once");
    try {
      if (Date.now() - refreshed >= 300_000) {
        await db.execute(
          sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_admin_settlement_daily`,
        );
        await cleanupAdminSettlementExports();
        refreshed = Date.now();
      }
      const approval = await processPayoutApprovalRetry();
      const exported = await processAdminSettlementExport();
      if (once) break;
      if (!approval && !exported) await delay(1000);
    } catch (error) {
      if (once) throw error;
      paymentSignal("payout.worker.iteration_failed", "error");
      await delay(5000);
    }
  } while (!stopping);
}

main()
  .catch(() => {
    paymentSignal("payout.worker.failed", "error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushPaymentMonitoring();
    await sqlClient.end();
  });
