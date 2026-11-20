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
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_settlement_exports" ADD CONSTRAINT "admin_settlement_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reconciliation_cases_event_open" ON "reconciliation_cases" USING btree ("event_id","resolved_at");--> statement-breakpoint
CREATE INDEX "idx_admin_settlement_exports_available" ON "admin_settlement_exports" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "idx_admin_settlement_exports_owner" ON "admin_settlement_exports" USING btree ("requested_by","created_at");
--> statement-breakpoint
INSERT INTO reconciliation_cases (event_id, source_hash, discrepancies, opened_at)
SELECT report.event_id, report.source_hash,
  COALESCE((SELECT jsonb_agg(item ORDER BY ordinality)
            FROM jsonb_array_elements(report.items) WITH ORDINALITY AS entries(item, ordinality)
            WHERE item->>'issue' IS NOT NULL), '[]'::jsonb),
  report.reconciled_at
FROM reconciliation_reports report
WHERE report.discrepancy_count > 0;
