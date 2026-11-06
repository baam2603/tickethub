import {
  pgTable,
  uuid,
  varchar,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { OrderStatus } from "@tickethub/shared";
import { users } from "./users";
import { events } from "./events";

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderCode: varchar("order_code", { length: 32 }).notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
    discountAmount: numeric("discount_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    finalAmount: numeric("final_amount", { precision: 14, scale: 2 }).notNull(),
    status: varchar("status", { length: 32 })
      .notNull()
      .default(OrderStatus.PENDING)
      .$type<OrderStatus>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voucherCode: varchar("voucher_code", { length: 50 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_orders_user_pending").on(
      table.userId,
      table.eventId,
      table.status,
    ),
  ],
);
