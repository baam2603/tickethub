import { sql } from "drizzle-orm";
import { db } from "../database/db";

// Doc database truc tiep: so ve va so lan quet la hai chi so rieng.
// Mot ve bi quet trung nhieu lan khong lam tang so ve da check-in.
export async function readCheckinSummary(eventId: string) {
  return db.transaction(
    async (tx) => {
      const [summary] = await tx.execute<{
        validTickets: number;
        checkedInTickets: number;
        remainingTickets: number;
        successfulAttempts: number;
        rejectedAttempts: number;
        checkinPercentage: string;
      }>(sql`
      with ticket_counts as (
        select count(*) filter(where status in ('SOLD','CHECKED_IN'))::int as valid,
          count(*) filter(where status='CHECKED_IN')::int as checked,
          count(*) filter(where status='SOLD')::int as remaining
        from tickets where event_id=${eventId}
      ), attempts as (
        select count(*) filter(where outcome='SUCCESS')::int as success,
          count(*) filter(where outcome='REJECTED')::int as rejected
        from gate_checkin_logs where event_id=${eventId}
      ) select valid as "validTickets",checked as "checkedInTickets",remaining as "remainingTickets",
        success as "successfulAttempts",rejected as "rejectedAttempts",
        case when valid=0 then 0 else round(checked::numeric*100/valid,2) end as "checkinPercentage"
        from ticket_counts cross join attempts
    `);
      const gates = await tx.execute(sql`
      with attempts as (
        select gate_id,count(*) filter(where outcome='SUCCESS')::int as success,
          count(*) filter(where outcome='REJECTED')::int as rejected,
          max(checked_in_at) as last_scan
        from gate_checkin_logs where event_id=${eventId} group by gate_id
      ), checked as (
        select gate_id,count(*)::int as checked from tickets
        where event_id=${eventId} and status='CHECKED_IN' group by gate_id
      ), assigned as (
        select es.gate_id,count(*)::int as assigned from event_staff es join users u on u.id=es.user_id
        where es.event_id=${eventId} and u.status='ACTIVE' and u.role='GATE_STAFF' group by es.gate_id
      ), ids as (
        select id from gates where event_id=${eventId}
        union select gate_id from attempts union select gate_id from checked
      ) select ids.id as "gateId",g.name as "gateName",
        coalesce(a.success,0) as "successfulAttempts",coalesce(a.rejected,0) as "rejectedAttempts",
        coalesce(c.checked,0) as "checkedInTickets",coalesce(s.assigned,0) as "activeAssignedStaff",
        a.last_scan as "lastScanAt"
      from ids left join gates g on g.id=ids.id and g.event_id=${eventId}
        left join attempts a on a.gate_id is not distinct from ids.id
        left join checked c on c.gate_id is not distinct from ids.id
        left join assigned s on s.gate_id=ids.id
      order by g.name nulls last,ids.id
    `);
      const timeline = await tx.execute(sql`
        select to_char(date_trunc('hour',checked_in_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD"T"HH24:MI:SS')||'+07:00' as hour,
          count(*) filter(where outcome='SUCCESS')::int as "successfulAttempts",
          count(*) filter(where outcome='REJECTED')::int as "rejectedAttempts"
        from gate_checkin_logs where event_id=${eventId} and checked_in_at >= now()-interval '24 hours'
        group by date_trunc('hour',checked_in_at AT TIME ZONE 'Asia/Ho_Chi_Minh') order by hour
      `);
      return {
        eventId,
        generatedAt: new Date().toISOString(),
        suggestedPollIntervalMs: 5000,
        summary: {
          ...summary!,
          checkinPercentage: Number(summary!.checkinPercentage),
        },
        gates: Array.from(gates),
        timelineLast24Hours: Array.from(timeline),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
