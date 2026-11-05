import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Giu ID lich su nhu audit_log; khong cascade sua/xoa log khi tai nguyen thay doi.
export const gateCheckinLogs = pgTable(
  "gate_checkin_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id"),
    ticketId: uuid("ticket_id"),
    gateId: uuid("gate_id"),
    staffId: uuid("staff_id").notNull(),
    method: varchar("method", { length: 20 }).notNull(),
    outcome: varchar("outcome", { length: 20 }).notNull(),
    reason: text("reason"),
    errorCode: varchar("error_code", { length: 100 }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_gate_logs_event_time").on(t.eventId, t.checkedInAt)],
);
