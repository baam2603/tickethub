import { setTimeout as delay } from "node:timers/promises";
import { processPayoutApprovalRetry } from "./payout-approval.worker";
import {
  flushPaymentMonitoring,
  initializePaymentMonitoring,
} from "../monitoring/payment-monitoring";
import { sqlClient } from "../database/db";
import {
  cleanupAdminSettlementExports,
  processAdminSettlementExport,
} from "../reporting/admin-settlement-exports";
import { refreshReportViews } from "../reporting/report-data";
import {
  cleanupReportExports,
  processReportExport,
} from "../reporting/export-worker";
import { processReportNotification } from "../reporting/report-notifications";
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});
async function main() {
  initializePaymentMonitoring();
  let refreshed = 0;
  do {
    let processed: boolean;
    try {
      processed = await processPayoutApprovalRetry();
      if (Date.now() - refreshed >= 300000) {
        if (await refreshReportViews()) refreshed = Date.now();
        await cleanupReportExports();
        await cleanupAdminSettlementExports();
      }
      processed = (await processReportExport()) || processed;
      processed = (await processAdminSettlementExport()) || processed;
      // Loi cau hinh/provider thong bao khong chan xu ly file tiep theo.
      try {
        processed = (await processReportNotification()) || processed;
      } catch {
        console.error(
          "Report email delivery is unavailable; check configuration.",
        );
      }
    } catch (error: unknown) {
      console.error(
        "Report worker iteration failed",
        error instanceof Error ? error.message : "Unknown error",
      );
      if (process.argv.includes("--once")) throw error;
      // Loi DB tam thoi khong lam chet worker; backoff truoc khi thu lai.
      await delay(5000);
      continue;
    }
    if (process.argv.includes("--once")) break;
    if (!processed) await delay(1000);
  } while (!stopping);
}
main()
  .catch((error: unknown) => {
    console.error(
      "Report worker failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushPaymentMonitoring();
    await sqlClient.end();
  });
