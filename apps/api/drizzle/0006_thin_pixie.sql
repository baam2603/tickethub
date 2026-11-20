CREATE TABLE "reconciliation_reports" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"ledger_hash" varchar(64) NOT NULL,
	"discrepancy_count" integer NOT NULL,
	"items" jsonb NOT NULL,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payouts_event_id" ON "payouts" USING btree ("event_id");