CREATE TABLE "organizer_staff" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"organizer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_checkin_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"ticket_id" uuid,
	"gate_id" uuid,
	"staff_id" uuid NOT NULL,
	"method" varchar(20) NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"reason" text,
	"error_code" varchar(100),
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"format" varchar(10) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"attempt_id" uuid,
	"file_name" varchar(100),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizer_staff" ADD CONSTRAINT "organizer_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_staff" ADD CONSTRAINT "organizer_staff_organizer_id_organizer_profiles_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_organizer_id_organizer_profiles_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_organizer_staff_owner" ON "organizer_staff" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "idx_gate_logs_event_time" ON "gate_checkin_logs" USING btree ("event_id","checked_in_at");--> statement-breakpoint
CREATE INDEX "idx_report_exports_pending" ON "report_exports" USING btree ("status","next_retry_at");--> statement-breakpoint
-- Chi nhan quyen so huu nhan vien cu khi tat ca phan cong cung mot BTC.
INSERT INTO organizer_staff(user_id, organizer_id)
SELECT es.user_id, min(e.organizer_id::text)::uuid
FROM event_staff es JOIN events e ON e.id=es.event_id JOIN users u ON u.id=es.user_id
WHERE u.role='GATE_STAFF'
GROUP BY es.user_id HAVING count(DISTINCT e.organizer_id)=1
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION prevent_gate_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'gate_checkin_logs is append-only'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER immutable_gate_checkin_logs BEFORE UPDATE OR DELETE ON gate_checkin_logs
FOR EACH ROW EXECUTE FUNCTION prevent_gate_log_mutation();
--> statement-breakpoint
-- Aggregate tung nguon truoc khi join de tranh nhan doanh thu theo so ve/hoan tien.
CREATE MATERIALIZED VIEW mv_event_sales_summary AS
WITH revenue AS (
 SELECT event_id, sum(total_amount) AS gross_revenue, sum(final_amount) AS paid_revenue
 FROM orders WHERE status IN ('PAID','REFUNDED') OR paid_at IS NOT NULL GROUP BY event_id
), refunded AS (
 SELECT o.event_id, sum(r.amount) AS total_refunded_amount
 FROM refunds r JOIN orders o ON o.id=r.order_id WHERE r.status='COMPLETED' GROUP BY o.event_id
), ticket_counts AS (
 SELECT event_id,
 count(*) FILTER(WHERE status IN ('SOLD','CHECKED_IN')) AS total_sold_tickets,
 count(*) FILTER(WHERE status='CHECKED_IN') AS total_checked_in_tickets,
 count(*) FILTER(WHERE status='CANCELLED') AS total_cancelled_tickets
 FROM tickets GROUP BY event_id
)
SELECT e.id AS event_id,e.organizer_id,e.title,
 COALESCE(t.total_sold_tickets,0) AS total_sold_tickets,
 COALESCE(t.total_checked_in_tickets,0) AS total_checked_in_tickets,
 COALESCE(t.total_cancelled_tickets,0) AS total_cancelled_tickets,
 COALESCE(r.gross_revenue,0)::numeric AS gross_revenue,
 COALESCE(r.paid_revenue,0)::numeric AS paid_revenue,
 COALESCE(f.total_refunded_amount,0)::numeric AS total_refunded_amount,
 (COALESCE(r.paid_revenue,0)-COALESCE(f.total_refunded_amount,0))::numeric AS net_revenue,
 CASE WHEN COALESCE(t.total_sold_tickets,0)=0 THEN 0 ELSE round(t.total_checked_in_tickets::numeric*100/t.total_sold_tickets,2) END AS checkin_percentage,
 now() AS refreshed_at
FROM events e LEFT JOIN revenue r ON r.event_id=e.id LEFT JOIN refunded f ON f.event_id=e.id LEFT JOIN ticket_counts t ON t.event_id=e.id;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_mv_event_sales_id ON mv_event_sales_summary(event_id);
--> statement-breakpoint
CREATE MATERIALIZED VIEW mv_event_ticket_sales AS
SELECT e.id AS event_id,e.organizer_id,tt.id AS ticket_type_id,tt.name AS ticket_type_name,
 to_char(COALESCE(o.paid_at,o.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS sale_date,
 count(*) FILTER(WHERE t.status IN ('SOLD','CHECKED_IN')) AS total_sold_tickets,
 count(*) FILTER(WHERE t.status='CHECKED_IN') AS total_checked_in_tickets,
 round(COALESCE(sum(oi.unit_price*o.final_amount/NULLIF(o.total_amount,0)),0),2) AS paid_revenue,
 now() AS refreshed_at
FROM tickets t JOIN orders o ON o.id=t.order_id JOIN events e ON e.id=t.event_id JOIN ticket_types tt ON tt.id=t.ticket_type_id
LEFT JOIN LATERAL (
 SELECT item.unit_price FROM order_items item WHERE item.order_id=o.id AND item.ticket_type_id=t.ticket_type_id
 AND (item.seat_id=t.seat_id OR (item.seat_id IS NULL AND t.seat_id IS NULL)) ORDER BY item.id LIMIT 1
) oi ON true
WHERE o.status IN ('PAID','REFUNDED') OR o.paid_at IS NOT NULL
GROUP BY e.id,e.organizer_id,tt.id,tt.name,to_char(COALESCE(o.paid_at,o.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD');
--> statement-breakpoint
CREATE UNIQUE INDEX idx_mv_ticket_sales_day ON mv_event_ticket_sales(event_id,ticket_type_id,sale_date);
