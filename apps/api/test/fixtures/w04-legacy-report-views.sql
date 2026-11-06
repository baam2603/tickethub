-- Fixture MV legacy W05: không thêm bảng nghiệp vụ vào nhánh W04.
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

CREATE MATERIALIZED VIEW mv_event_report_facts AS
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
CREATE UNIQUE INDEX idx_mv_report_facts_grain ON mv_event_report_facts(event_id,order_id,ticket_type_id,report_date,source) NULLS NOT DISTINCT;
--> statement-breakpoint
CREATE INDEX idx_mv_report_facts_filters ON mv_event_report_facts(event_id,report_date,ticket_type_id,voucher_code);
