import { UnprocessableEntityException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database/db";
import { csvCell } from "./export-files";

export const AdminSettlementReportQuery = z
  .object({
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
    groupBy: z
      .enum(["day", "category", "city", "organizer", "provider"])
      .default("day"),
    category: z.string().trim().min(1).max(50).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    organizerId: z.uuid().optional(),
    provider: z.enum(["VNPAY", "UNATTRIBUTED"]).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict()
  .refine(
    ({ fromDate, toDate }) =>
      fromDate >= "0001-01-01" &&
      fromDate <= toDate &&
      Date.parse(toDate) - Date.parse(fromDate) <= 365 * 86_400_000,
    "REPORT_PERIOD_MUST_BE_AT_MOST_366_DAYS",
  );

type ReportQuery = z.infer<typeof AdminSettlementReportQuery>;

export async function readAdminSettlementReport(query: ReportQuery) {
  const grouping = {
    day: sql`to_char(report_date, 'YYYY-MM-DD')`,
    category: sql`category`,
    city: sql`city`,
    organizer: sql`organizer_id::text`,
    provider: sql`provider`,
  }[query.groupBy];
  const maxRows = 10_000;
  const items = Array.from(
    await db.execute<{
      groupKey: string;
      paidRevenue: string;
      refundedAmount: string;
      netRevenue: string;
      refreshedAt: string;
    }>(sql`
    WITH facts AS (
      SELECT f.report_date, f.organizer_id, e.category, e.city,
        CASE WHEN EXISTS (
          SELECT 1 FROM transactions t WHERE t.order_id = f.order_id AND t.provider = 'VNPAY' AND t.status = 'SUCCESS'
        ) THEN 'VNPAY' ELSE 'UNATTRIBUTED' END AS provider,
        f.paid_revenue, f.total_refunded_amount, f.net_revenue, f.refreshed_at
      FROM mv_event_report_facts f JOIN events e ON e.id = f.event_id
      WHERE f.report_date BETWEEN ${query.fromDate}::date AND ${query.toDate}::date
        ${query.category ? sql`AND e.category = ${query.category}` : sql``}
        ${query.city ? sql`AND e.city = ${query.city}` : sql``}
        ${query.organizerId ? sql`AND f.organizer_id = ${query.organizerId}` : sql``}
    )
    SELECT ${grouping} AS "groupKey", sum(paid_revenue)::text AS "paidRevenue",
      sum(total_refunded_amount)::text AS "refundedAmount",
      sum(net_revenue)::text AS "netRevenue", max(refreshed_at)::text AS "refreshedAt"
    FROM facts ${query.provider ? sql`WHERE provider = ${query.provider}` : sql``}
    GROUP BY 1 ORDER BY 1 LIMIT ${maxRows + 1}
  `),
  );
  if (items.length > maxRows)
    throw new UnprocessableEntityException("REPORT_TOO_LARGE_NARROW_FILTERS");
  return items;
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
