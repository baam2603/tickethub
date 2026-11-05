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
      return true;
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function readReport(eventId: string, organizerId: string) {
  return db.transaction(
    async (tx) => {
      const [summary] = await tx.execute(
        sql`select * from mv_event_sales_summary where event_id=${eventId} and organizer_id=${organizerId}`,
      );
      const sales = await tx.execute(
        sql`select * from mv_event_ticket_sales where event_id=${eventId} and organizer_id=${organizerId} order by sale_date,ticket_type_id limit 10001`,
      );
      if (sales.length > 10000) throw new Error("REPORT_TOO_LARGE");
      return { summary: summary ?? null, sales: Array.from(sales) };
    },
    { isolationLevel: "repeatable read" },
  );
}
