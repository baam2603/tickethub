import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, eq, inArray, isNull, sql, desc, count } from "drizzle-orm";
import { db } from "../../../database/db";
import { payouts } from "../../../database/schema/payouts";
import { events } from "../../../database/schema/events";
import { reconciliationCases } from "../../../database/schema/reconciliation-cases";
import { reconciliationReports } from "../../../database/schema/reconciliation-reports";
import { auditLog } from "../../../database/schema/audit-log";
import { organizerProfiles } from "../../../database/schema/organizer-profiles";
import {
  PayoutStatus,
  UserRole,
  type PayoutFilterQueryDto,
  type OrganizerPayoutQueryDto,
} from "@tickethub/shared";
import {
  assertSettlementClosed,
  lockSettlementEvent,
  readSettlementLedger,
  type SettlementTransaction,
} from "./settlement-ledger";
import type { PayoutCalculationResult } from "../domain/payout-calculator";

import { isApprovalRollback, retryPayoutApproval } from "./approval-retry";
import { outbox, users } from "../../../database/schema";
import {
  PAYOUT_APPROVAL_RETRY,
  type ApprovalIntent,
  type ApprovalSnapshot,
} from "../domain/approval-intent";

function payoutAmounts(calculation: PayoutCalculationResult) {
  return {
    totalRevenue: String(calculation.grossRevenue),
    platformFee: String(calculation.platformFee),
    gatewayFee: String(calculation.gatewayFee),
    refundDeduction: String(calculation.refundDeduction),
    netPayout: String(calculation.netPayout),
  };
}

function serializePayout(payout: typeof payouts.$inferSelect) {
  return {
    ...payout,
    totalRevenue: Number(payout.totalRevenue),
    platformFee: Number(payout.platformFee),
    gatewayFee: Number(payout.gatewayFee),
    refundDeduction: Number(payout.refundDeduction),
    netPayout: Number(payout.netPayout),
  };
}

async function settlementState(tx: SettlementTransaction, eventId: string) {
  const ledger = await readSettlementLedger(tx, eventId);
  // Các cột payout có kiểu NUMERIC(14,2).
  if (
    [ledger.calculation.grossRevenue, ledger.calculation.refundDeduction].some(
      (amount) => !Number.isSafeInteger(amount) || amount >= 1_000_000_000_000,
    )
  )
    throw new ConflictException("PAYOUT_TOTAL_OUT_OF_RANGE");
  const [report] = await tx
    .select({
      ledgerHash: reconciliationReports.ledgerHash,
      discrepancyCount: reconciliationReports.discrepancyCount,
      sourceHash: reconciliationReports.sourceHash,
    })
    .from(reconciliationReports)
    .where(eq(reconciliationReports.eventId, eventId));
  const [openInvestigation] = await tx
    .select({ id: reconciliationCases.id })
    .from(reconciliationCases)
    .where(
      and(
        eq(reconciliationCases.eventId, eventId),
        isNull(reconciliationCases.resolvedAt),
      ),
    )
    .limit(1);
  const verified =
    report?.ledgerHash === ledger.ledgerHash &&
    report.discrepancyCount === 0 &&
    !openInvestigation;
  return {
    amounts: payoutAmounts(ledger.calculation),
    verified,
    ledgerHash: ledger.ledgerHash,
    sourceHash: report?.sourceHash,
  };
}

function assertPayable(verified: boolean) {
  if (!verified)
    throw new ConflictException("CLEAN_CURRENT_RECONCILIATION_REQUIRED");
}

@Injectable()
export class PayoutsService {
  async isActiveAdmin(userId: string): Promise<boolean> {
    const admin = await db.query.users.findFirst({
      columns: { id: true },
      where: and(
        eq(users.id, userId),
        eq(users.status, "ACTIVE"),
        eq(users.role, "ADMIN"),
      ),
    });
    return Boolean(admin);
  }

  async closeEvent(eventId: string, adminUserId: string) {
    return db.transaction(async (tx) => {
      const event = await lockSettlementEvent(tx, eventId);
      if (event.status === "ENDED") return { eventId, status: event.status };
      const now = new Date();
      if (event.status !== "PUBLISHED" || event.endTime > now) {
        throw new ConflictException("EVENT_NOT_ELIGIBLE_TO_END");
      }
      await tx
        .update(events)
        .set({
          status: "ENDED",
          version: sql`${events.version} + 1`,
          updatedAt: now,
        })
        .where(eq(events.id, eventId));
      await tx.insert(auditLog).values({
        actorId: adminUserId,
        actorRole: UserRole.ADMIN,
        action: "END_EVENT_FOR_SETTLEMENT",
        targetType: "EVENT",
        targetId: eventId,
        changes: { previousStatus: event.status, newStatus: "ENDED" },
      });
      return { eventId, status: "ENDED" as const };
    });
  }

