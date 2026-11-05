import { z } from "zod";

export const GetTicketQrResponseSchema = z.object({
  ticketId: z.string().uuid(),
  qrToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  remainingSeconds: z.number().int().nonnegative(),
});
export type GetTicketQrResponse = z.infer<typeof GetTicketQrResponseSchema>;

export const GateScanRequestSchema = z.object({
  qrToken: z.string().min(1),
  gateId: z.string().uuid().optional(),
});
export type GateScanRequest = z.infer<typeof GateScanRequestSchema>;

export const GateScanResponseSchema = z.object({
  ticketId: z.string().uuid(),
  ticketCode: z.string(),
  status: z.string(),
  eventTitle: z.string(),
  ticketTypeName: z.string(),
  zoneName: z.string().optional(),
  seatLabel: z.string().optional(),
  isSeated: z.boolean(),
  buyerName: z.string(),
  checkedInAt: z.string().datetime(),
  gateId: z.string().uuid().optional(),
  staffId: z.string().uuid(),
});
export type GateScanResponse = z.infer<typeof GateScanResponseSchema>;

export const GateLookupRequestSchema = z.object({
  eventId: z.string().uuid(),
  ticketCode: z.string().min(1),
  phoneOrEmailLast4: z.string().length(4),
  reason: z.string().min(1).max(500),
  gateId: z.string().uuid().optional(),
});
export type GateLookupRequest = z.infer<typeof GateLookupRequestSchema>;

export const GateLookupResponseSchema = GateScanResponseSchema.extend({
  method: z.literal("MANUAL_LOOKUP"),
});
export type GateLookupResponse = z.infer<typeof GateLookupResponseSchema>;
