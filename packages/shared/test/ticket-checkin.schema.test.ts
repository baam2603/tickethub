import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GateScanRequestSchema,
  GateLookupRequestSchema,
  GetTicketQrResponseSchema,
  GateScanResponseSchema,
  GateLookupResponseSchema,
} from "../dist/index.js";

describe("Ticket Check-in Zod Schemas", () => {
  it("validates GateScanRequest with valid qrToken and optional gateId", () => {
    const valid = {
      qrToken: "header.payload.signature",
      gateId: "7b82fe51-4029-4d2c-9a3b-285b001a1d12",
    };
    const parsed = GateScanRequestSchema.safeParse(valid);
    assert.equal(parsed.success, true);

    const validNoGate = { qrToken: "header.payload.signature" };
    const parsedNoGate = GateScanRequestSchema.safeParse(validNoGate);
    assert.equal(parsedNoGate.success, true);
  });

  it("rejects GateScanRequest with empty qrToken", () => {
    const invalid = { qrToken: "" };
    const parsed = GateScanRequestSchema.safeParse(invalid);
    assert.equal(parsed.success, false);
  });

  it("validates GateLookupRequest with 4-char string and eventId", () => {
    const valid = {
      eventId: "a313da1b-cb7c-4734-8f61-5fcfcc515de3",
      ticketCode: "TK-8F92A1B8",
      phoneOrEmailLast4: "1234",
      reason: "Dien thoai het pin",
    };
    const parsed = GateLookupRequestSchema.safeParse(valid);
    assert.equal(parsed.success, true);
  });

  it("rejects GateLookupRequest when phoneOrEmailLast4 is not 4 characters", () => {
    const invalid = {
      eventId: "a313da1b-cb7c-4734-8f61-5fcfcc515de3",
      ticketCode: "TK-8F92A1B8",
      phoneOrEmailLast4: "12",
      reason: "Dien thoai het pin",
    };
    const parsed = GateLookupRequestSchema.safeParse(invalid);
    assert.equal(parsed.success, false);
  });

  it("validates GetTicketQrResponse structure", () => {
    const valid = {
      ticketId: "34e9dcbc-3184-4f12-9777-da70b8b6001f",
      qrToken: "jwt.token.string",
      expiresAt: new Date().toISOString(),
      remainingSeconds: 30,
    };
    const parsed = GetTicketQrResponseSchema.safeParse(valid);
    assert.equal(parsed.success, true);
  });

  it("validates GateScanResponse and GateLookupResponse structures", () => {
    const scanData = {
      ticketId: "34e9dcbc-3184-4f12-9777-da70b8b6001f",
      ticketCode: "TK-8F92A1B8",
      status: "CHECKED_IN",
      eventTitle: "Concert 2026",
      ticketTypeName: "VIP A",
      zoneName: "VIP",
      seatLabel: "Hang A - 01",
      isSeated: true,
      buyerName: "Nguyen Van A",
      checkedInAt: new Date().toISOString(),
      gateId: "7b82fe51-4029-4d2c-9a3b-285b001a1d12",
      staffId: "91a82bc1-1234-4567-89ab-cdef01234567",
    };
    const parsedScan = GateScanResponseSchema.safeParse(scanData);
    assert.equal(parsedScan.success, true);

    const lookupData = {
      ...scanData,
      method: "MANUAL_LOOKUP" as const,
    };
    const parsedLookup = GateLookupResponseSchema.safeParse(lookupData);
    assert.equal(parsedLookup.success, true);
  });
});
