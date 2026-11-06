import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ed25519Service } from "../src/tickets/crypto/ed25519.service";
import { BadRequestException } from "@nestjs/common";

describe("Ed25519Service Cryptographic Tests", () => {
  const service = new Ed25519Service();

  it("signs and verifies a valid dynamic QR token", () => {
    const input = {
      sub: "34e9dcbc-3184-4f12-9777-da70b8b6001f",
      eventId: "a313da1b-cb7c-4734-8f61-5fcfcc515de3",
      orderId: "e742fd19-f438-4ae8-9f75-f8d9ca26433b",
      userId: "b2123456-789a-bcde-f012-3456789abcde",
    };

    const result = service.signDynamicQr(input);
    assert.ok(result.token);
    assert.equal(result.remainingSeconds, 30);

    const verified = service.verifyDynamicQr(result.token);
    assert.equal(verified.sub, input.sub);
    assert.equal(verified.eventId, input.eventId);
    assert.equal(verified.orderId, input.orderId);
    assert.equal(verified.userId, input.userId);
    assert.ok(verified.nonce);
  });

  it("rejects token with tampered payload signature", () => {
    const result = service.signDynamicQr({
      sub: "34e9dcbc-3184-4f12-9777-da70b8b6001f",
      eventId: "a313da1b-cb7c-4734-8f61-5fcfcc515de3",
      orderId: "e742fd19-f438-4ae8-9f75-f8d9ca26433b",
      userId: "b2123456-789a-bcde-f012-3456789abcde",
    });

    const parts = result.token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: "hacked-ticket-id" }),
    ).toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    assert.throws(
      () => service.verifyDynamicQr(tamperedToken),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /INVALID_QR_SIGNATURE/);
        return true;
      },
    );
  });

  it("accepts token within 35 seconds window (clock skew tolerance)", () => {
    const token = service.createTokenForTesting({
      sub: "ticket-1",
      eventId: "event-1",
      orderId: "order-1",
      userId: "user-1",
      issuedAtSecondsAgo: 25,
    });
    const verified = service.verifyDynamicQr(token);
    assert.equal(verified.sub, "ticket-1");
  });

  it("rejects token expired beyond 35 seconds", () => {
    const token = service.createTokenForTesting({
      sub: "ticket-1",
      eventId: "event-1",
      orderId: "order-1",
      userId: "user-1",
      issuedAtSecondsAgo: 36,
    });

    assert.throws(
      () => service.verifyDynamicQr(token),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /QR_TOKEN_EXPIRED/);
        return true;
      },
    );
  });

  it("rejects malformed token structure", () => {
    assert.throws(
      () => service.verifyDynamicQr("invalid-single-string"),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /MALFORMED_QR_TOKEN/);
        return true;
      },
    );
  });
});
