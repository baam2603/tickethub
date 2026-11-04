import "reflect-metadata";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, createConnection, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { JwtService } from "@nestjs/jwt";
import { eq, inArray } from "drizzle-orm";
import { EventStatus, OrderStatus, SeatStatus } from "@tickethub/shared";
import { env } from "../src/config/env.config";
import { db, sqlClient } from "../src/database/db";
import {
  events,
  orders,
  organizerProfiles,
  seats,
  ticketTypes,
  users,
} from "../src/database/schema";
import { createRedisClient, REDIS_CLIENT } from "../src/database/redis.module";
import { JwtAuthGuard } from "../src/auth/guards/jwt-auth.guard";
import { SearchController } from "../src/search/search.controller";
import { SearchService } from "../src/search/search.service";
import { SearchRateLimitGuard } from "../src/search/guards/search-rate-limit.guard";
import { WaitingRoomController } from "../src/waiting-room/waiting-room.controller";
import { WaitingRoomService } from "../src/waiting-room/waiting-room.service";
import { WaitingRoomRateLimitGuard } from "../src/waiting-room/guards/waiting-room-rate-limit.guard";
import { WaitingRoomMaintenanceTask } from "../src/waiting-room/waiting-room-maintenance.task";

@Module({})
class RegressionModule {}

