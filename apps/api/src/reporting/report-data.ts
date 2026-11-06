import { UnprocessableEntityException } from "@nestjs/common";
import type { ReportPeriod } from "../organizer-operations/operations.schemas";
import { sql } from "drizzle-orm";
import { db } from "../database/db";
export async function refreshReportViews() {
  return db.transaction(
    async (tx) => {
      const [lock] = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(784125) as locked`,
      );
      if (!lock?.locked) return false;
      await tx.execute(
        sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_event_sales_summary`,
      );
      await tx.execute(
        sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_event_ticket_sales`,
      );
      await tx.execute(
        sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_event_report_daily`,
      );
      await tx.execute(
        sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_event_report_facts`,
      );
      return true;
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function readReport(
  eventId: string,
  organizerId: string,
  period: ReportPeriod = {},
  maxRows = 10000,
) {
  return db.transaction(
    async (tx) => {
      const [summary] = await tx.execute(
        period.fromDate || period.ticketTypeId || period.voucherCode
          ? sql`
        select s.event_id,s.organizer_id,s.title,
          a.total_sold_tickets,a.total_checked_in_tickets,a.total_cancelled_tickets,
          a.gross_revenue,a.paid_revenue,a.total_refunded_amount,a.net_revenue,
          case when a.total_sold_tickets=0 then 0 else
            round(a.total_checked_in_tickets::numeric*100/a.total_sold_tickets,2) end as checkin_percentage,
          s.refreshed_at
        from mv_event_sales_summary s cross join lateral (
          select coalesce(sum(total_sold_tickets),0)::bigint as total_sold_tickets,
            coalesce(sum(total_checked_in_tickets),0)::bigint as total_checked_in_tickets,
            coalesce(sum(total_cancelled_tickets),0)::bigint as total_cancelled_tickets,
            coalesce(sum(gross_revenue),0)::numeric as gross_revenue,
            coalesce(sum(paid_revenue),0)::numeric as paid_revenue,
            coalesce(sum(total_refunded_amount),0)::numeric as total_refunded_amount,
            coalesce(sum(net_revenue),0)::numeric as net_revenue
          from ${period.ticketTypeId || period.voucherCode ? sql`mv_event_report_facts` : sql`mv_event_report_daily`} where event_id=s.event_id and organizer_id=s.organizer_id
            ${period.fromDate ? sql`and report_date >= ${period.fromDate}::date and report_date <= ${period.toDate}::date` : sql``}
            ${period.ticketTypeId ? sql`and ticket_type_id=${period.ticketTypeId}` : sql``}
            ${period.voucherCode ? sql`and voucher_code=${period.voucherCode}` : sql``}
        ) a where s.event_id=${eventId} and s.organizer_id=${organizerId}`
          : sql`select * from mv_event_sales_summary where event_id=${eventId} and organizer_id=${organizerId}`,
      );
      const sales = await tx.execute(sql`
        select event_id,organizer_id,ticket_type_id,ticket_type_name,to_char(report_date,'YYYY-MM-DD') as sale_date,
          sum(total_sold_tickets)::bigint as total_sold_tickets,
          sum(total_checked_in_tickets)::bigint as total_checked_in_tickets,
          sum(paid_revenue)::numeric as paid_revenue,max(refreshed_at) as refreshed_at
        from mv_event_report_facts where ${reportFactsWhere(eventId, organizerId, period)} and source='PAYMENT'
          and ticket_type_id is not null
        group by event_id,organizer_id,ticket_type_id,ticket_type_name,report_date
        order by report_date,ticket_type_id limit ${maxRows + 1}`);
      if (sales.length > maxRows)
        throw new UnprocessableEntityException({
          code: "REPORT_TOO_LARGE",
          message: `Thu hep khoang ngay hoac xuat nen (gioi han ${maxRows} dong hang ve/ngay).`,
        });
      return {
        summary: summary ?? null,
        sales: Array.from(sales),
        analytics: summary
          ? {
              cancellationPercentage:
                Number(summary.total_sold_tickets) +
                  Number(summary.total_cancelled_tickets) ===
                0
                  ? 0
                  : Math.round(
                      (Number(summary.total_cancelled_tickets) * 10000) /
                        (Number(summary.total_sold_tickets) +
                          Number(summary.total_cancelled_tickets)),
                    ) / 100,
              fees: {
                status: "NOT_CONFIGURED",
                platformFee: null,
                gatewayFee: null,
                netPayout: null,
              },
            }
          : null,
        period: {
          fromDate: period.fromDate ?? null,
          toDate: period.toDate ?? null,
          ticketTypeId: period.ticketTypeId ?? null,
          voucherCode: period.voucherCode ?? null,
          timezone: "Asia/Ho_Chi_Minh",
          refundBasis: "COMPLETION_DATE",
          ticketBasis: "PAYMENT_DATE_CURRENT_STATUS",
        },
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

export function reportFactsWhere(
  eventId: string,
  organizerId: string,
  period: ReportPeriod,
) {
  return sql`event_id=${eventId} and organizer_id=${organizerId}
    ${period.fromDate ? sql`and report_date >= ${period.fromDate}::date and report_date <= ${period.toDate}::date` : sql``}
    ${period.ticketTypeId ? sql`and ticket_type_id=${period.ticketTypeId}` : sql``}
    ${period.voucherCode ? sql`and voucher_code=${period.voucherCode}` : sql``}`;
}
