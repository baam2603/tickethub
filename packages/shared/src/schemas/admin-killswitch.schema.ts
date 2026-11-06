import { z } from "zod";

export const EventKillSwitchRequestSchema = z.object({
  reason: z
    .string()
    .min(5, "Lý do ngắt khẩn cấp phải có ít nhất 5 ký tự")
    .max(500, "Lý do ngắt khẩn cấp không được vượt quá 500 ký tự"),
  version: z.number().int().positive().optional(),
});
export type EventKillSwitchRequest = z.infer<
  typeof EventKillSwitchRequestSchema
>;

export const EventResumeRequestSchema = z.object({
  reason: z
    .string()
    .min(5, "Lý do khôi phục sự kiện phải có ít nhất 5 ký tự")
    .max(500, "Lý do khôi phục sự kiện không được vượt quá 500 ký tự")
    .optional(),
  version: z.number().int().positive().optional(),
});
export type EventResumeRequest = z.infer<typeof EventResumeRequestSchema>;

export const AuditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().optional(),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

export interface EventKillSwitchData {
  eventId: string;
  status: string;
  rejectionReason: string;
  version: number;
  cancelledPendingOrdersCount: number;
  releasedHeldSeatsCount: number;
  releasedHeldStandingCount: number;
  totalReleasedHoldsCount: number;
  suspendedAt: string;
}

export interface EventResumeData {
  eventId: string;
  status: string;
  version: number;
  resumedAt: string;
}

export interface AuditLogItem {
  id: number;
  actorId: string | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  changes: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogListData {
  items: AuditLogItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
