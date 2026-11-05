import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SeatStreamService } from "../src/events/seat-stream.service";
import type { SeatStatusChangedPayload } from "../src/events/seat-stream.service";
import type Redis from "ioredis";
import { firstValueFrom } from "rxjs";

describe("SeatStreamService Unit Tests", () => {
  let mockPublisher: Partial<Redis>;
  let mockSubscriber: {
    subscribe: (...args: string[]) => Promise<number>;
    unsubscribe: (...args: string[]) => Promise<number>;
    on: (
      event: string,
      handler: (channel: string, message: string) => void,
    ) => unknown;
    duplicate: () => unknown;
  };
  let messageHandler: ((channel: string, message: string) => void) | null =
    null;
  let service: SeatStreamService;

  beforeEach(() => {
    messageHandler = null;
    mockSubscriber = {
      subscribe: async () => 1,
      unsubscribe: async () => 1,
      on: (
        event: string,
        handler: (channel: string, message: string) => void,
      ) => {
        if (event === "message") {
          messageHandler = handler;
        }
        return mockSubscriber;
      },
      duplicate: () => mockSubscriber,
    };

    mockPublisher = {
      publish: async () => 1,
    };

    service = new SeatStreamService(
      mockPublisher as Redis,
      mockSubscriber as unknown as Redis,
    );
  });

  it("should publish seat_status_changed message to Redis channel", async () => {
    let publishedChannel = "";
    let publishedMessage = "";

    mockPublisher.publish = async (channel: string, message: string) => {
      publishedChannel = channel;
      publishedMessage = message;
      return 1;
    };

    const payload: SeatStatusChangedPayload = {
      seatIds: ["s1-uuid", "s2-uuid"],
      status: "HELD",
      expiresAt: "2026-11-06T12:00:00.000Z",
    };

    await service.publishSeatStatusChanged("event-123", payload);

    assert.equal(publishedChannel, "events:event-123:seats");
    const parsed = JSON.parse(publishedMessage);
    assert.deepEqual(parsed, payload);
  });

  it("should not throw error if Redis publish fails", async () => {
    mockPublisher.publish = async () => {
      throw new Error("Redis connection dropped");
    };

    await assert.doesNotReject(async () => {
      await service.publishSeatStatusChanged("event-123", {
        seatIds: ["s1-uuid"],
        status: "AVAILABLE",
        expiresAt: null,
      });
    });
  });

  it("should subscribe to Redis channel on first client connection and reuse on second", async () => {
    const subscribedChannels: string[] = [];
    mockSubscriber.subscribe = async (channel: string) => {
      subscribedChannels.push(channel);
      return 1;
    };

    const stream1$ = service.createSeatStream("event-123");
    const sub1 = stream1$.subscribe();

    assert.equal(subscribedChannels.length, 1);
    assert.equal(subscribedChannels[0], "events:event-123:seats");
    assert.equal(service.getChannelRefCount("event-123"), 1);

    // Second connection for same event
    const stream2$ = service.createSeatStream("event-123");
    const sub2 = stream2$.subscribe();

    assert.equal(
      subscribedChannels.length,
      1,
      "Should not call subscribe again",
    );
    assert.equal(service.getChannelRefCount("event-123"), 2);

    sub1.unsubscribe();
    assert.equal(service.getChannelRefCount("event-123"), 1);

    sub2.unsubscribe();
    assert.equal(service.getChannelRefCount("event-123"), 0);
  });

  it("should unsubscribe from Redis channel when all subscribers disconnect", async () => {
    const unsubscribedChannels: string[] = [];
    mockSubscriber.unsubscribe = async (channel: string) => {
      unsubscribedChannels.push(channel);
      return 1;
    };

    const stream$ = service.createSeatStream("event-456");
    const sub = stream$.subscribe();

    assert.equal(service.getChannelRefCount("event-456"), 1);

    sub.unsubscribe();

    assert.equal(service.getChannelRefCount("event-456"), 0);
    assert.equal(unsubscribedChannels.length, 1);
    assert.equal(unsubscribedChannels[0], "events:event-456:seats");
  });

  it("should receive message from Redis and dispatch seat_status_changed event to stream", async () => {
    const stream$ = service.createSeatStream("event-789");

    const eventPromise = firstValueFrom(stream$);

    assert(messageHandler !== null, "Message handler should be registered");

    const payload: SeatStatusChangedPayload = {
      seatIds: ["s10"],
      status: "SOLD",
      expiresAt: null,
    };

    messageHandler!("events:event-789:seats", JSON.stringify(payload));

    const received = await eventPromise;
    assert.equal(received.type, "seat_status_changed");
    assert.deepEqual(received.data, payload);
  });
});
