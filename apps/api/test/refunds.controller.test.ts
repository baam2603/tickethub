import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { RefundsController } from "../src/refunds/refunds.controller";
import type { RefundsService } from "../src/refunds/refunds.service";
import type { AuthenticatedUser } from "../src/auth/decorators/current-user.decorator";
import type {
  RefundPreviewRequest,
  RefundPreviewResponse,
  RefundExecuteRequest,
  RefundExecuteResponse,
} from "@tickethub/shared";

describe("RefundsController Unit Tests", () => {
  const mockUser: AuthenticatedUser = {
    userId: "user-123",
    email: "test@tickethub.vn",
    role: "BUYER",
  };

  const mockRefundsService = {
    previewRefund: async (
      userId: string,
      role: string,
      dto: RefundPreviewRequest,
    ): Promise<RefundPreviewResponse> => {
      return {
        orderId: dto.orderId,
        policyType: "FLEXIBLE",
        daysUntilEvent: 10,
        refundPercentage: 100,
        items: [],
        totalRefundAmount: 2500000,
        totalFeeDeducted: 0,
      };
    },
    executeRefund: async (
      _userId: string,
      _role: string,
      dto: RefundExecuteRequest,
      _idempotencyKey: string,
    ): Promise<RefundExecuteResponse> => {
      return {
        refundId: "ref-123",
        refundIds: ["ref-123"],
        orderId: dto.orderId,
        status: "PROCESSING",
        refundAmount: 2500000,
        cancelledTicketCount: 1,
        orderStatus: "PAID",
      };
    },
  } as unknown as RefundsService;

  const controller = new RefundsController(mockRefundsService);

  it("successfully previews refund", async () => {
    const res = await controller.preview(mockUser, {
      orderId: "00000000-0000-4000-8000-000000000001",
      ticketIds: ["00000000-0000-4000-8000-000000000002"],
    });

    assert.equal(res.orderId, "00000000-0000-4000-8000-000000000001");
    assert.equal(res.totalRefundAmount, 2500000);
  });

  it("throws BadRequestException when Idempotency-Key header is missing", async () => {
    await assert.rejects(
      async () => {
        await controller.request(mockUser, "", {
          orderId: "00000000-0000-4000-8000-000000000001",
          ticketIds: ["00000000-0000-4000-8000-000000000002"],
          reason: "Bận việc đột xuất",
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match(err.message, /Idempotency-Key/i);
        return true;
      },
    );
  });

  it("successfully executes refund when Idempotency-Key header is present", async () => {
    const res = await controller.request(mockUser, "idem-key-123", {
      orderId: "00000000-0000-4000-8000-000000000001",
      ticketIds: ["00000000-0000-4000-8000-000000000002"],
      reason: "Bận việc đột xuất",
    });

    assert.equal(res.refundId, "ref-123");
    assert.equal(res.refundAmount, 2500000);
  });
});
