import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EventKillSwitchRequestSchema,
  EventResumeRequestSchema,
  AuditLogQuerySchema,
} from "../dist/index.js";

describe("UC10 Admin Kill Switch & Audit Log Schemas", () => {
  it("validates EventKillSwitchRequestSchema correctly", () => {
    const valid = EventKillSwitchRequestSchema.parse({
      reason: "Phat hien gian lan ve cho den",
      version: 2,
    });
    assert.equal(valid.reason, "Phat hien gian lan ve cho den");
    assert.equal(valid.version, 2);

    assert.throws(() => EventKillSwitchRequestSchema.parse({ reason: "ngan" }));
  });

  it("validates EventResumeRequestSchema correctly", () => {
    const valid = EventResumeRequestSchema.parse({
      reason: "Da giai quyet xong su co ban quyen",
    });
    assert.equal(valid.reason, "Da giai quyet xong su co ban quyen");

    const empty = EventResumeRequestSchema.parse({});
    assert.equal(empty.reason, undefined);
  });

  it("validates AuditLogQuerySchema with defaults and coercion", () => {
    const parsed = AuditLogQuerySchema.parse({
      page: "2",
      limit: "15",
      action: "EVENT_KILL_SWITCH_ACTIVATED",
    });
    assert.equal(parsed.page, 2);
    assert.equal(parsed.limit, 15);
    assert.equal(parsed.action, "EVENT_KILL_SWITCH_ACTIVATED");

    const defaultParsed = AuditLogQuerySchema.parse({});
    assert.equal(defaultParsed.page, 1);
    assert.equal(defaultParsed.limit, 20);
  });
});