  async generatePayout(eventId: string, adminUserId: string) {
    return db.transaction(async (tx) => {
      const event = await lockSettlementEvent(tx, eventId);
      assertSettlementClosed(event);
      const [existing] = await tx
        .select()
        .from(payouts)
        .where(eq(payouts.eventId, eventId))
        .for("update");
      if (existing?.status === PayoutStatus.PAID_OUT) {
        throw new ConflictException("PAYOUT_ALREADY_PAID_OUT");
      }
      const { amounts, verified, sourceHash } = await settlementState(
        tx,
        eventId,
      );
      const status =
        verified && existing?.status !== PayoutStatus.HOLD
          ? PayoutStatus.PENDING
          : PayoutStatus.HOLD;
      const holdReason =
        status === PayoutStatus.HOLD
          ? (existing?.holdReason ?? "Chưa có kết quả đối soát VNPay hợp lệ")
          : null;
      const values = { ...amounts, status, holdReason, updatedAt: new Date() };
      const [saved] = await tx
        .insert(payouts)
        .values({
          ...values,
          eventId,
          organizerId: event.organizerId,
        })
        .onConflictDoUpdate({ target: payouts.eventId, set: values })
        .returning();
      await tx.insert(auditLog).values({
        actorId: adminUserId,
        actorRole: UserRole.ADMIN,
        action: existing ? "RECALCULATE_PAYOUT" : "GENERATE_PAYOUT",
        targetType: "PAYOUT",
        targetId: saved!.id,
        changes: { ...amounts, status, sourceHash: sourceHash ?? null },
      });
      return serializePayout(saved!);
    });
  }

  async approvePayout(
    payoutId: string,
    adminUserId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    return retryPayoutApproval(payoutId, async () => {
      let intent: ApprovalSnapshot | undefined;
      try {
        return await db.transaction((tx) =>
          this.applyApproval(
            tx,
            payoutId,
            adminUserId,
            { ipAddress, userAgent },
            undefined,
            (value) => {
              intent = value;
            },
          ),
        );
      } catch (error) {
        if (!intent || !isApprovalRollback(error)) throw error;
        await this.enqueueApproval({
          payoutId,
          adminUserId,
          ...intent,
          ipAddress,
          userAgent,
        });
        throw new ServiceUnavailableException("PAYOUT_APPROVAL_QUEUED");
      }
    });
  }

  private async enqueueApproval(intent: ApprovalIntent) {
    await db.transaction(async (tx) => {
      const payout = await this.lockPayout(tx, intent.payoutId);
      if (
        payout.status !== PayoutStatus.PENDING ||
        payout.updatedAt.toISOString() !== intent.payoutVersion
      )
        throw new ConflictException("PAYOUT_APPROVAL_INTENT_STALE");
      const [alreadyQueued] = await tx
        .select({ id: outbox.id })
        .from(outbox)
        .where(
          and(
            eq(outbox.eventType, PAYOUT_APPROVAL_RETRY),
            inArray(outbox.status, ["PENDING", "PROCESSING"]),
            sql`${outbox.payload}->>'payoutId' = ${intent.payoutId}`,
            sql`${outbox.payload}->>'payoutVersion' = ${intent.payoutVersion}`,
            sql`${outbox.payload}->>'ledgerHash' = ${intent.ledgerHash}`,
            sql`${outbox.payload}->>'sourceHash' = ${intent.sourceHash}`,
            sql`${outbox.payload}->>'adminUserId' = ${intent.adminUserId}`,
          ),
        )
        .limit(1);
      if (!alreadyQueued)
        await tx.insert(outbox).values({
          eventType: PAYOUT_APPROVAL_RETRY,
          payload: intent,
          retryCount: 1,
        });
    });
  }

