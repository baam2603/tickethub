import {
  type AnyPgColumn,
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { RefundStatus } from "@tickethub/shared";
import { orders } from "./orders";
import { tickets } from "./tickets";

export const refunds = pgTable("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  ticketId: uuid("ticket_id").references(() => tickets.id),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 20 })
    .notNull()
    .default(RefundStatus.PENDING)
    .$type<RefundStatus>(),
  providerRequestId: varchar("provider_request_id", { length: 32 }).unique(),
  providerGroupId: uuid("provider_group_id").references(
    (): AnyPgColumn => refunds.id,
  ),
  providerAmount: numeric("provider_amount", { precision: 14, scale: 2 }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  providerRefundRef: varchar("provider_refund_ref", { length: 100 }),
  idempotencyKey: varchar("idempotency_key", { length: 100 })
    .notNull()
    .unique(),
  retryCount: integer("retry_count").notNull().default(0),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
