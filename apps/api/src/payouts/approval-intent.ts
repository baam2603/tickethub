import { z } from "zod";

export const PAYOUT_APPROVAL_RETRY = "PAYOUT_APPROVAL_RETRY";

export const ApprovalIntentSchema = z.object({
  payoutId: z.uuid(),
  adminUserId: z.uuid(),
  payoutVersion: z.iso.datetime(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  ledgerHash: z.string().regex(/^[a-f0-9]{64}$/),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

export type ApprovalIntent = z.infer<typeof ApprovalIntentSchema>;

export type ApprovalSnapshot = Pick<
  ApprovalIntent,
  "payoutVersion" | "ledgerHash" | "sourceHash"
>;
