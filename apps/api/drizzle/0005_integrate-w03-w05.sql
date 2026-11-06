-- Giu nguyen 0000-0004 cua unstable. Ho tro DB da chay W04/W05 cu bang DDL co kiem tra ton tai.
CREATE TABLE IF NOT EXISTS "organizer_staff" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"organizer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gate_checkin_logs" (
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
CREATE TABLE IF NOT EXISTS "report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"format" varchar(10) NOT NULL,
	"ticket_type_id" uuid,
	"voucher_code" varchar(50),
	"from_date" date,
	"to_date" date,
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
-- PostgreSQL khong cho doi kieu cot dang duoc MV tham chieu. Chi dung lai du lieu tong hop, khong xoa bang nghiep vu.
DO $$ BEGIN IF (SELECT character_maximum_length FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='status') IS DISTINCT FROM 32 THEN
DROP MATERIALIZED VIEW IF EXISTS mv_event_report_facts;
DROP MATERIALIZED VIEW IF EXISTS mv_event_report_daily;
DROP MATERIALIZED VIEW IF EXISTS mv_event_ticket_sales;
DROP MATERIALIZED VIEW IF EXISTS mv_event_sales_summary;
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE varchar(32);
END IF; END $$;
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING';
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "vnp_create_date" varchar(14);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "payment_url" varchar(4000);
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "provider_request_id" varchar(32);
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organizer_staff_user_id_users_id_fk' AND conrelid='public.organizer_staff'::regclass) THEN ALTER TABLE "organizer_staff" ADD CONSTRAINT "organizer_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organizer_staff_organizer_id_organizer_profiles_id_fk' AND conrelid='public.organizer_staff'::regclass) THEN ALTER TABLE "organizer_staff" ADD CONSTRAINT "organizer_staff_organizer_id_organizer_profiles_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizer_profiles"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='report_exports_requested_by_users_id_fk' AND conrelid='public.report_exports'::regclass) THEN ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='report_exports_organizer_id_organizer_profiles_id_fk' AND conrelid='public.report_exports'::regclass) THEN ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_organizer_id_organizer_profiles_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizer_profiles"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='report_exports_event_id_events_id_fk' AND conrelid='public.report_exports'::regclass) THEN ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_organizer_staff_owner" ON "organizer_staff" USING btree ("organizer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gate_logs_event_time" ON "gate_checkin_logs" USING btree ("event_id","checked_in_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_report_exports_pending" ON "report_exports" USING btree ("status","next_retry_at");
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='refunds_provider_request_id_unique' AND conrelid='public.refunds'::regclass) THEN ALTER TABLE "refunds" ADD CONSTRAINT "refunds_provider_request_id_unique" UNIQUE("provider_request_id"); END IF; END $$;
--> statement-breakpoint
-- Chi nhan quyen so huu nhan vien cu khi tat ca phan cong cung mot BTC.
INSERT INTO organizer_staff(user_id, organizer_id)
SELECT es.user_id, min(e.organizer_id::text)::uuid
FROM event_staff es JOIN events e ON e.id=es.event_id JOIN users u ON u.id=es.user_id
WHERE u.role='GATE_STAFF'
GROUP BY es.user_id HAVING count(DISTINCT e.organizer_id)=1
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_gate_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'gate_checkin_logs is append-only'; END;
$$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='immutable_gate_checkin_logs' AND tgrelid='public.gate_checkin_logs'::regclass) THEN CREATE TRIGGER immutable_gate_checkin_logs BEFORE UPDATE OR DELETE ON gate_checkin_logs
FOR EACH ROW EXECUTE FUNCTION prevent_gate_log_mutation(); END IF; END $$;
--> statement-breakpoint
-- Aggregate tung nguon truoc khi join de tranh nhan doanh thu theo so ve/hoan tien.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_event_sales_summary AS
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_event_sales_id ON mv_event_sales_summary(event_id);
--> statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_event_ticket_sales AS
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_ticket_sales_day ON mv_event_ticket_sales(event_id,ticket_type_id,sale_date);

