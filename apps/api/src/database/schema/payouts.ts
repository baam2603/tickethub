import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { PayoutStatus } from "@tickethub/shared";
import { organizerProfiles } from "./organizer-profiles";
import { events } from "./events";
import { users } from "./users";

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => organizerProfiles.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    totalRevenue: numeric("total_revenue", {
      precision: 14,
      scale: 2,
    }).notNull(),
    platformFee: numeric("platform_fee", { precision: 14, scale: 2 }).notNull(),
    gatewayFee: numeric("gateway_fee", { precision: 14, scale: 2 }).notNull(),
    refundDeduction: numeric("refund_deduction", {
      precision: 14,
      scale: 2,
    }).notNull(),
    netPayout: numeric("net_payout", { precision: 14, scale: 2 }).notNull(),
    status: varchar("status", { length: 20 })
      .notNull()
      .default(PayoutStatus.PENDING)
      .$type<PayoutStatus>(),
    holdReason: text("hold_reason"),
    paidOutAt: timestamp("paid_out_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("uq_payouts_event_id").on(table.eventId)],
);
