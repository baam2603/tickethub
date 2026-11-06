import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { EventStatus, RefundPolicyType } from "@tickethub/shared";
import { organizerProfiles } from "./organizer-profiles";
import { venues } from "./venues";
import { venueLayouts } from "./venue-layouts";
const tsVector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => organizerProfiles.id),
    venueId: uuid("venue_id").references(() => venues.id),
    venueLayoutId: uuid("venue_layout_id").references(() => venueLayouts.id),
    title: varchar("title", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    description: text("description").notNull(),
    searchVector: tsVector("search_vector"),
    category: varchar("category", { length: 50 }).notNull(),
    bannerUrl: varchar("banner_url", { length: 500 }).notNull(),
    venueName: varchar("venue_name", { length: 255 }).notNull(),
    venueAddress: text("venue_address").notNull(),
    city: varchar("city", { length: 100 }).notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    gateOpeningTime: timestamp("gate_opening_time", {
      withTimezone: true,
    }).notNull(),
    status: varchar("status", { length: 25 })
      .notNull()
      .default(EventStatus.DRAFT)
      .$type<EventStatus>(),
    rejectionReason: text("rejection_reason"),
    refundPolicyType: varchar("refund_policy_type", { length: 25 })
      .notNull()
      .default(RefundPolicyType.FLEXIBLE)
      .$type<RefundPolicyType>(),
    refundPolicyRules: jsonb("refund_policy_rules").notNull().default([]),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_events_search_filters").on(
      table.city,
      table.category,
      table.startTime,
      table.status,
    ),
  ],
);
