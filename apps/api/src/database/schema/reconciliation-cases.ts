import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { ReconciliationItem } from "../../payouts/reconciliation-items";
import { events } from "./events";
import { users } from "./users";

export const reconciliationCases = pgTable(
  "reconciliation_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    sourceHash: varchar("source_hash", { length: 64 }).notNull(),
    discrepancies: jsonb("discrepancies")
      .$type<ReconciliationItem[]>()
      .notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolution: text("resolution"),
  },
  (table) => [
    index("idx_reconciliation_cases_event_open").on(
      table.eventId,
      table.resolvedAt,
    ),
  ],
);
