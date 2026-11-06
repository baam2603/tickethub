ALTER TABLE "report_exports" ADD COLUMN "from_date" date;--> statement-breakpoint
ALTER TABLE "report_exports" ADD COLUMN "to_date" date;--> statement-breakpoint
ALTER TABLE report_exports ADD CONSTRAINT report_exports_period_check CHECK (
 (from_date IS NULL AND to_date IS NULL) OR
 (from_date IS NOT NULL AND to_date IS NOT NULL AND from_date <= to_date)
);
--> statement-breakpoint
-- Tong hop tung nguon rieng, khong join don voi tung ve/lan hoan tien.
-- Ngay tien thu: paid_at; legacy PAID/REFUNDED chua co paid_at dung created_at.
-- Ngay tien hoan: processed_at; legacy COMPLETED dung updated_at.
CREATE MATERIALIZED VIEW mv_event_report_daily AS
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
CREATE UNIQUE INDEX idx_mv_report_daily_event_date ON mv_event_report_daily(event_id,report_date);
