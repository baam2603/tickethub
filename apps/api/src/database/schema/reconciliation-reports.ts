import {
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { ReconciliationItem } from "../../contexts/payout/domain/reconciliation-items";
import { events } from "./events";

export const reconciliationReports = pgTable("reconciliation_reports", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => events.id),
  sourceHash: varchar("source_hash", { length: 64 }).notNull(),
  ledgerHash: varchar("ledger_hash", { length: 64 }).notNull(),
  discrepancyCount: integer("discrepancy_count").notNull(),
  items: jsonb("items").$type<ReconciliationItem[]>().notNull(),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
