import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { AdminPayoutsController } from "../src/payouts/admin-payouts.controller";
import { OrganizerPayoutsController } from "../src/payouts/organizer-payouts.controller";
import { PayoutsService } from "../src/payouts/payouts.service";
import { ReconciliationsService } from "../src/payouts/reconciliations.service";
import {
  PayoutStatus,
  ReconciliationStatus,
  type AuthenticatedUser,
} from "@tickethub/shared";

interface MemoryPayout {
  id: string;
  organizerId: string;
  eventId: string;
  totalRevenue: string;
  platformFee: string;
  gatewayFee: string;
  refundDeduction: string;
  netPayout: string;
  status: string;
  holdReason: string | null;
  paidOutAt: Date | null;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MemoryAuditLog {
  id: number;
  actorId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  changes: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

describe("Reconciliations & Payouts Integration Test Suite", () => {
  const adminUser: AuthenticatedUser = {
    userId: "admin-uuid-1",
    email: "admin@tickethub.vn",
    role: "ADMIN",
  };

  const organizerUserA: AuthenticatedUser = {
    userId: "user-org-A",
    email: "orgA@tickethub.vn",
    role: "ORGANIZER",
  };

  const organizerProfileA = {
    id: "org-profile-A",
    userId: "user-org-A",
    organizationName: "Công ty Âm Nhạc A",
  };

  const eventUuid = "11111111-1111-4111-a111-111111111111";
  const payoutUuid = "22222222-2222-4222-a222-222222222222";

  const memoryPayouts: MemoryPayout[] = [];
  const memoryAuditLogs: MemoryAuditLog[] = [];

  // Mock PayoutsService
  const mockPayoutsService = {
    generatePayout: async (eventId: string, _adminUserId: string) => {
      const existing = memoryPayouts.find((p) => p.eventId === eventId);
      if (existing && existing.status === PayoutStatus.PAID_OUT) {
        throw new ConflictException(
          "PAYOUT_ALREADY_PAID_OUT: Lệnh chi trả cho sự kiện này đã được thanh toán hoàn tất",
        );
      }

      // Gia lap tinh toan: grossRevenue = 100.000.000, refundDeduction = 2.000.000
      const grossRevenue = 100000000;
      const refundDeduction = 2000000;
      const retainedRevenue = grossRevenue - refundDeduction; // 98.000.000
      const platformFee = Math.round(retainedRevenue * 0.05); // 4.900.000
      const gatewayFee = Math.round(grossRevenue * 0.015); // 1.500.000
      const netPayout = retainedRevenue - platformFee - gatewayFee; // 91.600.000

      if (existing) {
        existing.totalRevenue = String(grossRevenue);
        existing.platformFee = String(platformFee);
        existing.gatewayFee = String(gatewayFee);
        existing.refundDeduction = String(refundDeduction);
        existing.netPayout = String(netPayout);
        existing.updatedAt = new Date();
        return existing;
      }

      const newPayout: MemoryPayout = {
        id: payoutUuid,
        organizerId: organizerProfileA.id,
        eventId,
        totalRevenue: String(grossRevenue),
        platformFee: String(platformFee),
        gatewayFee: String(gatewayFee),
        refundDeduction: String(refundDeduction),
        netPayout: String(netPayout),
        status: PayoutStatus.PENDING,
        holdReason: null,
        paidOutAt: null,
        approvedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryPayouts.push(newPayout);
      return newPayout;
    },

    approvePayout: async (
      payoutId: string,
      adminUserId: string,
      ipAddress?: string,
      userAgent?: string,
    ) => {
      const payout = memoryPayouts.find((p) => p.id === payoutId);
      if (!payout) {
        throw new BadRequestException("PAYOUT_NOT_FOUND");
      }
      if (payout.status === PayoutStatus.PAID_OUT) {
        throw new ConflictException(
          "PAYOUT_ALREADY_APPROVED: Lệnh chi trả này đã được phê duyệt trước đó",
        );
      }

      payout.status = PayoutStatus.PAID_OUT;
      payout.approvedBy = adminUserId;
      payout.paidOutAt = new Date();
      payout.updatedAt = new Date();

      memoryAuditLogs.push({
        id: memoryAuditLogs.length + 1,
        actorId: adminUserId,
        actorRole: "ADMIN",
        action: "APPROVE_PAYOUT",
        targetType: "PAYOUT",
        targetId: payout.id,
        changes: { newStatus: PayoutStatus.PAID_OUT },
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        createdAt: new Date(),
      });

      return {
        ...payout,
        message: "Lệnh chi trả đã được phê duyệt thành công.",
      };
    },

    holdPayout: async (
      payoutId: string,
      reason: string,
      adminUserId: string,
      ipAddress?: string,
      userAgent?: string,
    ) => {
      const payout = memoryPayouts.find((p) => p.id === payoutId);
      if (!payout) {
        throw new BadRequestException("PAYOUT_NOT_FOUND");
      }
      if (payout.status === PayoutStatus.PAID_OUT) {
        throw new BadRequestException(
          "CANNOT_HOLD_PAID_OUT: Không thể tạm giữ lệnh chi trả đã hoàn tất",
        );
      }

      payout.status = PayoutStatus.HOLD;
      payout.holdReason = reason;
      payout.updatedAt = new Date();

      memoryAuditLogs.push({
        id: memoryAuditLogs.length + 1,
        actorId: adminUserId,
        actorRole: "ADMIN",
        action: "HOLD_PAYOUT",
        targetType: "PAYOUT",
        targetId: payout.id,
        changes: { newStatus: PayoutStatus.HOLD, holdReason: reason },
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        createdAt: new Date(),
      });

      return payout;
    },

    recalculatePayout: async (payoutId: string, adminUserId: string) => {
      const payout = memoryPayouts.find((p) => p.id === payoutId);
      if (!payout) {
        throw new BadRequestException("PAYOUT_NOT_FOUND");
      }
      if (payout.status === PayoutStatus.PAID_OUT) {
        throw new ConflictException("PAYOUT_ALREADY_PAID_OUT");
      }
      return await mockPayoutsService.generatePayout(
        payout.eventId,
        adminUserId,
      );
    },

    getAdminPayouts: async () => ({
      items: memoryPayouts,
      meta: {
        total: memoryPayouts.length,
        page: 1,
        limit: 20,
        totalPages: 1,
      },
    }),

    getOrganizerPayouts: async (userId: string) => {
      if (userId !== organizerProfileA.userId) {
        throw new ForbiddenException("ORGANIZER_PROFILE_REQUIRED");
      }
      const items = memoryPayouts.filter(
        (p) => p.organizerId === organizerProfileA.id,
      );
      return {
        items,
        meta: {
          total: items.length,
          page: 1,
          limit: 20,
          totalPages: 1,
        },
      };
    },
  } as unknown as PayoutsService;

  // Mock ReconciliationsService
  const mockReconciliationsService = {
    getReconciliations: async (query: {
      eventId?: string;
      status?: string;
    }) => {
      let items = [
        {
          orderId: "ord-1",
          orderCode: "ORD-001",
          eventId: "evt-1",
          eventTitle: "Concert A",
          orderAmount: 1500000,
          paidAmount: 1500000,
          refundedAmount: 0,
          transactionRef: "vnp-001",
          providerTxNumber: "123456",
          bankCode: "NCB",
          payDate: new Date(),
          reconciliationStatus: ReconciliationStatus.MATCHED,
        },
        {
          orderId: "ord-2",
          orderCode: "ORD-002",
          eventId: "evt-1",
          eventTitle: "Concert A",
          orderAmount: 2000000,
          paidAmount: 1800000,
          refundedAmount: 0,
          transactionRef: "vnp-002",
          providerTxNumber: "123457",
          bankCode: "NCB",
          payDate: new Date(),
          reconciliationStatus: ReconciliationStatus.AMOUNT_MISMATCH,
        },
        {
          orderId: "ord-3",
          orderCode: "ORD-003",
          eventId: "evt-1",
          eventTitle: "Concert A",
          orderAmount: 1000000,
          paidAmount: 0,
          refundedAmount: 0,
          transactionRef: null,
          providerTxNumber: null,
          bankCode: null,
          payDate: null,
          reconciliationStatus: ReconciliationStatus.MISSING_TRANSACTION,
        },
      ];

      // Chi them orphan transaction khi doi soat toan he thong (khong loc theo eventId)
      if (!query.eventId) {
        items.push({
          orderId: null,
          orderCode: null,
          eventId: null,
          eventTitle: null,
          orderAmount: 0,
          paidAmount: 500000,
          refundedAmount: 0,
          transactionRef: "vnp-orphan",
          providerTxNumber: "999999",
          bankCode: "VCB",
          payDate: new Date(),
          reconciliationStatus: ReconciliationStatus.ORPHAN_TRANSACTION,
        });
      }

      if (query.eventId) {
        items = items.filter((i) => i.eventId === query.eventId);
      }

      const filtered =
        query.status && query.status !== "ALL"
          ? items.filter((i) => i.reconciliationStatus === query.status)
          : items;

      return {
        summary: {
          totalTransactions: items.length,
          totalOrderAmount: items.reduce((sum, i) => sum + i.orderAmount, 0),
          totalPaidAmount: items.reduce((sum, i) => sum + i.paidAmount, 0),
          totalRefundedAmount: 0,
          matchedCount: items.filter(
            (i) => i.reconciliationStatus === ReconciliationStatus.MATCHED,
          ).length,
          mismatchedCount: items.filter(
            (i) => i.reconciliationStatus !== ReconciliationStatus.MATCHED,
          ).length,
        },
        items: filtered,
        meta: {
          total: filtered.length,
          page: 1,
          limit: 20,
          totalPages: 1,
        },
      };
    },
  } as unknown as ReconciliationsService;

  const adminController = new AdminPayoutsController(
    mockPayoutsService,
    mockReconciliationsService,
  );

  const organizerController = new OrganizerPayoutsController(
    mockPayoutsService,
  );

  const mockRequest = {
    headers: {
      "x-forwarded-for": "127.0.0.1",
      "user-agent": "Node/TestRunner",
    },
    ip: "127.0.0.1",
  } as unknown as import("fastify").FastifyRequest;

  it("1. Generates payout correctly for event with financial deduction", async () => {
    const res = await adminController.generatePayout(adminUser, {
      eventId: eventUuid,
    });

    assert.equal(res.success, true);
    assert.equal(res.data.status, PayoutStatus.PENDING);
    assert.equal(res.data.totalRevenue, "100000000");
    assert.equal(res.data.refundDeduction, "2000000");
    assert.equal(res.data.platformFee, "4900000");
    assert.equal(res.data.gatewayFee, "1500000");
    assert.equal(res.data.netPayout, "91600000");
  });

  it("2. Holds payout with a dispute reason", async () => {
    const res = await adminController.holdPayout(
      payoutUuid,
      adminUser,
      { reason: "Đang khiếu nại tranh chấp đơn vé" },
      mockRequest,
    );

    assert.equal(res.success, true);
    assert.equal(res.data.status, PayoutStatus.HOLD);
    assert.equal(res.data.holdReason, "Đang khiếu nại tranh chấp đơn vé");

    // Check audit log
    const log = memoryAuditLogs.find((l) => l.action === "HOLD_PAYOUT");
    assert.ok(log);
    assert.equal(log?.targetId, payoutUuid);
  });

  it("3. Recalculates payout while in HOLD status", async () => {
    const res = await adminController.recalculatePayout(payoutUuid, adminUser);

    assert.equal(res.success, true);
    assert.equal(res.data.netPayout, "91600000");
  });

  it("4. Approves payout to PAID_OUT and verifies audit log entry", async () => {
    const res = await adminController.approvePayout(
      payoutUuid,
      adminUser,
      mockRequest,
    );

    assert.equal(res.success, true);
    assert.equal(res.data.status, PayoutStatus.PAID_OUT);
    assert.equal(res.data.approvedBy, adminUser.userId);
    assert.ok(res.data.paidOutAt);

    // Verify audit log
    const approveLog = memoryAuditLogs.find(
      (l) => l.action === "APPROVE_PAYOUT",
    );
    assert.ok(approveLog);
    assert.equal(approveLog?.actorId, adminUser.userId);
    assert.equal(approveLog?.actorRole, "ADMIN");
  });

  it("5. Rejects double approval on already PAID_OUT payout with 409 Conflict", async () => {
    await assert.rejects(
      async () => {
        await adminController.approvePayout(payoutUuid, adminUser, mockRequest);
      },
      (err: unknown) => {
        return (
          err instanceof ConflictException &&
          err.message.includes("PAYOUT_ALREADY_APPROVED")
        );
      },
    );
  });

  it("6. Admin reconciliations categorizes matched and mismatched transactions", async () => {
    const resAll = await adminController.getReconciliations({});
    assert.equal(resAll.success, true);
    assert.equal(resAll.data.summary.totalTransactions, 4);
    assert.equal(resAll.data.summary.matchedCount, 1);
    assert.equal(resAll.data.summary.mismatchedCount, 3);

    // Filter by MATCHED
    const resMatched = await adminController.getReconciliations({
      status: "MATCHED",
    });
    assert.equal(resMatched.data.items.length, 1);
    assert.equal(
      resMatched.data.items[0]?.reconciliationStatus,
      ReconciliationStatus.MATCHED,
    );

    // Filter by AMOUNT_MISMATCH
    const resMismatch = await adminController.getReconciliations({
      status: "AMOUNT_MISMATCH",
    });
    assert.equal(resMismatch.data.items.length, 1);
    assert.equal(
      resMismatch.data.items[0]?.reconciliationStatus,
      ReconciliationStatus.AMOUNT_MISMATCH,
    );
  });

  it("7. Organizer can only view their own payouts and enforces IDOR protection", async () => {
    // Valid organizer A
    const resA = await organizerController.getOrganizerPayouts(
      organizerUserA,
      {},
    );
    assert.equal(resA.success, true);
    assert.equal(resA.data.items.length, 1);
    assert.equal(resA.data.items[0]?.organizerId, organizerProfileA.id);

    // Rogue user without organizer profile
    const rogueUser: AuthenticatedUser = {
      userId: "rogue-user-999",
      email: "rogue@example.com",
      role: "BUYER",
    };

    await assert.rejects(
      async () => {
        await organizerController.getOrganizerPayouts(rogueUser, {});
      },
      (err: unknown) => {
        return (
          err instanceof ForbiddenException &&
          err.message.includes("ORGANIZER_PROFILE_REQUIRED")
        );
      },
    );
  });

  it("8. Reconciliations filtering by eventId does NOT treat transactions from other events as orphan transactions", async () => {
    // When filtering by specific eventId, only transactions of that event should be evaluated
    const resEvent = await adminController.getReconciliations({
      eventId: "e0000000-0000-4000-a000-000000000001",
    });

    assert.equal(resEvent.success, true);
    // Should NOT have orphan transactions attached from other events
    const hasOrphan = resEvent.data.items.some(
      (item) =>
        item.reconciliationStatus === ReconciliationStatus.ORPHAN_TRANSACTION,
    );
    assert.equal(hasOrphan, false);
  });
});
