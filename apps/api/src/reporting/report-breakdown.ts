import { sql } from "drizzle-orm";
import { db } from "../database/db";
import type {
  Page,
  ReportPeriod,
} from "../organizer-operations/operations.schemas";
import { reportFactsWhere } from "./report-data";

export async function readReportBreakdown(
  eventId: string,
  organizerId: string,
  filter: ReportPeriod & Page,
  kind: "buyers" | "vouchers",
) {
  const where = reportFactsWhere(eventId, organizerId, filter);
  // Du lieu nguoi mua duoc snapshot trong MV, khong join bang giao dich tren request bao cao.
  if (kind === "buyers")
    return Array.from(
      await db.execute(sql`
    select order_id as "orderId",order_code as "orderCode",user_id as "buyerId",
      buyer_name as "fullName",buyer_email as email,buyer_phone as phone,
      voucher_code as "voucherCode",to_char(report_date,'YYYY-MM-DD') as "paymentDate",
      sum(total_sold_tickets)::bigint as "validTickets",
      sum(total_checked_in_tickets)::bigint as "checkedInTickets",
      sum(total_cancelled_tickets)::bigint as "cancelledTickets",
      sum(paid_revenue)::numeric as "paidRevenue",max(refreshed_at) as "refreshedAt"
    from mv_event_report_facts where ${where} and source='PAYMENT'
    group by order_id,order_code,user_id,buyer_name,buyer_email,buyer_phone,voucher_code,report_date
    order by report_date desc,order_id desc limit ${filter.limit + 1} offset ${(filter.page - 1) * filter.limit}
  `),
    );
  return Array.from(
    await db.execute(sql`
    select voucher_code as "voucherCode",count(distinct order_id) filter(where source='PAYMENT')::bigint as "paidOrders",
      sum(gross_revenue)::numeric as "grossRevenue",sum(discount_amount)::numeric as "discountAmount",
      sum(paid_revenue)::numeric as "paidRevenue",sum(total_refunded_amount)::numeric as "refundedAmount",
      sum(net_revenue)::numeric as "netRevenue",sum(total_sold_tickets)::bigint as "validTickets",
      max(refreshed_at) as "refreshedAt"
    from mv_event_report_facts where ${where}
    group by voucher_code order by voucher_code nulls first
    limit ${filter.limit + 1} offset ${(filter.page - 1) * filter.limit}
  `),
  );
}
