import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  SeatStreamService,
  SeatStatusChangedPayload,
} from "../src/events/seat-stream.service";

describe("Seat Status Publisher Hooks Tests", () => {
  it("should verify publisher payload format for HELD status", async () => {
    const published: { eventId: string; payload: SeatStatusChangedPayload }[] =
      [];
    const mockSeatStreamService: Partial<SeatStreamService> = {
      publishSeatStatusChanged: async (
        eventId: string,
        payload: SeatStatusChangedPayload,
      ) => {
        published.push({ eventId, payload });
      },
    };

    const expiresAt = new Date(Date.now() + 300000).toISOString();
    await mockSeatStreamService.publishSeatStatusChanged!("event-1", {
      seatIds: ["seat-1", "seat-2"],
      status: "HELD",
      expiresAt,
    });

    assert.equal(published.length, 1);
    assert.equal(published[0]!.eventId, "event-1");
    assert.equal(published[0]!.payload.status, "HELD");
    assert.deepEqual(published[0]!.payload.seatIds, ["seat-1", "seat-2"]);
    assert.equal(published[0]!.payload.expiresAt, expiresAt);
  });

  it("should verify publisher payload format for AVAILABLE status (release/refund/cleanup)", async () => {
    const published: { eventId: string; payload: SeatStatusChangedPayload }[] =
      [];
    const mockSeatStreamService: Partial<SeatStreamService> = {
      publishSeatStatusChanged: async (
        eventId: string,
        payload: SeatStatusChangedPayload,
      ) => {
        published.push({ eventId, payload });
      },
    };

    await mockSeatStreamService.publishSeatStatusChanged!("event-2", {
      seatIds: ["seat-3"],
      status: "AVAILABLE",
      expiresAt: null,
    });

    assert.equal(published.length, 1);
    assert.equal(published[0]!.eventId, "event-2");
    assert.equal(published[0]!.payload.status, "AVAILABLE");
    assert.equal(published[0]!.payload.expiresAt, null);
  });

  it("should verify publisher payload format for SOLD status (payment IPN)", async () => {
    const published: { eventId: string; payload: SeatStatusChangedPayload }[] =
      [];
    const mockSeatStreamService: Partial<SeatStreamService> = {
      publishSeatStatusChanged: async (
        eventId: string,
        payload: SeatStatusChangedPayload,
      ) => {
        published.push({ eventId, payload });
      },
    };

    await mockSeatStreamService.publishSeatStatusChanged!("event-3", {
      seatIds: ["seat-4", "seat-5"],
      status: "SOLD",
      expiresAt: null,
    });

    assert.equal(published.length, 1);
    assert.equal(published[0]!.eventId, "event-3");
    assert.equal(published[0]!.payload.status, "SOLD");
    assert.equal(published[0]!.payload.expiresAt, null);
  });
});
