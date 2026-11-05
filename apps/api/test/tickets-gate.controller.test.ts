import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TicketsController } from "../src/tickets/tickets.controller";
import { GateController } from "../src/tickets/gate.controller";
import { TicketsService } from "../src/tickets/tickets.service";
import { AuthenticatedUser } from "../src/auth/decorators/current-user.decorator";
import {
  UserRole,
  GetTicketQrResponse,
  GateScanResponse,
  GateLookupResponse,
} from "@tickethub/shared";
import { BadRequestException } from "@nestjs/common";

describe("TicketsController & GateController Unit Tests", () => {
  const mockUser: AuthenticatedUser = {
    userId: "buyer-123",
    email: "buyer@tickethub.vn",
    role: UserRole.BUYER,
  };

  const mockStaffUser: AuthenticatedUser = {
    userId: "staff-123",
    email: "staff@tickethub.vn",
    role: UserRole.GATE_STAFF,
  };

  const mockTicketsService = {
    getTicketQr: async (
      _userId: string,
      _role: string,
      ticketId: string,
    ): Promise<GetTicketQrResponse> => {
      return {
        ticketId,
        qrToken: "mock.ed25519.token",
        expiresAt: new Date().toISOString(),
        remainingSeconds: 30,
      };
    },
    scanTicket: async (
      _staffUserId: string,
      _staffRole: string,
      _dto: unknown,
    ): Promise<GateScanResponse> => {
      return {
        ticketId: "ticket-123",
        ticketCode: "TK-12345",
        status: "CHECKED_IN",
        eventTitle: "Concert Test",
        ticketTypeName: "VIP",
        seatLabel: "Hang A - 01",
        isSeated: true,
        buyerName: "Nguyen Van A",
        checkedInAt: new Date().toISOString(),
        staffId: "staff-123",
      };
    },
    lookupTicket: async (
      _staffUserId: string,
      _staffRole: string,
      _dto: unknown,
    ): Promise<GateLookupResponse> => {
      return {
        ticketId: "ticket-123",
        ticketCode: "TK-12345",
        status: "CHECKED_IN",
        eventTitle: "Concert Test",
        ticketTypeName: "VIP",
        seatLabel: "Hang A - 01",
        isSeated: true,
        buyerName: "Nguyen Van A",
        checkedInAt: new Date().toISOString(),
        staffId: "staff-123",
        method: "MANUAL_LOOKUP",
      };
    },
  } as unknown as TicketsService;

  const ticketsController = new TicketsController(mockTicketsService);
  const gateController = new GateController(mockTicketsService);

  it("successfully retrieves dynamic QR token via TicketsController", async () => {
    const res = await ticketsController.getQrToken(mockUser, "tkt-123");
    assert.equal(res.ticketId, "tkt-123");
    assert.equal(res.qrToken, "mock.ed25519.token");
    assert.equal(res.remainingSeconds, 30);
  });

  it("successfully scans ticket via GateController", async () => {
    const res = await gateController.scanTicket(mockStaffUser, {
      qrToken: "valid.token",
      gateId: "7b82fe51-4029-4d2c-9a3b-285b001a1d12",
    });
    assert.equal(res.status, "CHECKED_IN");
    assert.equal(res.ticketId, "ticket-123");
  });

  it("rejects scan request when qrToken is invalid or empty", async () => {
    await assert.rejects(
      async () => gateController.scanTicket(mockStaffUser, { qrToken: "" }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      },
    );
  });

  it("successfully performs manual lookup via GateController", async () => {
    const res = await gateController.lookupTicket(mockStaffUser, {
      eventId: "a313da1b-cb7c-4734-8f61-5fcfcc515de3",
      ticketCode: "TK-12345",
      phoneOrEmailLast4: "1234",
      reason: "Het pin",
    });
    assert.equal(res.method, "MANUAL_LOOKUP");
  });
});
