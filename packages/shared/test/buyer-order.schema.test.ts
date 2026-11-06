import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BuyerOrderQuerySchema,
  MyTicketsQuerySchema,
  OrderStatus,
  TicketStatus,
} from "../src";

describe("Buyer Order & Tickets Schemas", () => {
  it("BuyerOrderQuerySchema parses defaults correctly", () => {
    const result = BuyerOrderQuerySchema.parse({});
    assert.equal(result.page, 1);
    assert.equal(result.limit, 10);
    assert.equal(result.status, undefined);
  });

  it("BuyerOrderQuerySchema validates status and clamps limit", () => {
    const result = BuyerOrderQuerySchema.parse({
      page: "2",
      limit: "25",
      status: OrderStatus.PAID,
    });
    assert.equal(result.page, 2);
    assert.equal(result.limit, 25);
    assert.equal(result.status, OrderStatus.PAID);

    assert.throws(() => BuyerOrderQuerySchema.parse({ limit: 100 }));
  });

  it("MyTicketsQuerySchema parses defaults and UUID filter", () => {
    const defaultRes = MyTicketsQuerySchema.parse({});
    assert.equal(defaultRes.page, 1);
    assert.equal(defaultRes.limit, 20);

    const validUuid = "123e4567-e89b-12d3-a456-426614174000";
    const filteredRes = MyTicketsQuerySchema.parse({
      eventId: validUuid,
      status: TicketStatus.SOLD,
    });
    assert.equal(filteredRes.eventId, validUuid);
    assert.equal(filteredRes.status, TicketStatus.SOLD);
  });
});
