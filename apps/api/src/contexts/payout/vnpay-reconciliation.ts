import { open } from "node:fs/promises";
import { GeneratePayoutSchema } from "@tickethub/shared";
import { HttpException } from "@nestjs/common";
import { sqlClient } from "../../database/db";
import { ReconciliationsService } from "./infrastructure/reconciliations.service";
import {
  flushPaymentMonitoring,
  initializePaymentMonitoring,
  paymentSignal,
} from "../../shared-kernel/payment-monitoring";
import { MAX_REPORT_BYTES } from "./infrastructure/vnpay-report";

async function main() {
  initializePaymentMonitoring();
  const [, , eventId, path, ...extra] = process.argv;
  if (
    !GeneratePayoutSchema.safeParse({ eventId }).success ||
    !eventId ||
    !path ||
    extra.length
  ) {
    throw new Error("Usage: pnpm reconcile:vnpay <eventId> <csvPath>");
  }
  const file = await open(path, "r");
  let csv: string;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES)
      throw new Error("Invalid reconciliation file");
    const buffer = Buffer.alloc(MAX_REPORT_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await file.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
      );
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > MAX_REPORT_BYTES)
      throw new Error("Reconciliation file too large");
    csv = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      buffer.subarray(0, bytesRead),
    );
  } finally {
    await file.close();
  }
  const result = await new ReconciliationsService().importReport(eventId, csv);
  const message = JSON.stringify({
    event: "vnpay.reconciliation.completed",
    ...result,
  });
  console.log(message);
  if (result.discrepancyCount) {
    if (!result.reused)
      paymentSignal("vnpay.reconciliation.discrepancy", "warning", {
        eventId: result.eventId,
        discrepancyCount: result.discrepancyCount,
        ...(result.investigationId
          ? { investigationId: result.investigationId }
          : {}),
      });
    process.exitCode = 2;
  }
}

main()
  .catch((error: unknown) => {
    paymentSignal("vnpay.reconciliation.failed", "error", {
      reason:
        error instanceof HttpException
          ? error.message
          : "CHECK_INPUT_OR_DATABASE",
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushPaymentMonitoring();
    await sqlClient.end();
  });
