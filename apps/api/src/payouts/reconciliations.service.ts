import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../database/db";
import {
  auditLog,
  payouts,
  reconciliationCases,
  reconciliationReports,
} from "../database/schema";
import type { ReconciliationQueryDto } from "@tickethub/shared";
import type { ReconciliationItem } from "./reconciliation-items";
import { matchReconciliation } from "./reconciliation-match";
import {
  assertSettlementClosed,
  hash,
  lockSettlementEvent,
  readSettlementLedger,
} from "./settlement-ledger";
import { parseVnpayReport } from "./vnpay-report";

export const RECONCILIATION_HOLD_REASON = "Đối soát VNPay phát hiện sai lệch";

@Injectable()
export class ReconciliationsService {
  async importReport(eventId: string, csv: string) {
    const report = parseVnpayReport(csv);
    const sourceHash = hash(csv);
    return db.transaction(async (tx) => {
      const event = await lockSettlementEvent(tx, eventId);
      assertSettlementClosed(event);
      const ledger = await readSettlementLedger(tx, eventId);
      const [previous] = await tx
        .select({
          sourceHash: reconciliationReports.sourceHash,
          ledgerHash: reconciliationReports.ledgerHash,
          discrepancyCount: reconciliationReports.discrepancyCount,
          reconciledAt: reconciliationReports.reconciledAt,
        })
        .from(reconciliationReports)
        .where(eq(reconciliationReports.eventId, eventId));
      if (
        previous?.sourceHash === sourceHash &&
        previous.ledgerHash === ledger.ledgerHash
      ) {
        const [investigation] =
          previous.discrepancyCount > 0
            ? await tx
                .select({ id: reconciliationCases.id })
                .from(reconciliationCases)
                .where(
                  and(
                    eq(reconciliationCases.eventId, eventId),
                    eq(reconciliationCases.sourceHash, sourceHash),
                    eq(reconciliationCases.openedAt, previous.reconciledAt),
                  ),
                )
            : [];
        return {
          eventId,
          sourceHash,
          discrepancyCount: previous.discrepancyCount,
          reconciledAt: previous.reconciledAt,
          investigationId: investigation?.id ?? null,
          reused: true,
        };
      }
      const items = matchReconciliation(event, ledger, report);
      const discrepancies = items.filter((item) => item.issue);
      const discrepancyCount = discrepancies.length;
      const reconciledAt = new Date();
      const values = {
        sourceHash,
        ledgerHash: ledger.ledgerHash,
        discrepancyCount,
        reconciledAt,
        items,
      };
      await tx
        .insert(reconciliationReports)
        .values({ eventId, ...values })
        .onConflictDoUpdate({
          target: reconciliationReports.eventId,
          set: values,
        });
      let investigationId: string | null = null;
      if (discrepancyCount) {
        const [investigation] = await tx
          .insert(reconciliationCases)
          .values({
            eventId,
            sourceHash,
            discrepancies,
            openedAt: reconciledAt,
          })
          .returning({ id: reconciliationCases.id });
        investigationId = investigation!.id;
        await tx
          .update(payouts)
          .set({
            status: "HOLD",
            holdReason: RECONCILIATION_HOLD_REASON,
            updatedAt: reconciledAt,
          })
          .where(
            sql`${payouts.eventId} = ${eventId} AND ${payouts.status} = 'PENDING'`,
          );
      }
      await tx.insert(auditLog).values({
        actorRole: "SYSTEM",
        action: "IMPORT_VNPAY_RECONCILIATION",
        targetType: "EVENT",
        targetId: eventId,
        changes: {
          sourceHash,
          discrepancyCount,
          investigationId,
          previousSourceHash: previous?.sourceHash ?? null,
        },
      });
      return {
        eventId,
        sourceHash,
        discrepancyCount,
        reconciledAt,
        investigationId,
        reused: false,
      };
    });
  }

  async getInvestigations(eventId: string, page: number, limit: number) {
    const cases = await db
      .select({
        id: reconciliationCases.id,
        eventId: reconciliationCases.eventId,
        sourceHash: reconciliationCases.sourceHash,
        openedAt: reconciliationCases.openedAt,
        resolvedAt: reconciliationCases.resolvedAt,
        resolvedBy: reconciliationCases.resolvedBy,
        resolution: reconciliationCases.resolution,
        discrepancyCount: sql<number>`jsonb_array_length(${reconciliationCases.discrepancies})`,
      })
      .from(reconciliationCases)
      .where(eq(reconciliationCases.eventId, eventId))
      .orderBy(desc(reconciliationCases.openedAt), desc(reconciliationCases.id))
      .limit(limit + 1)
      .offset((page - 1) * limit);
    return {
      items: cases.slice(0, limit),
      meta: { page, limit, hasMore: cases.length > limit },
    };
  }

