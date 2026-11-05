import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SeatStreamService } from "../src/events/seat-stream.service";
import type { SeatStreamMessageEvent } from "../src/events/seat-stream.service";
import type Redis from "ioredis";
import { take, toArray } from "rxjs/operators";
import { firstValueFrom } from "rxjs";

describe("E2E Integration Simulation: Realtime Seat Stream (SSE & Redis Pub/Sub)", () => {
  it("should broadcast seat status change events across multiple subscribers and clean up on teardown", async () => {
    // Simulated in-memory Redis message bus
    const redisBus = new Map<string, ((channel: string, message: string) => void)[]>();
    const activeSubscriptions = new Set<string>();

    const mockPublisher = {
      publish: async (channel: string, message: string) => {
        const listeners = redisBus.get(channel) || [];
        for (const listener of listeners) {
          listener(channel, message);
        }
        return listeners.length;
      },
    } as unknown as Redis;

    let subListener: ((channel: string, message: string) => void) | null = null;
    const mockSubscriber = {
      subscribe: async (channel: string) => {
        activeSubscriptions.add(channel);
        return 1;
      },
      unsubscribe: async (channel: string) => {
        activeSubscriptions.delete(channel);
        return 1;
      },
      on: (event: string, handler: any) => {
        if (event === "message") {
          subListener = handler;
        }
      },
      duplicate: () => mockSubscriber,
    } as unknown as Redis;

    // Connect message bus to subscriber
    const service = new SeatStreamService(mockPublisher, mockSubscriber);

    // Register bus router
    const originalPublish = mockPublisher.publish;
    mockPublisher.publish = async (channel: string, message: string) => {
      if (activeSubscriptions.has(channel) && subListener) {
        subListener(channel, message);
      }
      return 1;
    };

    const eventId = "e2e-event-uuid-100";

    // 1. Client 1 kết nối SSE
    const client1Events: SeatStreamMessageEvent[] = [];
    const stream1$ = service.createSeatStream(eventId);
    const sub1 = stream1$.subscribe((ev) => {
      if (ev.type === "seat_status_changed") {
        client1Events.push(ev);
      }
    });

    assert.equal(activeSubscriptions.has(`events:${eventId}:seats`), true);
    assert.equal(service.getChannelRefCount(eventId), 1);

    // 2. Client 2 kết nối cùng sự kiện
    const client2Events: SeatStreamMessageEvent[] = [];
    const stream2$ = service.createSeatStream(eventId);
    const sub2 = stream2$.subscribe((ev) => {
      if (ev.type === "seat_status_changed") {
        client2Events.push(ev);
      }
    });

    assert.equal(service.getChannelRefCount(eventId), 2);

    // 3. Mô phỏng: Giữ chỗ thành công (BookingService.holdSeats)
    await service.publishSeatStatusChanged(eventId, {
      seatIds: ["seat-A1", "seat-A2"],
      status: "HELD",
      expiresAt: "2026-11-06T12:05:00.000Z",
    });

    assert.equal(client1Events.length, 1);
    assert.equal(client2Events.length, 1);
    assert.equal(client1Events[0]!.type, "seat_status_changed");
    assert.deepEqual(client1Events[0]!.data, {
      seatIds: ["seat-A1", "seat-A2"],
      status: "HELD",
      expiresAt: "2026-11-06T12:05:00.000Z",
    });

    // 4. Client 1 ngắt kết nối (rời trang)
    sub1.unsubscribe();
    assert.equal(service.getChannelRefCount(eventId), 1);
    assert.equal(activeSubscriptions.has(`events:${eventId}:seats`), true);

    // 5. Mô phỏng: Thanh toán thành công (VnpayIpnService.handleIpn)
    await service.publishSeatStatusChanged(eventId, {
      seatIds: ["seat-A1", "seat-A2"],
      status: "SOLD",
      expiresAt: null,
    });

    // Client 1 không nhận thêm sự kiện
    assert.equal(client1Events.length, 1);
    // Client 2 tiếp tục nhận sự kiện SOLD
    assert.equal(client2Events.length, 2);
    assert.deepEqual(client2Events[1]!.data, {
      seatIds: ["seat-A1", "seat-A2"],
      status: "SOLD",
      expiresAt: null,
    });

    // 6. Client 2 ngắt kết nối
    sub2.unsubscribe();
    assert.equal(service.getChannelRefCount(eventId), 0);
    assert.equal(activeSubscriptions.has(`events:${eventId}:seats`), false);

    // Dọn dẹp
    await service.onApplicationShutdown();
  });
});
