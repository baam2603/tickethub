import { setTimeout as delay } from "node:timers/promises";
import { sqlClient } from "../database/db";
import { refreshReportViews } from "../reporting/report-data";
import {
  cleanupReportExports,
  processReportExport,
} from "../reporting/export-worker";
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});
async function main() {
  let refreshed = 0;
  do {
    if (Date.now() - refreshed >= 300000) {
      await refreshReportViews();
      await cleanupReportExports();
      refreshed = Date.now();
    }
    const processed = await processReportExport();
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
  .finally(() => sqlClient.end());
