import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { db } from "../database/db";
import { auditLog, payouts, reconciliationReports } from "../database/schema";
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
        return {
          eventId,
          sourceHash,
          discrepancyCount: previous.discrepancyCount,
          reconciledAt: previous.reconciledAt,
          reused: true,
        };
      }
      const items = matchReconciliation(event, ledger, report);
      const discrepancyCount = items.filter((item) => item.issue).length;
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
      if (discrepancyCount) {
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
          previousSourceHash: previous?.sourceHash ?? null,
        },
      });
      return {
        eventId,
        sourceHash,
        discrepancyCount,
        reconciledAt,
        reused: false,
      };
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
