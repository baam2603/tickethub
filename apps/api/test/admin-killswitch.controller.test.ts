import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AdminController } from "../src/admin/admin.controller";
import { AdminService } from "../src/admin/admin.service";
import { AuthenticatedUser } from "../src/auth/decorators/current-user.decorator";
import {
  UserRole,
  EventKillSwitchData,
  EventResumeData,
  AuditLogListData,
} from "@tickethub/shared";
import { BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

describe("AdminController Kill Switch & Audit Log Unit Tests", () => {
  const mockAdmin: AuthenticatedUser = {
    userId: "admin-uuid-123",
    email: "admin@tickethub.vn",
    role: UserRole.ADMIN,
  };

  const mockRequest = {
    headers: {
      "user-agent": "TestRunner/1.0",
      "x-forwarded-for": "127.0.0.1",
    },
    ip: "127.0.0.1",
  } as unknown as FastifyRequest;

  const mockAdminService = {
    activateKillSwitch: async (
      eventId: string,
      _adminId: string,
      dto: { reason: string; version?: number },
    ): Promise<EventKillSwitchData> => {
      return {
        eventId,
        status: "SUSPENDED",
        rejectionReason: dto.reason,
        version: 2,
        cancelledPendingOrdersCount: 2,
        releasedHeldSeatsCount: 1,
        releasedHeldStandingCount: 3,
        totalReleasedHoldsCount: 4,
        suspendedAt: new Date().toISOString(),
      };
    },
    resumeEvent: async (
      eventId: string,
      _adminId: string,
      _dto: unknown,
    ): Promise<EventResumeData> => {
      return {
        eventId,
        status: "PUBLISHED",
        version: 3,
        resumedAt: new Date().toISOString(),
      };
    },
    getEventAuditLogs: async (
      eventId: string,
      _query: unknown,
    ): Promise<AuditLogListData> => {
      return {
        items: [
          {
            id: 1,
            actorId: "admin-uuid-123",
            actorRole: "ADMIN",
            action: "EVENT_KILL_SWITCH_ACTIVATED",
            targetType: "EVENT",
            targetId: eventId,
            changes: { oldStatus: "PUBLISHED", newStatus: "SUSPENDED" },
            ipAddress: "127.0.0.1",
            userAgent: "TestRunner/1.0",
            createdAt: new Date().toISOString(),
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        },
      };
    },
  } as unknown as AdminService;

  const adminController = new AdminController(mockAdminService);
  const testEventId = "b91f2a3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c";

  it("successfully activates Kill Switch via AdminController", async () => {
    const res = await adminController.activateKillSwitch(
      mockAdmin,
      testEventId,
      {
        reason: "Phat hien hanh vi gian lan ve",
      },
      mockRequest,
    );

    assert.equal(res.success, true);
    assert.equal(res.data.eventId, testEventId);
    assert.equal(res.data.status, "SUSPENDED");
    assert.equal(res.data.totalReleasedHoldsCount, 4);
  });

  it("rejects activateKillSwitch when reason is too short", async () => {
    await assert.rejects(
      async () =>
        adminController.activateKillSwitch(
          mockAdmin,
          testEventId,
          {
            reason: "ngan",
          },
          mockRequest,
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      },
    );
  });

  it("successfully resumes event via AdminController", async () => {
    const res = await adminController.resumeEvent(
      mockAdmin,
      testEventId,
      {
        reason: "Ban to chuc giai trinh hop le",
      },
      mockRequest,
    );

    assert.equal(res.success, true);
    assert.equal(res.data.eventId, testEventId);
    assert.equal(res.data.status, "PUBLISHED");
  });

  it("successfully retrieves event audit logs via AdminController", async () => {
    const res = await adminController.getEventAuditLogs(testEventId, {
      page: 1,
      limit: 10,
    });

    assert.equal(res.success, true);
    assert.equal(res.data.items.length, 1);
    assert.equal(res.data.items[0]!.action, "EVENT_KILL_SWITCH_ACTIVATED");
  });

  it("rejects getEventAuditLogs when page is invalid", async () => {
    await assert.rejects(
      async () =>
        adminController.getEventAuditLogs(testEventId, {
          page: 0,
        }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      },
    );
  });
});
