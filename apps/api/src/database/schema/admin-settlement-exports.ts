import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { AdminSettlementExportQuery } from "../../contexts/payout/domain/settlement-report-query";
import { users } from "./users";

export const adminSettlementExports = pgTable(
  "admin_settlement_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    query: jsonb("query").$type<AdminSettlementExportQuery>().notNull(),
    status: varchar("status", { length: 20 })
      .$type<"PENDING" | "PROCESSING" | "COMPLETED" | "FAILED">()
      .notNull()
      .default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    claim: uuid("claim"),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    errorCode: varchar("error_code", { length: 80 }),
    content: text("content"),
  },
  (table) => [
    index("idx_admin_settlement_exports_available").on(
      table.status,
      table.availableAt,
    ),
    index("idx_admin_settlement_exports_owner").on(
      table.requestedBy,
      table.createdAt,
    ),
  ],
);
