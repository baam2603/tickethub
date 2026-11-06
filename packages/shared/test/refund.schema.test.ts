import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RefundPreviewRequestSchema,
  RefundExecuteRequestSchema,
} from "../dist/index.js";

describe("Refund Zod Schemas", () => {
  it("validates preview request with valid orderId and ticketIds", () => {
    const valid = {
      orderId: "e742fd19-f438-4ae8-9f75-f8d9ca26433b",
      ticketIds: ["34e9dcbc-3184-4f12-9777-da70b8b6001f"],
    };
    const parsed = RefundPreviewRequestSchema.safeParse(valid);
    assert.equal(parsed.success, true);
  });

  it("rejects preview request with empty ticketIds", () => {
    const invalid = {
      orderId: "e742fd19-f438-4ae8-9f75-f8d9ca26433b",
      ticketIds: [],
    };
    const parsed = RefundPreviewRequestSchema.safeParse(invalid);
    assert.equal(parsed.success, false);
  });

  it("validates execute request with valid reason", () => {
    const valid = {
      orderId: "e742fd19-f438-4ae8-9f75-f8d9ca26433b",
      ticketIds: ["34e9dcbc-3184-4f12-9777-da70b8b6001f"],
      reason: "Ban viec dot xuat",
    };
    const parsed = RefundExecuteRequestSchema.safeParse(valid);
    assert.equal(parsed.success, true);
  });
});