  async getInvestigationItems(
    eventId: string,
    caseId: string,
    page: number,
    limit: number,
  ) {
    const [investigation] = await db
      .select({ id: reconciliationCases.id })
      .from(reconciliationCases)
      .where(
        and(
          eq(reconciliationCases.id, caseId),
          eq(reconciliationCases.eventId, eventId),
        ),
      );
    if (!investigation) throw new NotFoundException("INVESTIGATION_NOT_FOUND");
    const items = await db.execute<{ item: ReconciliationItem }>(sql`
      SELECT item
      FROM reconciliation_cases
      CROSS JOIN LATERAL jsonb_array_elements(discrepancies) WITH ORDINALITY AS evidence(item, position)
      WHERE event_id = ${eventId} AND id = ${caseId}
      ORDER BY position LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}
    `);
    return {
      items: items.slice(0, limit).map(({ item }) => item),
      meta: { page, limit, hasMore: items.length > limit },
    };
  }

  async resolveInvestigations(
    eventId: string,
    adminId: string,
    resolution: string,
  ) {
    return db.transaction(async (tx) => {
      const event = await lockSettlementEvent(tx, eventId);
      assertSettlementClosed(event);
      const { ledgerHash } = await readSettlementLedger(tx, eventId);
      const [report] = await tx
        .select({
          ledgerHash: reconciliationReports.ledgerHash,
          discrepancyCount: reconciliationReports.discrepancyCount,
          sourceHash: reconciliationReports.sourceHash,
        })
        .from(reconciliationReports)
        .where(eq(reconciliationReports.eventId, eventId));
      if (report?.ledgerHash !== ledgerHash || report.discrepancyCount !== 0)
        throw new ConflictException("CLEAN_CURRENT_RECONCILIATION_REQUIRED");
      const closed = await tx
        .update(reconciliationCases)
        .set({
          resolution,
          resolvedBy: adminId,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(reconciliationCases.eventId, eventId),
            isNull(reconciliationCases.resolvedAt),
          ),
        )
        .returning({ id: reconciliationCases.id });
      if (closed.length)
        await tx.insert(auditLog).values({
          actorId: adminId,
          actorRole: "ADMIN",
          action: "RESOLVE_VNPAY_INVESTIGATIONS",
          targetType: "EVENT",
          targetId: eventId,
          changes: {
            caseIds: closed.map(({ id }) => id),
            resolution,
            sourceHash: report.sourceHash,
          },
        });
      return { resolvedCount: closed.length };
    });
  }

  async getReconciliations(query: ReconciliationQueryDto) {
    const { page, limit, eventId, status } = query;
    const scope = eventId ? sql`WHERE report.event_id = ${eventId}` : sql``;
    const filter =
      status !== "ALL"
        ? sql`WHERE item->>'reconciliationStatus' = ${status}`
        : sql``;
    const [result] = await db.execute<{
      summary: {
        totalTransactions: number;
        totalOrderAmount: number;
        totalPaidAmount: number;
        totalRefundedAmount: number;
        matchedCount: number;
        mismatchedCount: number;
      };
      items: ReconciliationItem[];
      total: number;
      report: {
        sourceHash: string;
        reconciledAt: string;
        discrepancyCount: number;
      } | null;
    }>(sql`
      WITH scoped AS (
        SELECT report.* FROM reconciliation_reports report ${scope}
      ), entries AS (
        SELECT scoped.event_id, scoped.reconciled_at, expanded.item, expanded.ordinality
        FROM scoped CROSS JOIN LATERAL jsonb_array_elements(scoped.items)
          WITH ORDINALITY AS expanded(item, ordinality)
      ), filtered AS (
        SELECT * FROM entries ${filter}
      ), paged AS (
        SELECT * FROM filtered ORDER BY reconciled_at DESC, event_id, ordinality
        LIMIT ${limit} OFFSET ${(page - 1) * limit}
      )
      SELECT
        (SELECT jsonb_build_object(
          'totalTransactions', count(*),
          'totalOrderAmount', coalesce(sum((item->>'orderAmount')::numeric), 0),
          'totalPaidAmount', coalesce(sum((item->>'paidAmount')::numeric), 0),
          'totalRefundedAmount', coalesce(sum((item->>'refundedAmount')::numeric), 0),
          'matchedCount', count(*) FILTER (WHERE item->>'reconciliationStatus' = 'MATCHED'),
          'mismatchedCount', count(*) FILTER (WHERE item->>'reconciliationStatus' <> 'MATCHED')
        ) FROM entries) AS summary,
        (SELECT coalesce(jsonb_agg(item ORDER BY reconciled_at DESC, event_id, ordinality), '[]'::jsonb) FROM paged) AS items,
        (SELECT count(*)::int FROM filtered) AS total,
        (SELECT jsonb_build_object('sourceHash', source_hash, 'reconciledAt', reconciled_at, 'discrepancyCount', discrepancy_count)
         FROM scoped WHERE ${eventId !== undefined} LIMIT 1) AS report
    `);
    const { total, ...data } = result!;
    return {
      ...data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }
}
