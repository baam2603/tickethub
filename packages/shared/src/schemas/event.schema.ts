import { z } from "zod";
import { RefundPolicyType } from "../constants/enums";

export const TicketTypeInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  price: z.number().min(0),
  capacity: z.number().int().positive(),
  isSeated: z.boolean().default(true),
  saleStartTime: z.string().datetime(),
  saleEndTime: z.string().datetime(),
  maxPerOrder: z.number().int().positive().default(6),
  sortOrder: z.number().int().default(0),
});
export type TicketTypeInput = z.infer<typeof TicketTypeInputSchema>;

export const CreateEventRequestSchema = z.object({
  title: z.string().min(3).max(255),
  slug: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().min(10),
  category: z.string().min(2).max(50),
  bannerUrl: z.string().url(),
  venueName: z.string().min(2).max(255),
  venueAddress: z.string().min(5),
  city: z.string().min(2).max(100),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  gateOpeningTime: z.string().datetime(),
  refundPolicyType: z
    .enum([
      RefundPolicyType.STRICT,
      RefundPolicyType.FLEXIBLE,
      RefundPolicyType.CUSTOM,
      RefundPolicyType.NO_REFUND,
    ])
    .default(RefundPolicyType.FLEXIBLE),
  refundPolicyRules: z.array(z.record(z.string(), z.unknown())).default([]),
  ticketTypes: z.array(TicketTypeInputSchema).min(1),
});
export type CreateEventRequest = z.infer<typeof CreateEventRequestSchema>;

export const EventFilterQuerySchema = z.object({
  keyword: z.string().optional(),
  city: z.string().optional(),
  category: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type EventFilterQuery = z.infer<typeof EventFilterQuerySchema>;

export const SearchQuerySchema = EventFilterQuerySchema.extend({
  keyword: z.string().trim().max(120).optional(),
  city: z.string().trim().max(100).optional(),
  category: z.string().trim().max(50).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
}).superRefine((query, ctx) => {
  if (
    query.minPrice !== undefined &&
    query.maxPrice !== undefined &&
    query.minPrice > query.maxPrice
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxPrice"],
      message: "maxPrice phai >= minPrice",
    });
  }

  if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toDate"],
      message: "Khoang ngay khong hop le",
    });
  }
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
