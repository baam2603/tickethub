import { z } from "zod";
import { RefundPolicyType } from "../constants/enums";

export const RefundPreviewRequestSchema = z.object({
  orderId: z.string().uuid(),
  ticketIds: z.array(z.string().uuid()).min(1),
});
export type RefundPreviewRequest = z.infer<typeof RefundPreviewRequestSchema>;

export const RefundPreviewItemSchema = z.object({
  ticketId: z.string().uuid(),
  ticketCode: z.string(),
  seatLabel: z.string(),
  originalPrice: z.number().int().nonnegative(),
  effectivePaidPrice: z.number().int().nonnegative(),
  refundAmount: z.number().int().nonnegative(),
  feeDeducted: z.number().int().nonnegative(),
});
export type RefundPreviewItem = z.infer<typeof RefundPreviewItemSchema>;

export const RefundPreviewResponseSchema = z.object({
  orderId: z.string().uuid(),
  policyType: z.enum([
    RefundPolicyType.FLEXIBLE,
    RefundPolicyType.STRICT,
    RefundPolicyType.NO_REFUND,
    RefundPolicyType.CUSTOM,
  ]),
  daysUntilEvent: z.number(),
  refundPercentage: z.number().min(0).max(100),
  items: z.array(RefundPreviewItemSchema),
  totalRefundAmount: z.number().int().nonnegative(),
  totalFeeDeducted: z.number().int().nonnegative(),
});
export type RefundPreviewResponse = z.infer<typeof RefundPreviewResponseSchema>;

export const RefundExecuteRequestSchema = z.object({
  orderId: z.string().uuid(),
  ticketIds: z.array(z.string().uuid()).min(1),
  reason: z.string().min(1).max(500),
});
export type RefundExecuteRequest = z.infer<typeof RefundExecuteRequestSchema>;

export const RefundExecuteResponseSchema = z.object({
  refundId: z.string().uuid(),
  refundIds: z.array(z.string().uuid()),
  orderId: z.string().uuid(),
  status: z.string(),
  refundAmount: z.number().int().nonnegative(),
  cancelledTicketCount: z.number().int().positive(),
  orderStatus: z.string(),
});
export type RefundExecuteResponse = z.infer<typeof RefundExecuteResponseSchema>;
