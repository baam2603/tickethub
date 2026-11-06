import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { and, eq, inArray, sql, desc, count } from "drizzle-orm";
import { db } from "../database/db";
import { payouts } from "../database/schema/payouts";
import { events } from "../database/schema/events";
import { orders } from "../database/schema/orders";
import { refunds } from "../database/schema/refunds";
import { auditLog } from "../database/schema/audit-log";
import { organizerProfiles } from "../database/schema/organizer-profiles";
import {
  PayoutStatus,
  UserRole,
  type PayoutFilterQueryDto,
  type OrganizerPayoutQueryDto,
} from "@tickethub/shared";
import { calculatePayout } from "./payout-calculator";

@Injectable()
export class PayoutsService {
  /**
   * Tinh toan doanh thu su kien va tao/cap nhat lenh quyet toan
   */
  async generatePayout(eventId: string, _adminUserId: string) {
    const [event] = await db
      .select({
        id: events.id,
        organizerId: events.organizerId,
        title: events.title,
      })
      .from(events)
      .where(eq(events.id, eventId));

    if (!event) {
      throw new NotFoundException("EVENT_NOT_FOUND: Không tìm thấy sự kiện");
    }

    // Kiem tra xem su kien da co lenh quyet toan chua
    const [existingPayout] = await db
      .select()
      .from(payouts)
      .where(eq(payouts.eventId, eventId));

    if (existingPayout && existingPayout.status === PayoutStatus.PAID_OUT) {
      throw new ConflictException(
        "PAYOUT_ALREADY_PAID_OUT: Lệnh chi trả cho sự kiện này đã được thanh toán hoàn tất",
      );
    }

    // 1. Tinh tong doanh thu gop ban dau: tat ca don hang thanh cong (PAID va REFUNDED)
    const paidOrders = await db
      .select({
        finalAmount: orders.finalAmount,
      })
      .from(orders)
      .where(
        and(
          eq(orders.eventId, eventId),
          inArray(orders.status, ["PAID", "REFUNDED"]),
        ),
      );

    const grossRevenue = paidOrders.reduce(
      (sum, o) => sum + Number(o.finalAmount || 0),
      0,
    );

    // 2. Tinh tong tien hoan vé cua su kien
    const eventRefunds = await db
      .select({
        amount: refunds.amount,
      })
      .from(refunds)
      .innerJoin(orders, eq(refunds.orderId, orders.id))
      .where(
        and(
          eq(orders.eventId, eventId),
          inArray(refunds.status, ["PENDING", "COMPLETED"]),
        ),
      );

    const refundDeduction = eventRefunds.reduce(
      (sum, r) => sum + Number(r.amount || 0),
      0,
    );

    // 3. Tinh toan phan bo tai chinh
    const calculation = calculatePayout(grossRevenue, refundDeduction);

    if (existingPayout) {
      // Cap nhat lenh quyet toan hien co (trang thai PENDING hoac HOLD)
      const [updated] = await db
        .update(payouts)
        .set({
          totalRevenue: String(calculation.grossRevenue),
          platformFee: String(calculation.platformFee),
          gatewayFee: String(calculation.gatewayFee),
          refundDeduction: String(calculation.refundDeduction),
          netPayout: String(calculation.netPayout),
          updatedAt: new Date(),
        })
        .where(eq(payouts.id, existingPayout.id))
        .returning();

      return updated;
    }

    // Tao moi lenh quyet toan
    const [created] = await db
      .insert(payouts)
      .values({
        organizerId: event.organizerId,
        eventId: event.id,
        totalRevenue: String(calculation.grossRevenue),
        platformFee: String(calculation.platformFee),
        gatewayFee: String(calculation.gatewayFee),
        refundDeduction: String(calculation.refundDeduction),
        netPayout: String(calculation.netPayout),
        status: PayoutStatus.PENDING,
      })
      .returning();

    return created;
  }

  /**
   * Phe duyet lenh chi tra va ghi audit log
   */
  async approvePayout(
    payoutId: string,
    adminUserId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
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
        "PAYOUT_ALREADY_APPROVED: Lệnh chi trả này đã được phê duyệt trước đó",
      );
    }

    const now = new Date();

    return await db.transaction(async (tx) => {
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
        targetId: payout.id,
        changes: {
          oldStatus: payout.status,
          newStatus: PayoutStatus.PAID_OUT,
          approvedBy: adminUserId,
          paidOutAt: now.toISOString(),
        },
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      });

      return {
        ...updated,
        message: "Lệnh chi trả đã được phê duyệt thành công.",
      };
    });
  }

  /**
   * Tam giu lenh chi tra khi co khieu nai hoac tranh chap
   */
  async holdPayout(
    payoutId: string,
    reason: string,
    adminUserId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
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
      throw new BadRequestException(
        "CANNOT_HOLD_PAID_OUT: Không thể tạm giữ lệnh chi trả đã hoàn tất",
      );
    }

    const now = new Date();

    return await db.transaction(async (tx) => {
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
        targetId: payout.id,
        changes: {
          oldStatus: payout.status,
          newStatus: PayoutStatus.HOLD,
          holdReason: reason,
        },
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      });

      return updated;
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
      .innerJoin(organizerProfiles, eq(payouts.organizerId, organizerProfiles.id))
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
  async getOrganizerPayouts(
    organizerProfileId: string,
    query: OrganizerPayoutQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const whereClause = eq(payouts.organizerId, organizerProfileId);

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
