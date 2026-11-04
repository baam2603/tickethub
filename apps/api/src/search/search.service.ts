import { BadRequestException, Injectable } from "@nestjs/common";

import {
  and,
  asc,
  eq,
  desc,
  lt,
  gt,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { EventStatus, type SearchQuery } from "@tickethub/shared";

import { db } from "../database/db";
import { events } from "../database/schema";

@Injectable()
export class SearchService {
  async searchEvents(filters: SearchQuery) {
    const conditions: SQL[] = [eq(events.status, EventStatus.PUBLISHED)];

    // Bo qua full-text voi keyword duoi 2 ky tu, van giu cac bo loc.
    const keyword = filters.keyword?.trim().normalize("NFC") ?? "";
    const useFullText = Array.from(keyword).length >= 2;
    const query = sql`plainto_tsquery('simple', unaccent(${keyword}))`;
    const rank = sql<number>`ts_rank(${events.searchVector}, ${query})`;

    if (useFullText) {
      conditions.push(sql`${events.searchVector} @@ ${query}`);
    }

    // 2. Loc thanh pho
    if (filters.city) {
      conditions.push(
        sql`lower(unaccent(${events.city})) =
            lower(unaccent(${filters.city}))`,
      );
    }

    // 3. Loc the loai
    if (filters.category) {
      conditions.push(
        sql`lower(unaccent(${events.category})) =
            lower(unaccent(${filters.category}))`,
      );
    }

    // 4. Loc thoi gian to chuc
    if (filters.fromDate) {
      conditions.push(gte(events.startTime, new Date(filters.fromDate)));
    }

    if (filters.toDate) {
      conditions.push(lte(events.startTime, new Date(filters.toDate)));
    }

    // 5. Loc khoang gia ve
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

    // 6. Cursor pagination
    if (filters.cursor) {
      const [cursorEvent] = await db
        .select({
          id: events.id,
          startTime: events.startTime,
          rank: rank,
        })
        .from(events)
        .where(
          and(
            eq(events.id, filters.cursor),
            eq(events.status, EventStatus.PUBLISHED),
          ),
        )
        .limit(1);

      if (!cursorEvent) {
        throw new BadRequestException("Cursor khong hop le");
      }

      const chronologicalNext = or(
        gt(events.startTime, cursorEvent.startTime),
        and(
          eq(events.startTime, cursorEvent.startTime),
          gt(events.id, cursorEvent.id),
        ),
      );

      const nextPage = useFullText
        ? or(
            lt(rank, cursorEvent.rank),
            and(eq(rank, cursorEvent.rank), chronologicalNext),
          )
        : chronologicalNext;

      if (nextPage) {
        conditions.push(nextPage);
      }
    }

    // 7. Lay ID su kien theo thu tu on dinh
    const rows = await db
      .select({ id: events.id })
      .from(events)
      .where(and(...conditions))
      .orderBy(
        ...(useFullText ? [desc(rank)] : []),
        asc(events.startTime),
        asc(events.id),
      )
      .limit(filters.limit + 1);

    const hasMore = rows.length > filters.limit;
    const page = rows.slice(0, filters.limit);

    if (page.length === 0) {
      return {
        items: [],
        nextCursor: null,
        hasMore: false,
      };
    }

    // 8. Lay chi tiet va cac hang ve
    const details = await db.query.events.findMany({
      where: inArray(
        events.id,
        page.map((item) => item.id),
      ),
      columns: {
        searchVector: false,
      },
      with: {
        ticketTypes: true,
      },
    });

    const eventMap = new Map(details.map((event) => [event.id, event]));

    // Bao dam thu tu dung voi cursor pagination
    const items = page
      .map((item) => eventMap.get(item.id))
      .filter((item): item is (typeof details)[number] => item !== undefined);

    return {
      items,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
      hasMore,
    };
  }
}
