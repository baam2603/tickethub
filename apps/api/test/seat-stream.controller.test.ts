import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PublicEventsController } from "../src/events/events.controller";
import type { SeatStreamService, SeatStatusChangedPayload } from "../src/events/seat-stream.service";
import type { EventsService } from "../src/events/events.service";
import type { EventReadCacheService } from "../src/events/event-read-cache.service";
import { of, firstValueFrom } from "rxjs";
import type { FastifyRequest } from "fastify";

describe("PublicEventsController SSE Seat Stream Tests", () => {
  it("should expose streamSeats endpoint returning Observable of seat status events", async () => {
    let requestedEventId = "";
    const testPayload: SeatStatusChangedPayload = {
      seatIds: ["seat-uuid-1"],
      status: "HELD",
      expiresAt: "2026-11-06T12:00:00.000Z",
    };

    const mockSeatStreamService = {
      createSeatStream: (eventId: string) => {
        requestedEventId = eventId;
        return of({
          type: "seat_status_changed",
          data: testPayload,
        });
      },
    } as unknown as SeatStreamService;

    const controller = new PublicEventsController(
      {} as EventsService,
      {} as EventReadCacheService,
      mockSeatStreamService,
    );

    const mockReq = {
      raw: {
        signal: new AbortController().signal,
      },
    } as unknown as FastifyRequest;

    const stream$ = controller.streamSeats(
      "b2c6e643-4e3a-4db3-80b6-1ef21b1b46a2",
      mockReq,
    );

    assert(stream$ !== undefined, "streamSeats should return an Observable");
    const event = await firstValueFrom(stream$);

    assert.equal(requestedEventId, "b2c6e643-4e3a-4db3-80b6-1ef21b1b46a2");
    assert.equal(event.type, "seat_status_changed");
    assert.deepEqual(event.data, testPayload);
  });
});
