import { z } from "zod";

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
    format: z.enum(["json", "csv", "xlsx"]).default("json"),
  })
  .strict()
  .refine(
    ({ fromDate, toDate }) =>
      fromDate >= "0001-01-01" &&
      fromDate <= toDate &&
      Date.parse(toDate) - Date.parse(fromDate) <= 365 * 86_400_000,
    "REPORT_PERIOD_MUST_BE_AT_MOST_366_DAYS",
  );

export type ReportQuery = z.infer<typeof AdminSettlementReportQuery>;
export type AdminSettlementExportQuery = Omit<ReportQuery, "format"> & {
  format: "csv" | "xlsx";
};
