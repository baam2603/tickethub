import {
  pgTable,
  uuid,
  varchar,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { TransactionStatus, PaymentProvider } from "@tickethub/shared";
import { orders } from "./orders";

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  provider: varchar("provider", { length: 20 })
    .notNull()
    .default(PaymentProvider.VNPAY),
  transactionRef: varchar("transaction_ref", { length: 100 })
    .notNull()
    .unique(),
  providerTxNumber: varchar("provider_tx_number", { length: 100 }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  responseCode: varchar("response_code", { length: 10 }),
  bankCode: varchar("bank_code", { length: 20 }),
  vnpCreateDate: varchar("vnp_create_date", { length: 14 }),
  paymentUrl: varchar("payment_url", { length: 4000 }),
  payDate: timestamp("pay_date", { withTimezone: true }),
  status: varchar("status", { length: 20 })
    .notNull()
    .default(TransactionStatus.PENDING)
    .$type<TransactionStatus>(),
  rawCallback: jsonb("raw_callback"),
  idempotencyKey: varchar("idempotency_key", { length: 100 })
    .notNull()
    .unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
