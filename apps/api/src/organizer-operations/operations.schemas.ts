import { z } from "zod";
export const StaffCreateSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(255)
      .transform((s) => s.toLowerCase()),
    fullName: z.string().trim().min(1).max(150),
    password: z.string().min(12).max(128),
    phone: z.string().trim().max(20).optional(),
  })
  .strict();
export const StaffUpdateSchema = z
  .object({
    fullName: z.string().trim().min(1).max(150).optional(),
    phone: z.string().trim().max(20).optional(),
    status: z.enum(["ACTIVE", "LOCKED"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const PageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const GateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    locationDesc: z.string().trim().max(255).optional(),
  })
  .strict();
export const AssignmentSchema = z
  .object({ userId: z.string().uuid(), gateId: z.string().uuid() })
  .strict();
// Ngay lich Viet Nam, hai dau bao gom tron ngay. Khong chap nhan ngay tu dong rollover.
const ReportDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      value >= "0001-01-01" &&
      value <= "9999-12-31" &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
  );
const periodFields = {
  ticketTypeId: z.string().uuid().optional(),
  voucherCode: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .transform((value) => value.toUpperCase())
    .optional(),
  fromDate: ReportDateSchema.optional(),
  toDate: ReportDateSchema.optional(),
};
const validPeriod = (value: {
  fromDate?: string | undefined;
  toDate?: string | undefined;
}) =>
  Boolean(value.fromDate) === Boolean(value.toDate) &&
  (!value.fromDate || value.fromDate <= value.toDate!);
export const ReportPeriodSchema = z
  .object(periodFields)
  .strict()
  .refine(validPeriod, {
    message: "Cung cap ca fromDate va toDate, fromDate khong sau toDate",
  });
export const ExportSchema = z
  .object({ format: z.enum(["csv", "xlsx"]), ...periodFields })
  .strict()
  .refine(validPeriod);
export const ReportListSchema =
  PageSchema.extend(periodFields).refine(validPeriod);
export const GatePageSchema = PageSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
export type ReportPeriod = z.infer<typeof ReportPeriodSchema>;
export function paginated<T>(rows: T[], page: Page) {
  return {
    data: rows.slice(0, page.limit),
    meta: {
      page: page.page,
      limit: page.limit,
      hasMore: rows.length > page.limit,
    },
  };
}
export type StaffCreate = z.infer<typeof StaffCreateSchema>;
export type StaffUpdate = z.infer<typeof StaffUpdateSchema>;
export type Page = z.infer<typeof PageSchema>;
