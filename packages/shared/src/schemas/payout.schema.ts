import { z } from "zod";

export const ReconciliationStatus = {
  MATCHED: "MATCHED",
  AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
  MISSING_TRANSACTION: "MISSING_TRANSACTION",
  ORPHAN_TRANSACTION: "ORPHAN_TRANSACTION",
} as const;

export type ReconciliationStatus =
  (typeof ReconciliationStatus)[keyof typeof ReconciliationStatus];

export const ReconciliationStatusEnum = [
  "MATCHED",
  "AMOUNT_MISMATCH",
  "MISSING_TRANSACTION",
  "ORPHAN_TRANSACTION",
] as const;

export const ReconciliationQuerySchema = z.object({
  eventId: z.string().uuid().optional(),
  status: z
    .enum(["ALL", ...ReconciliationStatusEnum])
    .optional()
    .default("ALL"),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ReconciliationQueryDto = z.infer<typeof ReconciliationQuerySchema>;

export const GeneratePayoutSchema = z.object({
  eventId: z.string().uuid("Mã sự kiện không hợp lệ"),
});

export type GeneratePayoutDto = z.infer<typeof GeneratePayoutSchema>;

export const HoldPayoutSchema = z.object({
  reason: z.string().min(1, "Lý do tạm giữ không được để trống").max(500),
});

export type HoldPayoutDto = z.infer<typeof HoldPayoutSchema>;

export const PayoutFilterQuerySchema = z.object({
  status: z.enum(["PENDING", "HOLD", "PAID_OUT"]).optional(),
  organizerId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type PayoutFilterQueryDto = z.infer<typeof PayoutFilterQuerySchema>;

export const OrganizerPayoutQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type OrganizerPayoutQueryDto = z.infer<typeof OrganizerPayoutQuerySchema>;

export const ApprovePayoutResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("PAID_OUT"),
  approvedBy: z.string().uuid(),
  paidOutAt: z.string(),
  message: z.string(),
});

export type ApprovePayoutResponseDto = z.infer<
  typeof ApprovePayoutResponseSchema
>;