  async applyApproval(
    tx: SettlementTransaction,
    payoutId: string,
    adminUserId: string,
    { ipAddress, userAgent }: Pick<ApprovalIntent, "ipAddress" | "userAgent">,
    expected?: ApprovalSnapshot,
    onValidated?: (intent: ApprovalSnapshot) => void,
  ) {
    const [admin] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, adminUserId),
          eq(users.role, "ADMIN"),
          eq(users.status, "ACTIVE"),
        ),
      )
      .for("share");
    if (!admin) throw new ForbiddenException("ACTIVE_ADMIN_REQUIRED");
    const payout = await this.lockPayout(tx, payoutId);
    if (expected && payout.status === PayoutStatus.PAID_OUT)
      return serializePayout(payout);
    if (payout.status !== PayoutStatus.PENDING) {
      throw new ConflictException("ONLY_PENDING_PAYOUT_CAN_BE_APPROVED");
    }
    const { verified, amounts, sourceHash, ledgerHash } = await settlementState(
      tx,
      payout.eventId,
    );
    assertPayable(verified);
    if (!sourceHash)
      throw new ConflictException("CLEAN_CURRENT_RECONCILIATION_REQUIRED");
    for (const key of Object.keys(amounts) as Array<keyof typeof amounts>) {
      if (Number(payout[key]) !== Number(amounts[key])) {
        throw new ConflictException("PAYOUT_AMOUNTS_CHANGED_RECALCULATE");
      }
    }
    const intent = {
      payoutVersion: payout.updatedAt.toISOString(),
      ledgerHash,
      sourceHash,
    };
    if (
      expected &&
      (expected.payoutVersion !== intent.payoutVersion ||
        expected.ledgerHash !== intent.ledgerHash ||
        expected.sourceHash !== intent.sourceHash)
    )
      throw new ConflictException("PAYOUT_APPROVAL_INTENT_STALE");
    onValidated?.(intent);
    const now = new Date();
    const [updated] = await tx
      .update(payouts)
      .set({
        status: PayoutStatus.PAID_OUT,
        approvedBy: adminUserId,
        paidOutAt: now,
        updatedAt: now,
      })
      .where(eq(payouts.id, payoutId))
      .returning();
    await tx.insert(auditLog).values({
      actorId: adminUserId,
      actorRole: UserRole.ADMIN,
      action: "APPROVE_PAYOUT",
      targetType: "PAYOUT",
      targetId: payoutId,
      changes: {
        ...amounts,
        newStatus: PayoutStatus.PAID_OUT,
        paidOutAt: now.toISOString(),
        sourceHash,
      },
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    });
    return {
      ...serializePayout(updated!),
      message: "Lệnh chi trả đã được phê duyệt thành công.",
    };
  }

  async releasePayout(payoutId: string, reason: string, adminUserId: string) {
    return db.transaction(async (tx) => {
      const payout = await this.lockPayout(tx, payoutId);
      if (payout.status !== PayoutStatus.HOLD) {
        throw new ConflictException("ONLY_HELD_PAYOUT_CAN_BE_RELEASED");
      }
      const { verified, amounts, sourceHash } = await settlementState(
        tx,
        payout.eventId,
      );
      assertPayable(verified);
      const [updated] = await tx
        .update(payouts)
        .set({
          ...amounts,
          status: PayoutStatus.PENDING,
          holdReason: null,
          updatedAt: new Date(),
        })
        .where(eq(payouts.id, payoutId))
        .returning();
      await tx.insert(auditLog).values({
        actorId: adminUserId,
        actorRole: UserRole.ADMIN,
        action: "RELEASE_PAYOUT",
        targetType: "PAYOUT",
        targetId: payoutId,
        changes: {
          reason,
          previousHoldReason: payout.holdReason,
          sourceHash,
          newStatus: PayoutStatus.PENDING,
        },
      });
      return serializePayout(updated!);
    });
  }

  private async lockPayout(tx: SettlementTransaction, payoutId: string) {
    const [existing] = await tx
      .select({ eventId: payouts.eventId })
      .from(payouts)
      .where(eq(payouts.id, payoutId));
    if (!existing) throw new NotFoundException("PAYOUT_NOT_FOUND");
    const event = await lockSettlementEvent(tx, existing.eventId);
    assertSettlementClosed(event);
    const [payout] = await tx
      .select()
      .from(payouts)
      .where(eq(payouts.id, payoutId))
      .for("update");
    if (!payout) throw new NotFoundException("PAYOUT_NOT_FOUND");
    return payout;
  }

  /**
   * Tam giu lenh chi tra khi co khieu nai hoac tranh chap (cap nhat nguyen tu)
   */
  async holdPayout(
    payoutId: string,
    reason: string,
    adminUserId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const now = new Date();

    return await db.transaction(async (tx) => {
      const existing = await this.lockPayout(tx, payoutId);
      if (existing.status === PayoutStatus.PAID_OUT) {
        throw new BadRequestException("CANNOT_HOLD_PAID_OUT");
      }
      const [updated] = await tx
        .update(payouts)
        .set({
          status: PayoutStatus.HOLD,
          holdReason: reason,
          updatedAt: now,
        })
        .where(eq(payouts.id, payoutId))
        .returning();

      await tx.insert(auditLog).values({
        actorId: adminUserId,
        actorRole: UserRole.ADMIN,
        action: "HOLD_PAYOUT",
        targetType: "PAYOUT",
        targetId: payoutId,
        changes: {
          newStatus: PayoutStatus.HOLD,
          holdReason: reason,
        },
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      });

      return serializePayout(updated!);
    });
  }

  /**
   * Tinh toan lai so lieu cho lenh quyet toan dang o PENDING hoac HOLD
   */
  async recalculatePayout(payoutId: string, adminUserId: string) {
    const [payout] = await db
      .select()
      .from(payouts)
      .where(eq(payouts.id, payoutId));

    if (!payout) {
      throw new NotFoundException(
        "PAYOUT_NOT_FOUND: Không tìm thấy lệnh chi trả",
      );
    }

    if (payout.status === PayoutStatus.PAID_OUT) {
      throw new ConflictException(
        "PAYOUT_ALREADY_PAID_OUT: Không thể tính lại lệnh chi trả đã thanh toán hoàn tất",
      );
    }

    return await this.generatePayout(payout.eventId, adminUserId);
  }

  /**
   * Danh sach quyet toan danh cho Quan tri vien
   */
  async getAdminPayouts(query: PayoutFilterQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (query.status) {
      conditions.push(eq(payouts.status, query.status));
    }
    if (query.organizerId) {
      conditions.push(eq(payouts.organizerId, query.organizerId));
    }
    if (query.eventId) {
      conditions.push(eq(payouts.eventId, query.eventId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await db
      .select({ count: count() })
      .from(payouts)
      .where(whereClause);

    const total = totalRow?.count ?? 0;

    const rows = await db
      .select({
        id: payouts.id,
        organizerId: payouts.organizerId,
        eventId: payouts.eventId,
        eventTitle: events.title,
        organizationName: organizerProfiles.organizationName,
        totalRevenue: sql<number>`CAST(${payouts.totalRevenue} AS FLOAT)`,
        platformFee: sql<number>`CAST(${payouts.platformFee} AS FLOAT)`,
        gatewayFee: sql<number>`CAST(${payouts.gatewayFee} AS FLOAT)`,
        refundDeduction: sql<number>`CAST(${payouts.refundDeduction} AS FLOAT)`,
        netPayout: sql<number>`CAST(${payouts.netPayout} AS FLOAT)`,
        status: payouts.status,
        holdReason: payouts.holdReason,
        paidOutAt: payouts.paidOutAt,
        approvedBy: payouts.approvedBy,
        createdAt: payouts.createdAt,
        updatedAt: payouts.updatedAt,
      })
      .from(payouts)
      .innerJoin(events, eq(payouts.eventId, events.id))
      .innerJoin(
        organizerProfiles,
        eq(payouts.organizerId, organizerProfiles.id),
      )
      .where(whereClause)
      .orderBy(desc(payouts.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Danh sach quyet toan danh cho Ban to chuc
   */
  async getOrganizerPayouts(userId: string, query: OrganizerPayoutQueryDto) {
    const profile = await db.query.organizerProfiles.findFirst({
      where: eq(organizerProfiles.userId, userId),
    });

    if (!profile) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "ORGANIZER_PROFILE_REQUIRED",
          message: "Tài khoản chưa có hồ sơ ban tổ chức",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const whereClause = eq(payouts.organizerId, profile.id);

    const [totalRow] = await db
      .select({ count: count() })
      .from(payouts)
      .where(whereClause);

    const total = totalRow?.count ?? 0;

    const rows = await db
      .select({
        id: payouts.id,
        eventId: payouts.eventId,
        eventTitle: events.title,
        totalRevenue: sql<number>`CAST(${payouts.totalRevenue} AS FLOAT)`,
        platformFee: sql<number>`CAST(${payouts.platformFee} AS FLOAT)`,
        gatewayFee: sql<number>`CAST(${payouts.gatewayFee} AS FLOAT)`,
        refundDeduction: sql<number>`CAST(${payouts.refundDeduction} AS FLOAT)`,
        netPayout: sql<number>`CAST(${payouts.netPayout} AS FLOAT)`,
        status: payouts.status,
        paidOutAt: payouts.paidOutAt,
        createdAt: payouts.createdAt,
      })
      .from(payouts)
      .innerJoin(events, eq(payouts.eventId, events.id))
      .where(whereClause)
      .orderBy(desc(payouts.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
