import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { EventStatus } from "@tickethub/shared";
import { db } from "../../../database/db";
import { events } from "../../../database/schema";
import type {
  EventSearchItem,
  SearchCursor,
  SearchFilters,
} from "../domain/search.models";
import type { EventSearchRepository } from "../domain/search.ports";

/** Keyword duoi 2 ky tu hoac chi co dau cau: bo full-text, van giu cac bo loc. */
function fullTextKeyword(keyword?: string): string | null {
  const k = keyword?.trim().normalize("NFC") ?? "";
  return Array.from(k).length >= 2 && /[\p{L}\p{N}]/u.test(k) ? k : null;
}

export class DrizzleEventSearchRepository implements EventSearchRepository {
  async resolveCursor(eventId: string): Promise<SearchCursor | null> {
    const [row] = await db
      .select({ id: events.id, startTime: events.startTime })
      .from(events)
      .where(
        and(eq(events.id, eventId), eq(events.status, EventStatus.PUBLISHED)),
      )
      .limit(1);
    return row ?? null;
  }

  async findMatchingIds(
    filters: SearchFilters,
    cursor: SearchCursor | null,
    take: number,
  ): Promise<string[]> {
    const conditions: SQL[] = [eq(events.status, EventStatus.PUBLISHED)];

    // Tim kiem Full-Text tieng Viet khong dau, xep theo do lien quan
    const keyword = fullTextKeyword(filters.keyword);
    const query = sql`plainto_tsquery('simple', unaccent(${keyword}))`;
    const rank = sql`ts_rank(${events.searchVector}, ${query})`;
    if (keyword) conditions.push(sql`${events.searchVector} @@ ${query}`);
    if (filters.city) {
      conditions.push(
        sql`lower(unaccent(${events.city})) =
            lower(unaccent(${filters.city}))`,
      );
    }
    if (filters.category) {
      conditions.push(
        sql`lower(unaccent(${events.category})) =
            lower(unaccent(${filters.category}))`,
      );
    }
    if (filters.fromDate) {
      conditions.push(gte(events.startTime, new Date(filters.fromDate)));
    }
    if (filters.toDate) {
      conditions.push(lte(events.startTime, new Date(filters.toDate)));
    }

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const priceConditions: SQL[] = [sql`tt.event_id = ${events.id}`];
      if (filters.minPrice !== undefined) {
        priceConditions.push(sql`tt.price >= ${filters.minPrice}`);
      }
      if (filters.maxPrice !== undefined) {
        priceConditions.push(sql`tt.price <= ${filters.maxPrice}`);
      }
      conditions.push(
        sql`EXISTS (
          SELECT 1
          FROM ticket_types tt
          WHERE ${sql.join(priceConditions, sql` AND `)}
        )`,
      );
    }

    if (cursor) {
      const chronologicalNext = or(
        gt(events.startTime, cursor.startTime),
        and(eq(events.startTime, cursor.startTime), gt(events.id, cursor.id)),
      );
      // So rank trong SQL de tranh sai lech lam tron float khi di qua JS.
      const cursorRank = sql`(SELECT ts_rank(c.search_vector, ${query}) FROM events c WHERE c.id = ${cursor.id})`;
      const nextPage = keyword
        ? or(lt(rank, cursorRank), and(eq(rank, cursorRank), chronologicalNext))
        : chronologicalNext;
      if (nextPage) conditions.push(nextPage);
    }

    const rows = await db
      .select({ id: events.id })
      .from(events)
      .where(and(...conditions))
      .orderBy(
        ...(keyword ? [desc(rank)] : []),
        asc(events.startTime),
        asc(events.id),
      )
      .limit(take);
    return rows.map((r) => r.id);
  }

  async loadDetails(ids: string[]): Promise<EventSearchItem[]> {
    const details = await db.query.events.findMany({
      where: inArray(events.id, ids),
      columns: { searchVector: false },
      with: { ticketTypes: true },
    });
    return details as EventSearchItem[];
  }
}
