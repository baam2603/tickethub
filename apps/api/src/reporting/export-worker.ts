import { HttpException } from "@nestjs/common";
import { and, asc, eq, lte, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, rename } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { db } from "../database/db";
import {
  reportExports,
  events,
  organizerProfiles,
  users,
  outbox,
} from "../database/schema";
import { REPORT_READY } from "./report-notifications";
import { readReport, refreshReportViews } from "./report-data";
import { exportFilePath, reportDirectory } from "./export-files";
function csvCell(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function processReportExport(targetId?: string) {
  const job = await db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(reportExports)
      .where(
        and(
          targetId ? eq(reportExports.id, targetId) : undefined,
          lte(reportExports.nextRetryAt, new Date()),
          or(
            eq(reportExports.status, "PENDING"),
            and(
              eq(reportExports.status, "PROCESSING"),
              lte(reportExports.updatedAt, new Date(Date.now() - 300000)),
            ),
          ),
        ),
      )
      .orderBy(asc(reportExports.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!found) return null;
    const [claimed] = await tx
      .update(reportExports)
      .set({
        status: "PROCESSING",
        attemptId: randomUUID(),
        updatedAt: new Date(),
      })
      .where(eq(reportExports.id, found.id))
      .returning();
    return claimed!;
  });
  if (!job) return false;
  let written: string | undefined;
  try {
    const owner = await db
      .select({ id: events.id })
      .from(events)
      .innerJoin(
        organizerProfiles,
        eq(organizerProfiles.id, events.organizerId),
      )
      .innerJoin(users, eq(users.id, organizerProfiles.userId))
      .where(
        and(
          eq(events.id, job.eventId),
          eq(events.organizerId, job.organizerId),
          eq(users.id, job.requestedBy),
          eq(users.role, "ORGANIZER"),
          eq(users.status, "ACTIVE"),
          eq(organizerProfiles.status, "VERIFIED"),
        ),
      );
    if (!owner.length) throw new Error("REPORT_ACCESS_REVOKED");
    const period = {
      ticketTypeId: job.ticketTypeId ?? undefined,
      voucherCode: job.voucherCode ?? undefined,
      fromDate: job.fromDate ?? undefined,
      toDate: job.toDate ?? undefined,
    };
    let report = await readReport(job.eventId, job.organizerId, period, 100000);
    if (!report.summary) {
      await refreshReportViews();
      report = await readReport(job.eventId, job.organizerId, period, 100000);
    }
    if (!report.summary) throw new Error("REPORT_NOT_REFRESHED");
    const summary = report.summary;
    const rows: unknown[][] = [
      [
        "record_type",
        "event_title",
        "ticket_type",
        "sale_date",
        "sold_tickets",
        "checked_in_tickets",
        "gross_revenue",
        "paid_revenue",
        "refunded_amount",
        "net_revenue",
        "refreshed_at",
        "from_date",
        "to_date",
        "timezone",
        "refund_basis",
        "ticket_type_id_filter",
        "voucher_code_filter",
      ],
      [
        "SUMMARY",
        summary.title,
        "",
        "",
        summary.total_sold_tickets,
        summary.total_checked_in_tickets,
        summary.gross_revenue,
        summary.paid_revenue,
        summary.total_refunded_amount,
        summary.net_revenue,
        summary.refreshed_at,
        job.fromDate ?? "",
        job.toDate ?? "",
        "Asia/Ho_Chi_Minh",
        "COMPLETION_DATE",
        job.ticketTypeId ?? "",
        job.voucherCode ?? "",
      ],
      ...report.sales.map((row) => [
        "TICKET_TYPE_DAY",
        summary.title,
        row.ticket_type_name,
        row.sale_date,
        row.total_sold_tickets,
        row.total_checked_in_tickets,
        "",
        row.paid_revenue,
        "",
        "",
        row.refreshed_at,
        job.fromDate ?? "",
        job.toDate ?? "",
        "Asia/Ho_Chi_Minh",
        "COMPLETION_DATE",
        job.ticketTypeId ?? "",
        job.voucherCode ?? "",
      ]),
    ];
    let data: Buffer;
    if (job.format === "csv")
      data = Buffer.from(
        "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
        "utf8",
      );
    else if (job.format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("UC09");
      for (const row of rows)
        sheet.addRow(
          row.map((value) =>
            value instanceof Date
              ? value.toISOString()
              : value == null
                ? ""
                : String(value),
          ),
        );
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      data = Buffer.from(await workbook.xlsx.writeBuffer());
    } else throw new Error("INVALID_EXPORT_FORMAT");
    const directory = reportDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const name = `${job.id}-${job.attemptId}.${job.format}`;
    const temp = join(directory, `${job.id}-${job.attemptId}.tmp`);
    try {
      await writeFile(temp, data, { flag: "wx", mode: 0o600 });
      await rename(temp, exportFilePath(name));
    } finally {
      await unlink(temp).catch(() => {});
    }
    written = name;
    const updated = await db.transaction(async (tx) => {
      const updated = await tx
        .update(reportExports)
        .set({
          status: "COMPLETED",
          fileName: name,
          errorMessage: null,
          expiresAt: new Date(Date.now() + 86400000),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reportExports.id, job.id),
            eq(reportExports.attemptId, job.attemptId!),
            eq(reportExports.status, "PROCESSING"),
          ),
        )
        .returning();
      if (updated.length)
        await tx
          .insert(outbox)
          .values({
            id: job.id,
            eventType: REPORT_READY,
            payload: { exportId: job.id },
          })
          .onConflictDoNothing();
      return updated;
    });
    if (!updated.length) await unlink(exportFilePath(name)).catch(() => {});
  } catch (error) {
    if (written) await unlink(exportFilePath(written)).catch(() => {});
    const retry = job.retryCount + 1;
    const response =
      error instanceof HttpException ? error.getResponse() : null;
    const tooLarge =
      response !== null &&
      typeof response === "object" &&
      "code" in response &&
      response.code === "REPORT_TOO_LARGE";
    const code = tooLarge ? "REPORT_TOO_LARGE" : "EXPORT_FAILED";
    await db
      .update(reportExports)
      .set({
        status: tooLarge || retry >= 3 ? "FAILED" : "PENDING",
        retryCount: retry,
        errorMessage: code,
        nextRetryAt: new Date(Date.now() + 2000 * 2 ** retry),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reportExports.id, job.id),
          eq(reportExports.attemptId, job.attemptId!),
        ),
      );
  }
  return true;
}
export async function cleanupReportExports() {
  const expired = await db
    .select()
    .from(reportExports)
    .where(
      and(
        eq(reportExports.status, "COMPLETED"),
        lte(reportExports.expiresAt, new Date()),
      ),
    )
    .limit(100);
  for (const job of expired) {
    if (job.fileName)
      await unlink(exportFilePath(job.fileName)).catch((e: unknown) => {
        if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT"))
          throw e;
      });
    await db
      .update(reportExports)
      .set({ status: "EXPIRED", fileName: null, updatedAt: new Date() })
      .where(eq(reportExports.id, job.id));
  }
}
