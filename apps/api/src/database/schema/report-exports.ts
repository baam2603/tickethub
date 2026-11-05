import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { events } from "./events";
import { organizerProfiles } from "./organizer-profiles";
export const reportExports = pgTable(
  "report_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => organizerProfiles.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    format: varchar("format", { length: 10 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    attemptId: uuid("attempt_id"),
    fileName: varchar("file_name", { length: 100 }),
    retryCount: integer("retry_count").notNull().default(0),
    errorMessage: text("error_message"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_report_exports_pending").on(t.status, t.nextRetryAt)],
);