describe("W03-BE2: TC15-17 va TC19-21 qua HTTP", () => {
  const redis = createRedisClient();
  const jwt = new JwtService({ secret: env.JWT_SECRET });
  const maintenance = new WaitingRoomMaintenanceTask(redis);
  const eventIds: string[] = [];
  const userIds: string[] = [];
  const category = `w03-${randomUUID().slice(0, 8)}`;
  let app: NestFastifyApplication;
  let baseUrl: string;
  let organizerId: string;
  let low: string;
  let high: string;
  let tie: string;
  let token: string;

  async function request(path: string, method = "GET", auth = token) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${auth}` },
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    return { status: response.status, body };
  }

  async function createEvent(
    title: string,
    startOffset: number,
    enabled = true,
  ) {
    const [event] = await db
      .insert(events)
      .values({
        organizerId,
        title,
        slug: `w03-regression-${randomUUID()}`,
        description: "Mo ta su kien",
        category,
        city: "Ha Noi",
        venueName: "San khau",
        venueAddress: "Ha Noi",
        bannerUrl: "https://example.com/banner.jpg",
        startTime: new Date(Date.now() + startOffset * 86400000),
        endTime: new Date(Date.now() + (startOffset + 1) * 86400000),
        gateOpeningTime: new Date(),
        status: EventStatus.PUBLISHED,
        isWaitingRoomEnabled: enabled,
        maxActiveUsers: 1,
      })
      .returning();
    eventIds.push(event!.id);
    return event!.id;
  }

  async function addTickets(
    eventId: string,
    isSeated = false,
    soldCount = 0,
    heldCount = 0,
  ) {
    const [type] = await db
      .insert(ticketTypes)
      .values({
        eventId,
        name: "GA",
        price: "100000",
        capacity: 2,
        isSeated,
        soldCount,
        heldCount,
        saleStartTime: new Date(Date.now() - 86400000),
        saleEndTime: new Date(Date.now() + 86400000),
      })
      .returning();
    return type!.id;
  }

  async function createApp(client: ReturnType<typeof createRedisClient>) {
    const instance = await NestFactory.create<NestFastifyApplication>(
      {
        module: RegressionModule,
        controllers: [SearchController, WaitingRoomController],
        providers: [
          { provide: REDIS_CLIENT, useValue: client },
          { provide: JwtService, useValue: jwt },
          { provide: SearchService, useValue: new SearchService() },
          {
            provide: SearchRateLimitGuard,
            useValue: new SearchRateLimitGuard(client),
          },
          {
            provide: WaitingRoomService,
            useValue: new WaitingRoomService(client, jwt),
          },
          { provide: JwtAuthGuard, useValue: new JwtAuthGuard(jwt) },
          {
            provide: WaitingRoomRateLimitGuard,
            useValue: new WaitingRoomRateLimitGuard(client, new Reflector()),
          },
        ],
      },
      new FastifyAdapter(),
      { logger: false },
    );
    await instance.listen(0, "127.0.0.1");
    return instance;
  }

  before(async () => {
    assert.match(
      new URL(env.DATABASE_URL).pathname,
      /_test$/,
      "Chi chay tren database test",
    );
    if (redis.status !== "ready")
      await new Promise<void>((resolve) => redis.once("ready", resolve));
    const created = await db
      .insert(users)
      .values(
        ["organizer", "buyer", "other"].map((role) => ({
          email: `${role}-${randomUUID()}@example.com`,
          fullName: role,
          passwordHash: "test-only",
          role:
            role === "organizer" ? ("ORGANIZER" as const) : ("BUYER" as const),
          status: "ACTIVE" as const,
        })),
      )
      .returning();
    userIds.push(...created.map((u) => u.id));
    const [profile] = await db
      .insert(organizerProfiles)
      .values({
        userId: userIds[0]!,
        organizationName: "Regression",
        taxCode: randomUUID(),
        representativeName: "Regression",
        businessLicenseUrl: "https://example.com/license",
      })
      .returning();
    organizerId = profile!.id;
    token = await jwt.signAsync({ sub: userIds[1], role: "BUYER" });
    low = await createEvent("Giai dien", 1, false);
    await db
      .update(events)
      .set({ description: "nhacviet" })
      .where(eq(events.id, low));
    high = await createEvent("nhacviet", 3, false);
    tie = await createEvent("nhacviet", 4, false);
    app = await createApp(redis);
    baseUrl = await app.getUrl();
  });

  after(async () => {
    maintenance.onModuleDestroy();
    await app?.close();
    for (const id of eventIds) {
      const members = [
        ...(await redis.zrange(`waiting_room:${id}`, 0, -1)),
        ...userIds,
      ];
      await redis.del(
        `waiting_room:${id}`,
        `active_users:${id}`,
        ...members.map((u) => `w03:waiting-room:hb:${id}:${u}`),
      );
      await redis.srem("w03:waiting-room:events", id);
    }
    await db.delete(orders).where(inArray(orders.eventId, eventIds));
    await db.delete(seats).where(inArray(seats.eventId, eventIds));
    await db.delete(events).where(inArray(events.id, eventIds));
    if (organizerId)
      await db
        .delete(organizerProfiles)
        .where(eq(organizerProfiles.id, organizerId));
    await db.delete(users).where(inArray(users.id, userIds));
    redis.disconnect();
    await sqlClient.end();
  });

  it("TC16: keyword ngan/chi khoang trang bo qua full-text va giu bo loc", async () => {
    for (const keyword of ["x", " x ", "", "   ", "ế"]) {
      const result = await request(
        `/api/v1/search/events?category=${category}&keyword=${encodeURIComponent(keyword)}`,
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(
        result.body.data.items.map((e: { id: string }) => e.id),
        [low, high, tie],
      );
    }
    const filtered = await request(
      `/api/v1/search/events?category=${category}&keyword=x&city=Da%20Nang`,
    );
    assert.equal(filtered.body.data.items.length, 0);
  });

  it("TC15: uu tien ts_rank, tie-break ngay/ID va cursor khong mat/trung ket qua", async () => {
    const path = `/api/v1/search/events?category=${category}&keyword=nhacviet`;
    const result = await request(path);
    assert.deepEqual(
      result.body.data.items.map((e: { id: string }) => e.id),
      [high, tie, low],
    );
    const ids: string[] = [];
    let cursor = "";
    do {
      const page = await request(
        `${path}&limit=1${cursor ? `&cursor=${cursor}` : ""}`,
      );
      assert.equal(page.status, 200);
      ids.push(...page.body.data.items.map((e: { id: string }) => e.id));
      cursor = page.body.data.nextCursor;
    } while (cursor);
    assert.deepEqual(ids, [high, tie, low]);
  });

  it("TC19: join/heartbeat bao SOLD_OUT cho GA va ghe ngoi, don dang giu khong phai da ban", async () => {
    for (const seated of [false, true]) {
      const id = await createEvent("Sold out", 7);
      const type = await addTickets(id, seated, 2);
      if (seated)
        await db.insert(seats).values(
          ["1", "2"].map((seatNumber) => ({
            eventId: id,
            ticketTypeId: type,
            zoneName: "VIP",
            rowLabel: "A",
            seatNumber,
            status: SeatStatus.SOLD,
          })),
        );
      await redis.zadd(`waiting_room:${id}`, Date.now(), userIds[1]!);
      for (const action of ["join", "heartbeat"]) {
        const result = await request(
          `/api/v1/waiting-room/${id}/${action}`,
          "POST",
        );
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.data.status, "SOLD_OUT");
      }
      assert.equal(await redis.zcard(`waiting_room:${id}`), 0);
    }
    const held = await createEvent("Tam giu", 8);
    await addTickets(held, false, 0, 2);
    const result = await request(`/api/v1/waiting-room/${held}/join`, "POST");
    assert.equal(result.body.data.status, "ADMITTED");
  });

  it("TC20: tat hang cho don sach queue, active, heartbeat khi goi API", async () => {
    const id = await createEvent("Disabled", 8);
    await addTickets(id);
    await request(`/api/v1/waiting-room/${id}/join`, "POST");
    await redis.zadd(`waiting_room:${id}`, Date.now(), userIds[2]!);
    await redis.set(`w03:waiting-room:hb:${id}:${userIds[2]}`, "1", "EX", 60);
    await db
      .update(events)
      .set({ isWaitingRoomEnabled: false })
      .where(eq(events.id, id));
    const result = await request(
      `/api/v1/waiting-room/${id}/heartbeat`,
      "POST",
    );
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.status, "ADMITTED");
    assert.equal(
      await redis.exists(
        `waiting_room:${id}`,
        `active_users:${id}`,
        `w03:waiting-room:hb:${id}:${userIds[2]}`,
      ),
      0,
    );
  });

  it("TC20: job 5 giay don hang cho da tat ngay ca khi client khong goi lai", async () => {
    const id = await createEvent("Disabled background", 8);
    await addTickets(id);
    await request(`/api/v1/waiting-room/${id}/join`, "POST");
    await redis.zadd(`waiting_room:${id}`, Date.now(), userIds[2]!);
    await db
      .update(events)
      .set({ isWaitingRoomEnabled: false })
      .where(eq(events.id, id));
    maintenance.onModuleInit();
    try {
      const deadline = Date.now() + 7000;
      while (
        (await redis.exists(`waiting_room:${id}`)) &&
        Date.now() < deadline
      )
        await delay(100);
      assert.equal(
        await redis.exists(`waiting_room:${id}`, `active_users:${id}`),
        0,
      );
    } finally {
      maintenance.onModuleDestroy();
    }
  });

  it("TC21: tra orderId PENDING con han cua dung buyer va su kien, bo qua don het han", async () => {
    const id = await createEvent("Pending", 8);
    await addTickets(id, false, 2);
    const [order] = await db
      .insert(orders)
      .values({
        userId: userIds[1]!,
        eventId: id,
        orderCode: randomUUID().replaceAll("-", ""),
        totalAmount: "100000",
        finalAmount: "100000",
        status: OrderStatus.PENDING,
        expiresAt: new Date(Date.now() + 300000),
      })
      .returning();
    for (const action of ["join", "heartbeat"]) {
      const result = await request(
        `/api/v1/waiting-room/${id}/${action}`,
        "POST",
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.data.status, "ADMITTED");
      assert.equal(result.body.data.orderId, order!.id);
    }
    const otherToken = await jwt.signAsync({ sub: userIds[2], role: "BUYER" });
    const other = await request(
      `/api/v1/waiting-room/${id}/join`,
      "POST",
      otherToken,
    );
    assert.equal(other.body.data.orderId, undefined);
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, order!.id));
    const expired = await request(`/api/v1/waiting-room/${id}/join`, "POST");
    assert.equal(expired.body.data.orderId, undefined);
    assert.equal(expired.body.data.status, "SOLD_OUT");
  });

  it("TC17: Redis ngat ket noi tra HTTP 503 nhanh, sau do phuc hoi", async () => {
    const closed = new Promise<void>((resolve) => redis.once("end", resolve));
    redis.disconnect();
    await closed;
    try {
      for (const action of ["join", "heartbeat"]) {
        const start = Date.now();
        const result = await request(
          `/api/v1/waiting-room/${high}/${action}`,
          "POST",
        );
        assert.equal(result.status, 503, JSON.stringify(result.body));
        assert.ok(Date.now() - start < 2000);
        assert.equal(result.body.error.code, "WAITING_ROOM_UNAVAILABLE");
      }
    } finally {
      await redis.connect();
    }
    assert.equal(
      (await request(`/api/v1/waiting-room/${high}/join`, "POST")).status,
      200,
    );
  });

  it("TC17: Redis nhan TCP nhung khong phan hoi van ket thuc trong gioi han timeout", async () => {
    const sockets = new Set<Socket>();
    const target = new URL(env.REDIS_URL);
    const server = createServer((socket) => {
      const upstream = createConnection({
        host: target.hostname,
        port: Number(target.port || 6379),
      });
      sockets.add(socket);
      sockets.add(upstream);
      socket.pipe(upstream).pipe(socket);
      socket.on("error", () => {});
      upstream.on("error", () => {});
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const forwarded = new URL(env.REDIS_URL);
    forwarded.hostname = "127.0.0.1";
    forwarded.port = String(address.port);
    const unavailable = createRedisClient(forwarded.toString());
    unavailable.on("error", () => {});
    try {
      await new Promise<void>((resolve) => unavailable.once("ready", resolve));
      assert.equal(await unavailable.ping(), "PONG");
      // Ngat truyen du lieu tren ket noi da san sang, khong dung mock Redis.
      for (const socket of sockets) socket.unpipe();
      const unavailableApp = await createApp(unavailable);
      try {
        const start = Date.now();
        const response = await fetch(
          `${await unavailableApp.getUrl()}/api/v1/waiting-room/${high}/join`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(4000),
          },
        );
        assert.equal(response.status, 503);
        assert.equal(
          (await response.json()).error.code,
          "WAITING_ROOM_UNAVAILABLE",
        );
        assert.ok(Date.now() - start < 2500);
      } finally {
        await unavailableApp.close();
      }
    } finally {
      unavailable.disconnect();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
