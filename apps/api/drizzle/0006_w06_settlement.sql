CREATE TABLE "admin_settlement_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"query" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim" uuid,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" varchar(80),
	"content" text
);
--> statement-breakpoint
CREATE TABLE "reconciliation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"discrepancies" jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "reconciliation_reports" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"ledger_hash" varchar(64) NOT NULL,
	"discrepancy_count" integer NOT NULL,
	"items" jsonb NOT NULL,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_settlement_exports" ADD CONSTRAINT "admin_settlement_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_settlement_exports_available" ON "admin_settlement_exports" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "idx_admin_settlement_exports_owner" ON "admin_settlement_exports" USING btree ("requested_by","created_at");--> statement-breakpoint
CREATE INDEX "idx_reconciliation_cases_event_open" ON "reconciliation_cases" USING btree ("event_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payouts_event_id" ON "payouts" USING btree ("event_id");
--> statement-breakpoint
-- Independent aggregate for UC11. Payment and refund movements are each counted once.
CREATE MATERIALIZED VIEW mv_admin_settlement_daily AS
WITH order_provider AS (
  SELECT o.id, o.event_id, o.status, o.paid_at, o.created_at, o.final_amount,
    CASE WHEN EXISTS (
      SELECT 1 FROM transactions t WHERE t.order_id = o.id AND t.provider = 'VNPAY' AND t.status = 'SUCCESS'
    ) THEN 'VNPAY' ELSE 'UNATTRIBUTED' END AS provider
  FROM orders o
), movements AS (
  SELECT event_id, provider,
    (coalesce(paid_at, created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS report_date,
    final_amount AS paid, 0::numeric AS refunded
  FROM order_provider
  WHERE paid_at IS NOT NULL OR status IN ('PAID','REFUNDED','PAYMENT_EXPIRED_REFUND_PENDING')
  UNION ALL
  SELECT o.event_id, o.provider,
    (coalesce(r.processed_at, r.updated_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS report_date,
    0::numeric, r.amount
  FROM refunds r JOIN order_provider o ON o.id = r.order_id
  WHERE r.status = 'COMPLETED'
)
SELECT m.event_id, m.report_date, m.provider, e.organizer_id, e.category, e.city,
  sum(m.paid) AS paid_revenue, sum(m.refunded) AS total_refunded_amount,
  sum(m.paid) - sum(m.refunded) AS net_revenue, now() AS refreshed_at
FROM movements m JOIN events e ON e.id = m.event_id
GROUP BY m.event_id, m.report_date, m.provider, e.organizer_id, e.category, e.city;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_mv_admin_settlement_daily_grain
  ON mv_admin_settlement_daily(report_date, event_id, provider);
