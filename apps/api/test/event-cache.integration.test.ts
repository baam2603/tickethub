import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Redis from "ioredis";
import { inArray, eq } from "drizzle-orm";

import { EventStatus, SeatStatus } from "@tickethub/shared";
import { db } from "../src/database/db";
import {
  events,
  ticketTypes,
  seats,
  organizerProfiles,
  users,
} from "../src/database/schema";
import { EventReadCacheService } from "../src/events/event-read-cache.service";
import { EventsService } from "../src/events/events.service";
import { env } from "../src/config/env.config";

describe("W03-BE2: Event Read Cache (UC02) Integration Test Suite", () => {
  let redis: Redis;
  let eventsService: EventsService;
  let cacheService: EventReadCacheService;

  let organizerId = "";
  let testEventId = "";
  let seatedTicketTypeId = "";
  let standingTicketTypeId = "";
  let testSeatId = "";

  before(async () => {
    redis = new Redis(env.REDIS_URL);
    eventsService = new EventsService();
    cacheService = new EventReadCacheService(redis, eventsService);

    // 1. Tim hoac tao organizer profile
    let orgProfile = await db.query.organizerProfiles.findFirst();
    if (!orgProfile) {
      let user = await db.query.users.findFirst({
        where: eq(users.email, "organizer_cache_test@tickethub.vn"),
      });
      if (!user) {
        const [u] = await db
          .insert(users)
          .values({
            email: "organizer_cache_test@tickethub.vn",
            fullName: "Ban To Chuc Cache Test",
            passwordHash: "test-hash",
            role: "ORGANIZER",
            status: "VERIFIED",
          })
          .returning();
        user = u;
      }

      const [p] = await db
        .insert(organizerProfiles)
        .values({
          userId: user!.id,
          organizationName: "Cong ty To Chuc Cache Test",
          taxId: "0108888777",
          businessRegistrationUrl: "https://example.com/license.pdf",
          status: "VERIFIED",
        })
        .returning();
      orgProfile = p;
    }
    organizerId = orgProfile.id;

    // 2. Tao su kien mau
    const stamp = Date.now();
    const startTime = new Date("2026-12-01T19:00:00.000Z");
    const endTime = new Date("2026-12-01T22:00:00.000Z");

    const [ev] = await db
      .insert(events)
      .values({
        organizerId,
        title: "Su Kien Thu Nghiem Cache Ton Kho",
        slug: `cache-event-${stamp}`,
        description:
          "Su kien danh cho kiem thu Redis Cache so do ghe va ton kho",
        city: "Hà Nội",
        category: "CONCERT",
        bannerUrl: "https://cdn.tickethub.vn/cache-banner.webp",
        venueName: "Cung Trien Lam Ha Noi",
        venueAddress: "1 Do Duc Duc, Nam Tu Liem, Ha Noi",
        status: EventStatus.PUBLISHED,
        startTime,
        endTime,
        gateOpeningTime: new Date("2026-12-01T18:00:00.000Z"),
      })
      .returning();
    testEventId = ev.id;

    // 3. Tao hang ve co ghe ngoi va ve dung
    const saleStart = new Date("2026-10-01T00:00:00.000Z");
    const saleEnd = new Date("2026-11-30T00:00:00.000Z");

    const [seatedTt] = await db
      .insert(ticketTypes)
      .values({
        eventId: testEventId,
        name: "Hang Ghe VIP A",
        price: "1500000.00",
        capacity: 10,
        sortOrder: 1,
        isSeated: true,
        saleStartTime: saleStart,
        saleEndTime: saleEnd,
      })
      .returning();
    seatedTicketTypeId = seatedTt.id;

    const [standingTt] = await db
      .insert(ticketTypes)
      .values({
        eventId: testEventId,
        name: "Khu Dung Pho Thong",
        price: "400000.00",
        capacity: 50,
        heldCount: 5,
        soldCount: 10,
        sortOrder: 2,
        isSeated: false,
        saleStartTime: saleStart,
        saleEndTime: saleEnd,
      })
      .returning();
    standingTicketTypeId = standingTt.id;

    // 4. Tao 1 ghe ngoi cho hang ve VIP
    const [st] = await db
      .insert(seats)
      .values({
        eventId: testEventId,
        ticketTypeId: seatedTicketTypeId,
        zoneName: "VIP-A",
        rowLabel: "A",
        seatNumber: "1",
        status: SeatStatus.AVAILABLE,
      })
      .returning();
    testSeatId = st.id;

    // Xoa sach cache cu neu co
    await redis.del(
      `w03:seatmap:v1:${testEventId}`,
      `w03:inventory:v1:${testEventId}`,
    );
  });

  after(async () => {
    // Xoa cache va du lieu test
    await redis.del(
      `w03:seatmap:v1:${testEventId}`,
      `w03:inventory:v1:${testEventId}`,
    );
    await redis.quit();

    if (testSeatId) {
      await db.delete(seats).where(eq(seats.id, testSeatId));
    }
    if (seatedTicketTypeId || standingTicketTypeId) {
      await db
        .delete(ticketTypes)
        .where(
          inArray(ticketTypes.id, [seatedTicketTypeId, standingTicketTypeId]),
        );
    }
    if (testEventId) {
      await db.delete(events).where(eq(events.id, testEventId));
    }
  });

  describe("1. Cache so do ghe (SeatMap) TTL 60 giay", () => {
    it("Goi lan dau (Cache Miss) -> Doc DB va luu vao Redis voi TTL <= 60s", async () => {
      const cacheKey = `w03:seatmap:v1:${testEventId}`;

      // Xac nhan truoc khi goi chua co trong Redis
      const before = await redis.get(cacheKey);
      assert.equal(before, null);

      const seatmap = await cacheService.getSeatMap(testEventId);
      assert.ok(seatmap);
      assert.equal(seatmap.eventId, testEventId);

      // Kiem tra Redis da duoc set
      const cachedRaw = await redis.get(cacheKey);
      assert.ok(cachedRaw, "Du lieu phai duoc ghi vao Redis");

      const parsed = JSON.parse(cachedRaw);
      assert.equal(parsed.eventId, testEventId);

      // Kiem tra TTL <= 60s va > 0
      const ttl = await redis.ttl(cacheKey);
      assert.ok(ttl > 0 && ttl <= 60, `TTL phai <= 60s, nhan duoc: ${ttl}`);
    });

    it("Goi lan hai (Cache Hit) -> Tra ve du lieu truc tiep tu Redis", async () => {
      const cacheKey = `w03:seatmap:v1:${testEventId}`;

      // Gia lap du lieu dac biet trong Redis de xac nhan Cache Hit
      const customPayload = {
        eventId: testEventId,
        cachedMarker: "from-redis-test",
      };
      await redis.set(cacheKey, JSON.stringify(customPayload), "EX", 60);

      const res = await cacheService.getSeatMap(testEventId);
      assert.equal(
        (res as unknown as { cachedMarker?: string }).cachedMarker,
        "from-redis-test",
      );
    });
  });

  describe("2. Cache ton kho (Inventory) TTL 60 giay", () => {
    it("Tinh toan ton kho chinh xac cho ca ve dung va ghe ngoi", async () => {
      const cacheKey = `w03:inventory:v1:${testEventId}`;
      await redis.del(cacheKey);

      const inventory = await cacheService.getInventory(testEventId);
      assert.ok(inventory);
      assert.equal(inventory.eventId, testEventId);
      assert.equal(inventory.items.length, 2);

      // Ve ngoi
      const seatedItem = inventory.items.find((i) => i.isSeated);
      assert.ok(seatedItem);
      assert.equal(seatedItem.available, 1);
      assert.equal(seatedItem.held, 0);
      assert.equal(seatedItem.sold, 0);

      // Ve dung
      const standingItem = inventory.items.find((i) => !i.isSeated);
      assert.ok(standingItem);
      assert.equal(standingItem.capacity, 50);
      assert.equal(standingItem.held, 5);
      assert.equal(standingItem.sold, 10);
      assert.equal(standingItem.available, 35); // 50 - 5 - 10

      // Kiem tra Redis da cache voi TTL
      const ttl = await redis.ttl(cacheKey);
      assert.ok(ttl > 0 && ttl <= 60);
    });
  });

  describe("3. Vo hieu hoa Cache (Invalidation)", () => {
    it("invalidate() xoa sach ca cache seatmap va inventory khoi Redis", async () => {
      const seatmapKey = `w03:seatmap:v1:${testEventId}`;
      const inventoryKey = `w03:inventory:v1:${testEventId}`;

      // Dat du lieu mau vao 2 khoa
      await redis.set(seatmapKey, "test-seatmap", "EX", 60);
      await redis.set(inventoryKey, "test-inventory", "EX", 60);

      // Goi invalidate
      await cacheService.invalidate(testEventId);

      // Xac nhan ca 2 khoa da bi xoa
      const [sm, inv] = await Promise.all([
        redis.get(seatmapKey),
        redis.get(inventoryKey),
      ]);
      assert.equal(sm, null, "Khoa seatmap phai bi xoa khoi Redis");
      assert.equal(inv, null, "Khoa inventory phai bi xoa khoi Redis");
    });
  });

  describe("4. Phuc hoi khi Redis loi (Cache-aside Fallback)", () => {
    it("Khi Redis gap loi get, he thong van doc du lieu dung tu PostgreSQL ma khong throw 500", async () => {
      // Tao redis mock nem loi
      const brokenRedis = {
        get: async () => {
          throw new Error("Redis connection refused");
        },
        set: async () => {
          throw new Error("Redis write failure");
        },
      } as unknown as Redis;

      const fallbackCache = new EventReadCacheService(
        brokenRedis,
        eventsService,
      );

      // Goi getInventory van thanh cong
      const inv = await fallbackCache.getInventory(testEventId);
      assert.ok(inv);
      assert.equal(inv.eventId, testEventId);
      assert.equal(inv.items.length, 2);

      // Goi getSeatMap van thanh cong
      const sm = await fallbackCache.getSeatMap(testEventId);
      assert.ok(sm);
      assert.equal(sm.eventId, testEventId);
    });
  });
});
