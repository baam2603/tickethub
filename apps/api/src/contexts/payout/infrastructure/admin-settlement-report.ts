import { UnprocessableEntityException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import type {
  AdminSettlementExportQuery,
  ReportQuery,
} from "../domain/settlement-report-query";
import { db } from "../../../database/db";

export async function readAdminSettlementReport(
  query: ReportQuery,
  background = false,
) {
  const grouping = {
    day: sql`to_char(report_date, 'YYYY-MM-DD')`,
    category: sql`category`,
    city: sql`city`,
    organizer: sql`organizer_id::text`,
    provider: sql`provider`,
  }[query.groupBy];
  const maxRows = background ? 100_000 : 10_000;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        background
          ? sql`SET LOCAL statement_timeout = '60s'`
          : sql`SET LOCAL statement_timeout = '5s'`,
      );
      const items = Array.from(
        await tx.execute<{
          groupKey: string;
          paidRevenue: string;
          refundedAmount: string;
          netRevenue: string;
          refreshedAt: string;
        }>(sql`
    WITH facts AS (
      SELECT report_date, organizer_id, category, city, provider,
        paid_revenue, total_refunded_amount, net_revenue, refreshed_at
      FROM mv_admin_settlement_daily
      WHERE report_date BETWEEN ${query.fromDate}::date AND ${query.toDate}::date
        ${query.category ? sql`AND category = ${query.category}` : sql``}
        ${query.city ? sql`AND city = ${query.city}` : sql``}
        ${query.organizerId ? sql`AND organizer_id = ${query.organizerId}` : sql``}
    )
    SELECT ${grouping} AS "groupKey", sum(paid_revenue)::text AS "paidRevenue",
      sum(total_refunded_amount)::text AS "refundedAmount",
      sum(net_revenue)::text AS "netRevenue", max(refreshed_at)::text AS "refreshedAt"
    FROM facts ${query.provider ? sql`WHERE provider = ${query.provider}` : sql``}
    GROUP BY 1 ORDER BY 1 LIMIT ${maxRows + 1}
  `),
      );
      if (items.length > maxRows)
        throw new UnprocessableEntityException(
          background
            ? "REPORT_TOO_LARGE_NARROW_FILTERS"
            : "REPORT_REQUIRES_BACKGROUND_EXPORT",
        );
      return items;
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      !background &&
      [error, cause].some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "code" in value &&
          value.code === "57014",
      )
    )
      throw new UnprocessableEntityException(
        "REPORT_REQUIRES_BACKGROUND_EXPORT",
      );
    throw error;
  }
}

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^\s*[=+@-]|^[\t\r\n]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function toAdminSettlementCsv(
  items: Awaited<ReturnType<typeof readAdminSettlementReport>>,
) {
  return (
    "\uFEFF" +
    [
      "group_key,paid_revenue,refunded_amount,net_revenue,refreshed_at",
      ...items.map((row) =>
        [
          csvCell(row.groupKey),
          row.paidRevenue,
          row.refundedAmount,
          row.netRevenue,
          csvCell(row.refreshedAt),
        ].join(","),
      ),
    ].join("\r\n") +
    "\r\n"
  );
}

export async function renderAdminSettlementDownload(
  items: Awaited<ReturnType<typeof readAdminSettlementReport>>,
  format: AdminSettlementExportQuery["format"],
) {
  if (format === "csv") return Buffer.from(toAdminSettlementCsv(items));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("UC11");
  sheet.addRow([
    "group_key",
    "paid_revenue",
    "refunded_amount",
    "net_revenue",
    "refreshed_at",
  ]);
  for (const row of items) {
    // ExcelJS ghi string thành ô văn bản; giữ nguyên độ chính xác của số tiền.
    sheet.addRow([
      row.groupKey,
      row.paidRevenue,
      row.refundedAmount,
      row.netRevenue,
      row.refreshedAt,
    ]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