--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='report_exports_period_check' AND conrelid='public.report_exports'::regclass) THEN
ALTER TABLE report_exports ADD CONSTRAINT report_exports_period_check CHECK ((from_date IS NULL AND to_date IS NULL) OR (from_date IS NOT NULL AND to_date IS NOT NULL AND from_date <= to_date)); END IF; END $$;
--> statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_event_report_daily AS
WITH movements AS (
 SELECT event_id, (COALESCE(paid_at,created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS report_date,
 sum(total_amount)::numeric AS gross_revenue, sum(final_amount)::numeric AS paid_revenue,
 0::numeric AS refunded_amount, 0::bigint AS sold, 0::bigint AS checked_in, 0::bigint AS cancelled
 FROM orders WHERE status IN ('PAID','REFUNDED') OR paid_at IS NOT NULL
 GROUP BY event_id,(COALESCE(paid_at,created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
 UNION ALL
 SELECT o.event_id,(COALESCE(r.processed_at,r.updated_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
 0,0,sum(r.amount),0,0,0 FROM refunds r JOIN orders o ON o.id=r.order_id
 WHERE r.status='COMPLETED'
 GROUP BY o.event_id,(COALESCE(r.processed_at,r.updated_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
 UNION ALL
 SELECT t.event_id,(COALESCE(o.paid_at,o.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
 0,0,0,count(*) FILTER(WHERE t.status IN ('SOLD','CHECKED_IN')),
 count(*) FILTER(WHERE t.status='CHECKED_IN'),count(*) FILTER(WHERE t.status='CANCELLED')
 FROM tickets t JOIN orders o ON o.id=t.order_id
 WHERE o.status IN ('PAID','REFUNDED') OR o.paid_at IS NOT NULL
 GROUP BY t.event_id,(COALESCE(o.paid_at,o.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
)
SELECT e.id AS event_id,e.organizer_id,m.report_date,
 sum(m.gross_revenue)::numeric AS gross_revenue,sum(m.paid_revenue)::numeric AS paid_revenue,
 sum(m.refunded_amount)::numeric AS total_refunded_amount,
 (sum(m.paid_revenue)-sum(m.refunded_amount))::numeric AS net_revenue,
 sum(m.sold)::bigint AS total_sold_tickets,sum(m.checked_in)::bigint AS total_checked_in_tickets,
 sum(m.cancelled)::bigint AS total_cancelled_tickets,now() AS refreshed_at
FROM movements m JOIN events e ON e.id=m.event_id GROUP BY e.id,e.organizer_id,m.report_date;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_report_daily_event_date ON mv_event_report_daily(event_id,report_date);

--> statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_event_report_facts AS
WITH slices AS (
 SELECT o.id AS order_id,o.event_id,e.organizer_id,o.user_id,o.order_code,
 u.full_name AS buyer_name,u.email AS buyer_email,u.phone AS buyer_phone,
 oi.ticket_type_id,tt.name AS ticket_type_name,upper(trim(o.voucher_code)) AS voucher_code,
 (COALESCE(o.paid_at,o.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS sale_date,
 o.total_amount,o.final_amount,o.discount_amount,COALESCE(sum(oi.subtotal),0) AS weight
 FROM orders o JOIN events e ON e.id=o.event_id JOIN users u ON u.id=o.user_id
 LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN ticket_types tt ON tt.id=oi.ticket_type_id
 WHERE o.status IN ('PAID','REFUNDED') OR o.paid_at IS NOT NULL
 GROUP BY o.id,e.organizer_id,u.id,oi.ticket_type_id,tt.name
), ranked AS (
 SELECT s.*,row_number() OVER w AS rn,count(*) OVER(PARTITION BY order_id) AS n,
 COALESCE(weight/NULLIF(sum(weight) OVER(PARTITION BY order_id),0),0) AS fraction
 FROM slices s WINDOW w AS (PARTITION BY order_id ORDER BY ticket_type_id NULLS LAST)
), amounts AS (
 SELECT r.*,round(total_amount*fraction,2) AS gross,round(final_amount*fraction,2) AS paid,
 round(discount_amount*fraction,2) AS discount FROM ranked r
), ticket_counts AS (
 SELECT order_id,ticket_type_id,count(*) FILTER(WHERE status IN ('SOLD','CHECKED_IN')) AS sold,
 count(*) FILTER(WHERE status='CHECKED_IN') AS checked,count(*) FILTER(WHERE status='CANCELLED') AS cancelled
 FROM tickets GROUP BY order_id,ticket_type_id
), payments AS (
 SELECT a.*,CASE WHEN rn=n THEN total_amount-COALESCE(sum(gross) OVER prior,0) ELSE gross END AS gross_allocated,
 CASE WHEN rn=n THEN final_amount-COALESCE(sum(paid) OVER prior,0) ELSE paid END AS paid_allocated,
 CASE WHEN rn=n THEN discount_amount-COALESCE(sum(discount) OVER prior,0) ELSE discount END AS discount_allocated,
 COALESCE(t.sold,0) AS sold,COALESCE(t.checked,0) AS checked,COALESCE(t.cancelled,0) AS cancelled
 FROM amounts a LEFT JOIN ticket_counts t ON t.order_id=a.order_id AND t.ticket_type_id=a.ticket_type_id
 WINDOW prior AS (PARTITION BY a.order_id ORDER BY a.ticket_type_id NULLS LAST ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
), refund_parts AS (
 SELECT s.*,r.id AS refund_id,r.amount,
 (COALESCE(r.processed_at,r.updated_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS refund_date,
 row_number() OVER w AS refund_rn,count(*) OVER(PARTITION BY r.id) AS refund_n,
 round(r.amount*CASE WHEN r.ticket_id IS NOT NULL THEN 1 ELSE s.fraction END,2) AS allocated
 FROM refunds r JOIN ranked s ON s.order_id=r.order_id
 LEFT JOIN tickets t ON t.id=r.ticket_id
 WHERE r.status='COMPLETED' AND (r.ticket_id IS NULL OR s.ticket_type_id=t.ticket_type_id)
 WINDOW w AS (PARTITION BY r.id ORDER BY s.ticket_type_id NULLS LAST)
), movements AS (
 SELECT event_id,organizer_id,order_id,user_id,order_code,buyer_name,buyer_email,buyer_phone,
 ticket_type_id,ticket_type_name,voucher_code,sale_date AS report_date,'PAYMENT'::text AS source,
 gross_allocated AS gross_revenue,paid_allocated AS paid_revenue,discount_allocated AS discount_amount,
 0::numeric AS refunded_amount,sold,checked,cancelled FROM payments
 UNION ALL
 SELECT event_id,organizer_id,order_id,user_id,order_code,buyer_name,buyer_email,buyer_phone,
 ticket_type_id,ticket_type_name,voucher_code,refund_date,'REFUND',0,0,0,
 CASE WHEN refund_rn=refund_n THEN amount-COALESCE(sum(allocated) OVER(
   PARTITION BY refund_id ORDER BY ticket_type_id NULLS LAST ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)
 ELSE allocated END,0,0,0 FROM refund_parts
)
SELECT event_id,organizer_id,order_id,user_id,order_code,buyer_name,buyer_email,buyer_phone,
 ticket_type_id,ticket_type_name,voucher_code,report_date,source,
 sum(gross_revenue)::numeric AS gross_revenue,sum(paid_revenue)::numeric AS paid_revenue,
 sum(discount_amount)::numeric AS discount_amount,sum(refunded_amount)::numeric AS total_refunded_amount,
 (sum(paid_revenue)-sum(refunded_amount))::numeric AS net_revenue,
 sum(sold)::bigint AS total_sold_tickets,sum(checked)::bigint AS total_checked_in_tickets,
 sum(cancelled)::bigint AS total_cancelled_tickets,now() AS refreshed_at
FROM movements GROUP BY event_id,organizer_id,order_id,user_id,order_code,buyer_name,buyer_email,buyer_phone,
 ticket_type_id,ticket_type_name,voucher_code,report_date,source;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_report_facts_grain ON mv_event_report_facts(event_id,order_id,ticket_type_id,report_date,source) NULLS NOT DISTINCT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_mv_report_facts_filters ON mv_event_report_facts(event_id,report_date,ticket_type_id,voucher_code);
