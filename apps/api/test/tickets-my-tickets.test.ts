import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MyTicketsQuerySchema, TicketStatus } from "@tickethub/shared";

describe("MyTickets Query Defaults & Logic", () => {
  it("MyTicketsQuerySchema sets proper default pagination", () => {
    const q = MyTicketsQuerySchema.parse({});
    assert.equal(q.page, 1);
    assert.equal(q.limit, 20);
    assert.equal(q.status, undefined);
  });

  it("handles valid status override", () => {
    const q = MyTicketsQuerySchema.parse({ status: TicketStatus.CANCELLED });
    assert.equal(q.status, TicketStatus.CANCELLED);
  });
});
