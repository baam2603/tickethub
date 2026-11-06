import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { eq, inArray } from "drizzle-orm";
import { Reflector } from "@nestjs/core";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { db, sqlClient } from "../src/database/db";
import { env } from "../src/config/env.config";
import {
  users,
  organizerProfiles,
  events,
  ticketTypes,
  seats,
  orders,
  orderItems,
  tickets,
  eventStaff,
  auditLog,
  outbox,
} from "../src/database/schema";
import {
  UserRole,
  UserStatus,
  EventStatus,
  OrderStatus,
  SeatStatus,
  TicketStatus,
  RefundPolicyType,
  type AuthUser,
} from "@tickethub/shared";

import { AdminService } from "../src/admin/admin.service";
import { AdminController } from "../src/admin/admin.controller";
import { EventReadCacheService } from "../src/events/event-read-cache.service";
import { EventsService } from "../src/events/events.service";
import { BookingService } from "../src/booking/booking.service";
import { TicketsService } from "../src/tickets/tickets.service";
import { TicketsController } from "../src/tickets/tickets.controller";
import { GateController } from "../src/tickets/gate.controller";
import { Ed25519Service } from "../src/tickets/crypto/ed25519.service";
import { RolesGuard } from "../src/auth/guards/roles.guard";

describe("UC10: Emergency Kill Switch & Immutable Audit Log E2E Integration Suite", () => {
  let redis: Redis;
  let adminService: AdminService;
  let adminController: AdminController;
  let eventCacheService: EventReadCacheService;
  let eventsService: EventsService;
  let bookingService: BookingService;
  let ed25519Service: Ed25519Service;
  let ticketsService: TicketsService;
  let ticketsController: TicketsController;
  let gateController: GateController;
  let rolesGuard: RolesGuard;

  // Track entities for teardown
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdTicketTypeIds: string[] = [];
  const createdSeatIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdTicketIds: string[] = [];
  const createdStaffIds: string[] = [];
  const createdOutboxIds: string[] = [];

  let adminUser: AuthUser;
  let buyer1: AuthUser;
  let buyer2: AuthUser;
  let gateStaff: AuthUser;

  let event1Id = "";
  let event2Id = "";
  let draftEventId = "";
  let expiredEventId = "";

  let seatedTt1Id = "";
  let gaTt1Id = "";

  let seat1Id = "";
  let seat2Id = "";
  let seat3PaidId = "";

  let pendingOrder1Id = "";
  let pendingOrder2Id = "";
  let paidOrder3Id = "";

  let ticket1Id = "";
  let ticket1Code = "";
  let preGeneratedQrToken = "";

  const mockReq = {
    headers: {
      "x-forwarded-for": "127.0.0.1",
      "user-agent": "Mozilla/5.0 IntegrationTest/1.0",
    },
    ip: "127.0.0.1",
  } as unknown as FastifyRequest;

  function createMockContext(
    user: AuthUser | null,
    handler: (...args: unknown[]) => unknown,
  ): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => AdminController,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  before(async () => {
    redis = new Redis(env.REDIS_URL);
    eventsService = new EventsService();
    eventCacheService = new EventReadCacheService(redis, eventsService);
    adminService = new AdminService(eventCacheService);
    adminController = new AdminController(adminService);

    bookingService = new BookingService(eventCacheService);

    ed25519Service = new Ed25519Service();
    ticketsService = new TicketsService(ed25519Service);
    ticketsController = new TicketsController(ticketsService);
    gateController = new GateController(ticketsService);

    rolesGuard = new RolesGuard(new Reflector());

    const stamp = Date.now();

    // 1. Setup Admin User
    const [adm] = await db
      .insert(users)
      .values({
        email: `admin_uc10_${stamp}@tickethub.vn`,
        fullName: "Quan Tri Vien UC10",
        passwordHash: "$argon2id$dummy",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      })
      .returning();
    adminUser = {
      userId: adm!.id,
      email: adm!.email,
      role: UserRole.ADMIN,
    };
    createdUserIds.push(adm!.id);

    // 2. Setup Organizer User & Profile
    const [org] = await db
      .insert(users)
      .values({
        email: `org_uc10_${stamp}@tickethub.vn`,
        fullName: "BTC UC10 Test",
        passwordHash: "$argon2id$dummy",
        role: UserRole.ORGANIZER,
        status: UserStatus.ACTIVE,
      })
      .returning();
    createdUserIds.push(org!.id);

    const [profile] = await db
      .insert(organizerProfiles)
      .values({
        userId: org!.id,
        organizationName: "Cong Ty San Xuat Am Nhac UC10",
        taxCode: "0109999777",
        businessLicenseUrl: "https://cdn.tickethub.vn/license.pdf",
        representativeName: "Giam Doc UC10",
      })
      .returning();

    // 3. Setup Buyer Users
    const [b1] = await db
      .insert(users)
      .values({
        email: `buyer1_uc10_${stamp}@tickethub.vn`,
        fullName: "Nguyen Van Mua Mot",
        passwordHash: "$argon2id$dummy",
        role: UserRole.BUYER,
        status: UserStatus.ACTIVE,
        phone: "0901234567",
      })
      .returning();
    buyer1 = {
      userId: b1!.id,
      email: b1!.email,
      role: UserRole.BUYER,
    };
    createdUserIds.push(b1!.id);

    const [b2] = await db
      .insert(users)
      .values({
        email: `buyer2_uc10_${stamp}@tickethub.vn`,
        fullName: "Tran Thi Mua Hai",
        passwordHash: "$argon2id$dummy",
        role: UserRole.BUYER,
        status: UserStatus.ACTIVE,
        phone: "0909876543",
      })
      .returning();
    buyer2 = {
      userId: b2!.id,
      email: b2!.email,
      role: UserRole.BUYER,
    };
    createdUserIds.push(b2!.id);

    // 4. Setup Gate Staff User
    const [staff] = await db
      .insert(users)
      .values({
        email: `staff_uc10_${stamp}@tickethub.vn`,
        fullName: "Nhan Vien Soat Ve UC10",
        passwordHash: "$argon2id$dummy",
        role: UserRole.GATE_STAFF,
        status: UserStatus.ACTIVE,
      })
      .returning();
    gateStaff = {
      userId: staff!.id,
      email: staff!.email,
      role: UserRole.GATE_STAFF,
    };
    createdUserIds.push(staff!.id);

    // 5. Setup Published Event 1 (target for Kill Switch)
    const now = new Date();
    const startTime = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const endTime = new Date(startTime.getTime() + 4 * 3600 * 1000);

    const [evt1] = await db
      .insert(events)
      .values({
        organizerId: profile!.id,
        title: "Live Concert UC10 Kill Switch Target",
        slug: `ks-target-${stamp}-${randomUUID().slice(0, 8)}`,
        description: "Su kien thu nghiem admin kill switch cascade",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner.webp",
        venueName: "San Van Dong My Dinh",
        venueAddress: "Le Duc Tho, Nam Tu Liem",
        city: "Ha Noi",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED,
        version: 1,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    event1Id = evt1!.id;
    createdEventIds.push(event1Id);

    // 6. Setup Staff assignment for Event 1
    const [staffAssigned] = await db
      .insert(eventStaff)
      .values({
        eventId: event1Id,
        userId: gateStaff.userId,
        staffRole: "SCANNER",
      })
      .returning();
    createdStaffIds.push(staffAssigned!.id);

    // 7. Setup TicketTypes for Event 1
    const [ttSeated] = await db
      .insert(ticketTypes)
      .values({
        eventId: event1Id,
        name: "VIP Seated Zone",
        price: "1500000.00",
        capacity: 50,
        heldCount: 0,
        soldCount: 1,
        isSeated: true,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    seatedTt1Id = ttSeated!.id;
    createdTicketTypeIds.push(seatedTt1Id);

    const [ttGa] = await db
      .insert(ticketTypes)
      .values({
        eventId: event1Id,
        name: "GA Standing Fanzone",
        price: "500000.00",
        capacity: 100,
        heldCount: 5, // 5 unassigned standing holds
        soldCount: 0,
        isSeated: false,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    gaTt1Id = ttGa!.id;
    createdTicketTypeIds.push(gaTt1Id);

    // 8. Setup Seats for Event 1
    const [s1, s2, s3] = await db
      .insert(seats)
      .values([
        {
          eventId: event1Id,
          ticketTypeId: seatedTt1Id,
          zoneName: "Khu VIP",
          rowLabel: "A",
          seatNumber: "01",
          status: SeatStatus.HELD,
          holdExpiresAt: new Date(Date.now() + 300000),
        },
        {
          eventId: event1Id,
          ticketTypeId: seatedTt1Id,
          zoneName: "Khu VIP",
          rowLabel: "A",
          seatNumber: "02",
          status: SeatStatus.HELD,
          holdExpiresAt: new Date(Date.now() + 300000),
        },
        {
          eventId: event1Id,
          ticketTypeId: seatedTt1Id,
          zoneName: "Khu VIP",
          rowLabel: "A",
          seatNumber: "03",
          status: SeatStatus.SOLD,
        },
      ])
      .returning();
    seat1Id = s1!.id;
    seat2Id = s2!.id;
    seat3PaidId = s3!.id;
    createdSeatIds.push(seat1Id, seat2Id, seat3PaidId);

    // 9. Setup Orders for Event 1
    const [ord1, ord2, ord3] = await db
      .insert(orders)
      .values([
        {
          orderCode: `ORD-KS-P1-${stamp}`,
          userId: buyer1.userId,
          eventId: event1Id,
          status: OrderStatus.PENDING,
          totalAmount: "1500000.00",
          discountAmount: "0.00",
          finalAmount: "1500000.00",
          expiresAt: new Date(Date.now() + 300000),
        },
        {
          orderCode: `ORD-KS-P2-${stamp}`,
          userId: buyer2.userId,
          eventId: event1Id,
          status: OrderStatus.PENDING,
          totalAmount: "1500000.00",
          discountAmount: "0.00",
          finalAmount: "1500000.00",
          expiresAt: new Date(Date.now() + 300000),
        },
        {
          orderCode: `ORD-KS-PAID3-${stamp}`,
          userId: buyer1.userId,
          eventId: event1Id,
          status: OrderStatus.PAID,
          totalAmount: "1500000.00",
          discountAmount: "0.00",
          finalAmount: "1500000.00",
          expiresAt: new Date(Date.now() + 86400000),
        },
      ])
      .returning();
    pendingOrder1Id = ord1!.id;
    pendingOrder2Id = ord2!.id;
    paidOrder3Id = ord3!.id;
    createdOrderIds.push(pendingOrder1Id, pendingOrder2Id, paidOrder3Id);

    // Link held seats to pending orders
    await db
      .update(seats)
      .set({ holdOrderId: pendingOrder1Id })
      .where(eq(seats.id, seat1Id));
    await db
      .update(seats)
      .set({ holdOrderId: pendingOrder2Id })
      .where(eq(seats.id, seat2Id));

    // 10. Setup Sold Ticket for Buyer 1 linked to Paid Order 3
    ticket1Code = `TCK${randomUUID().replace(/-/g, "").slice(0, 29)}`;
    const [tck] = await db
      .insert(tickets)
      .values({
        ticketCode: ticket1Code,
        orderId: paidOrder3Id,
        ticketTypeId: seatedTt1Id,
        seatId: seat3PaidId,
        eventId: event1Id,
        userId: buyer1.userId,
        status: TicketStatus.SOLD,
      })
      .returning();
    ticket1Id = tck!.id;
    createdTicketIds.push(ticket1Id);

    // 11. Generate valid Dynamic QR token BEFORE Kill Switch is triggered
    const preQrRes = await ticketsController.getQrToken(buyer1, ticket1Id);
    preGeneratedQrToken = preQrRes.qrToken;
    assert.ok(preGeneratedQrToken, "Dynamic QR token must be generated");

    // 12. Setup Secondary Events for edge cases
    // Event 2: Published for concurrency test
    const [evt2] = await db
      .insert(events)
      .values({
        organizerId: profile!.id,
        title: "Event 2 Concurrency Test",
        slug: `ks-evt2-${stamp}-${randomUUID().slice(0, 8)}`,
        description: "Mo ta su kien 2",
        bannerUrl: "https://cdn.tickethub.vn/banner2.webp",
        venueName: "San Van Dong My Dinh",
        venueAddress: "Le Duc Tho, Nam Tu Liem",
        city: "Ha Noi",
        category: "Am nhac",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED,
        version: 1,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    event2Id = evt2!.id;
    createdEventIds.push(event2Id);

    // Draft Event
    const [evtDraft] = await db
      .insert(events)
      .values({
        organizerId: profile!.id,
        title: "Draft Event Test",
        slug: `ks-draft-${stamp}-${randomUUID().slice(0, 8)}`,
        description: "Mo ta ban nhap",
        bannerUrl: "https://cdn.tickethub.vn/banner-draft.webp",
        venueName: "San Van Dong My Dinh",
        venueAddress: "Le Duc Tho, Nam Tu Liem",
        city: "Ha Noi",
        category: "Am nhac",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.DRAFT,
        version: 1,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    draftEventId = evtDraft!.id;
    createdEventIds.push(draftEventId);

    // Expired Suspended Event
    const pastEndTime = new Date(Date.now() - 3600000);
    const pastStartTime = new Date(Date.now() - 7200000);
    const [evtExpired] = await db
      .insert(events)
      .values({
        organizerId: profile!.id,
        title: "Expired Suspended Event Test",
        slug: `ks-expired-${stamp}-${randomUUID().slice(0, 8)}`,
        description: "Mo ta su kien het han",
        bannerUrl: "https://cdn.tickethub.vn/banner-exp.webp",
        venueName: "San Van Dong My Dinh",
        venueAddress: "Le Duc Tho, Nam Tu Liem",
        city: "Ha Noi",
        category: "Am nhac",
        startTime: pastStartTime,
        endTime: pastEndTime,
        gateOpeningTime: pastStartTime,
        status: EventStatus.SUSPENDED,
        version: 2,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    expiredEventId = evtExpired!.id;
    createdEventIds.push(expiredEventId);
  });

  after(async () => {
    try {
      // Teardown in reverse dependency order
      if (createdTicketIds.length > 0) {
        await db.delete(tickets).where(inArray(tickets.id, createdTicketIds));
      }
      if (createdStaffIds.length > 0) {
        await db
          .delete(eventStaff)
          .where(inArray(eventStaff.id, createdStaffIds));
      }
      if (createdSeatIds.length > 0) {
        await db.delete(seats).where(inArray(seats.id, createdSeatIds));
      }
      if (createdOrderIds.length > 0) {
        await db
          .delete(orderItems)
          .where(inArray(orderItems.orderId, createdOrderIds));
        await db.delete(orders).where(inArray(orders.id, createdOrderIds));
      }
      if (createdTicketTypeIds.length > 0) {
        await db
          .delete(ticketTypes)
          .where(inArray(ticketTypes.id, createdTicketTypeIds));
      }
      if (createdOutboxIds.length > 0) {
        await db.delete(outbox).where(inArray(outbox.id, createdOutboxIds));
      }
      if (createdEventIds.length > 0) {
        await db
          .delete(auditLog)
          .where(inArray(auditLog.targetId, createdEventIds));
        await db.delete(events).where(inArray(events.id, createdEventIds));
      }
      if (createdUserIds.length > 0) {
        await db
          .delete(auditLog)
          .where(inArray(auditLog.actorId, createdUserIds));
        await db
          .delete(organizerProfiles)
          .where(inArray(organizerProfiles.userId, createdUserIds));
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
    } catch (err) {
      console.error("AFTER TEARDOWN ERROR:", err);
    } finally {
      redis.disconnect();
      await sqlClient.end();
    }
  });

  it("Scenario 1: Standard Kill Switch cascade cancels orders, releases seats/holds, invalidates Redis and records immutable audit log", async () => {
    // 1. Seed Redis cache keys for Event 1
    const seatmapCacheKey = `w03:seatmap:v1:${event1Id}`;
    const inventoryCacheKey = `w03:inventory:v1:${event1Id}`;
    await redis.set(seatmapCacheKey, JSON.stringify({ cached: true }));
    await redis.set(inventoryCacheKey, JSON.stringify({ cached: true }));

    // Verify cache keys exist
    assert.ok(await redis.get(seatmapCacheKey));
    assert.ok(await redis.get(inventoryCacheKey));

    // 2. Admin triggers Kill Switch
    const killSwitchRes = await adminController.activateKillSwitch(
      adminUser,
      event1Id,
      {
        reason: "Phat hien hanh vi gian lan ban ve cho den",
        version: 1,
      },
      mockReq,
    );

    // 3. Verify response envelope and payload
    assert.equal(killSwitchRes.success, true);
    assert.equal(killSwitchRes.data.eventId, event1Id);
    assert.equal(killSwitchRes.data.status, EventStatus.SUSPENDED);
    assert.equal(killSwitchRes.data.version, 2);
    assert.equal(
      killSwitchRes.data.rejectionReason,
      "Phat hien hanh vi gian lan ban ve cho den",
    );
    assert.equal(killSwitchRes.data.cancelledPendingOrdersCount, 2);
    assert.equal(killSwitchRes.data.releasedHeldSeatsCount, 2);
    assert.equal(killSwitchRes.data.releasedHeldStandingCount, 5);
    assert.equal(killSwitchRes.data.totalReleasedHoldsCount, 7);
    assert.ok(killSwitchRes.data.suspendedAt);

    // 4. Verify Event status in PostgreSQL
    const [dbEvt] = await db
      .select()
      .from(events)
      .where(eq(events.id, event1Id));
    assert.equal(dbEvt!.status, EventStatus.SUSPENDED);
    assert.equal(dbEvt!.version, 2);
    assert.equal(
      dbEvt!.rejectionReason,
      "Phat hien hanh vi gian lan ban ve cho den",
    );

    // 5. Verify Pending Orders changed to CANCELLED, Paid Order remains PAID
    const [dbOrd1] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, pendingOrder1Id));
    const [dbOrd2] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, pendingOrder2Id));
    const [dbOrd3] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, paidOrder3Id));
    assert.equal(dbOrd1!.status, OrderStatus.CANCELLED);
    assert.equal(dbOrd2!.status, OrderStatus.CANCELLED);
    assert.equal(dbOrd3!.status, OrderStatus.PAID);

    // 6. Verify Seats 1 & 2 reverted to AVAILABLE with hold cleared
    const [dbSeat1] = await db
      .select()
      .from(seats)
      .where(eq(seats.id, seat1Id));
    const [dbSeat2] = await db
      .select()
      .from(seats)
      .where(eq(seats.id, seat2Id));
    assert.equal(dbSeat1!.status, SeatStatus.AVAILABLE);
    assert.equal(dbSeat1!.holdOrderId, null);
    assert.equal(dbSeat1!.holdExpiresAt, null);
    assert.equal(dbSeat2!.status, SeatStatus.AVAILABLE);
    assert.equal(dbSeat2!.holdOrderId, null);
    assert.equal(dbSeat2!.holdExpiresAt, null);

    // 7. Verify GA TicketType heldCount reset to 0
    const [dbGa] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.id, gaTt1Id));
    assert.equal(dbGa!.heldCount, 0);

    // 8. Verify Redis cache eviction
    assert.equal(
      await redis.get(seatmapCacheKey),
      null,
      "Redis seatmap cache must be evicted",
    );
    assert.equal(
      await redis.get(inventoryCacheKey),
      null,
      "Redis inventory cache must be evicted",
    );

    // 9. Verify Immutable Audit Log entry
    const [dbAudit] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, event1Id));
    assert.ok(dbAudit, "Audit log entry must exist");
    assert.equal(dbAudit!.actorId, adminUser.userId);
    assert.equal(dbAudit!.actorRole, UserRole.ADMIN);
    assert.equal(dbAudit!.action, "EVENT_KILL_SWITCH_ACTIVATED");
    assert.equal(dbAudit!.targetType, "EVENT");
    assert.equal(dbAudit!.targetId, event1Id);
    assert.equal(dbAudit!.ipAddress, "127.0.0.1");
    assert.equal(dbAudit!.userAgent, "Mozilla/5.0 IntegrationTest/1.0");

    const changes = dbAudit!.changes as Record<string, unknown>;
    assert.equal(changes.oldStatus, "PUBLISHED");
    assert.equal(changes.newStatus, "SUSPENDED");
    assert.equal(changes.reason, "Phat hien hanh vi gian lan ban ve cho den");
    assert.equal(changes.cancelledPendingOrdersCount, 2);
    assert.equal(changes.releasedHeldSeatsCount, 2);
    assert.equal(changes.releasedHeldStandingCount, 5);
    assert.equal(changes.totalReleasedHoldsCount, 7);

    // 10. Verify Outbox event created
    const allOutboxSuspended = await db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, "EVENT_SUSPENDED"));
    const dbOutbox = allOutboxSuspended.find(
      (o) => (o.payload as Record<string, unknown>).eventId === event1Id,
    );
    assert.ok(dbOutbox, "Outbox event must exist");
    createdOutboxIds.push(dbOutbox!.id);
    assert.equal(dbOutbox!.eventType, "EVENT_SUSPENDED");
    const outboxPayload = dbOutbox!.payload as Record<string, unknown>;
    assert.equal(outboxPayload.eventId, event1Id);
    assert.equal(
      outboxPayload.reason,
      "Phat hien hanh vi gian lan ban ve cho den",
    );
  });

  it("Scenario 2: Immediate cross-system rejection on SUSPENDED event (Booking, QR Token, Gate Scan, Manual Lookup)", async () => {
    // 1. Booking attempt on suspended event -> 400 EVENT_NOT_PUBLISHED
    await assert.rejects(
      async () =>
        bookingService.holdSeats(buyer1.userId, {
          eventId: event1Id,
          items: [
            {
              ticketTypeId: seatedTt1Id,
              quantity: 1,
            },
          ],
        }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        const res = (err as BadRequestException).getResponse() as Record<
          string,
          unknown
        >;
        const errObj = res?.error as Record<string, unknown> | undefined;
        assert.equal(errObj?.code, "EVENT_NOT_PUBLISHED");
        return true;
      },
    );

    // 2. Buyer attempts to fetch new QR token for Ticket 1 -> 400 EVENT_NOT_ACTIVE
    await assert.rejects(
      async () => ticketsController.getQrToken(buyer1, ticket1Id),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /EVENT_NOT_ACTIVE/);
        return true;
      },
    );

    // 3. Gate staff attempts to scan pre-generated QR token -> 400 EVENT_NOT_ACTIVE
    await assert.rejects(
      async () =>
        gateController.scanTicket(gateStaff, {
          qrToken: preGeneratedQrToken,
        }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /EVENT_NOT_ACTIVE/);
        return true;
      },
    );

    // 4. Gate staff attempts manual lookup for Ticket 1 -> 400 EVENT_NOT_ACTIVE
    await assert.rejects(
      async () =>
        gateController.lookupTicket(gateStaff, {
          eventId: event1Id,
          ticketCode: ticket1Code,
          phoneOrEmailLast4: "4567", // buyer1 phone last 4 digits
          reason: "Khach hang khong vao duoc",
        }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /EVENT_NOT_ACTIVE/);
        return true;
      },
    );
  });

  it("Scenario 3: Concurrency and status guard enforcement (Stale version, Already suspended, Non-published)", async () => {
    // 1. Stale version check on Event 2 -> 409 CONCURRENT_MODIFICATION
    await assert.rejects(
      async () =>
        adminController.activateKillSwitch(
          adminUser,
          event2Id,
          {
            reason: "Kiem tra xung dot phien ban",
            version: 999, // actual is 1
          },
          mockReq,
        ),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        assert.match((err as Error).message, /CONCURRENT_MODIFICATION/);
        return true;
      },
    );

    // 2. Already SUSPENDED check on Event 1 -> 409 EVENT_ALREADY_SUSPENDED
    await assert.rejects(
      async () =>
        adminController.activateKillSwitch(
          adminUser,
          event1Id,
          {
            reason: "Kich hoat lai tren su kien da ngat",
            version: 2,
          },
          mockReq,
        ),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        assert.match((err as Error).message, /EVENT_ALREADY_SUSPENDED/);
        return true;
      },
    );

    // 3. Non-PUBLISHED (DRAFT) check -> 400 EVENT_NOT_PUBLISHED
    await assert.rejects(
      async () =>
        adminController.activateKillSwitch(
          adminUser,
          draftEventId,
          {
            reason: "Kich hoat tren ban nhap",
          },
          mockReq,
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /EVENT_NOT_PUBLISHED/);
        return true;
      },
    );
  });

  it("Scenario 4: Event resumption flow restores status to PUBLISHED and blocks expired events", async () => {
    // 1. Admin resumes suspended Event 1 (current version: 2)
    const resumeRes = await adminController.resumeEvent(
      adminUser,
      event1Id,
      {
        reason: "Ban to chuc da giai trinh va bo sung day du giay phep",
        version: 2,
      },
      mockReq,
    );

    assert.equal(resumeRes.success, true);
    assert.equal(resumeRes.data.eventId, event1Id);
    assert.equal(resumeRes.data.status, EventStatus.PUBLISHED);
    assert.equal(resumeRes.data.version, 3);
    assert.ok(resumeRes.data.resumedAt);

    // Verify DB update
    const [dbEvt] = await db
      .select()
      .from(events)
      .where(eq(events.id, event1Id));
    assert.equal(dbEvt!.status, EventStatus.PUBLISHED);
    assert.equal(dbEvt!.rejectionReason, null);
    assert.equal(dbEvt!.version, 3);

    // Verify outbox for resumption
    const allOutboxResumed = await db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, "EVENT_RESUMED"));
    const resumeOutbox = allOutboxResumed.find(
      (o) => (o.payload as Record<string, unknown>).eventId === event1Id,
    );
    assert.ok(resumeOutbox, "Outbox EVENT_RESUMED event must exist");
    createdOutboxIds.push(resumeOutbox!.id);

    // 2. Resume on already ended event -> 400 EVENT_ALREADY_ENDED
    await assert.rejects(
      async () =>
        adminController.resumeEvent(
          adminUser,
          expiredEventId,
          {
            reason: "Thu khoi phuc su kien qua han",
          },
          mockReq,
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /EVENT_ALREADY_ENDED/);
        return true;
      },
    );
  });

  it("Scenario 5: Immutable Audit Log query (descending order, pagination, and action filtering)", async () => {
    // 1. Query all audit logs for Event 1 (should contain Kill Switch and Resumption)
    const auditRes = await adminController.getEventAuditLogs(event1Id, {
      page: 1,
      limit: 10,
    });

    assert.equal(auditRes.success, true);
    assert.ok(auditRes.data.items.length >= 2);
    assert.equal(auditRes.data.meta.total >= 2, true);
    assert.equal(auditRes.data.meta.page, 1);
    assert.equal(auditRes.data.meta.limit, 10);

    // Verify chronological descending order (newer first)
    const firstDate = new Date(auditRes.data.items[0]!.createdAt).getTime();
    const secondDate = new Date(auditRes.data.items[1]!.createdAt).getTime();
    assert.ok(
      firstDate >= secondDate,
      "Audit logs must be ordered in descending order",
    );
    assert.equal(auditRes.data.items[0]!.action, "EVENT_RESUMED");
    assert.equal(auditRes.data.items[1]!.action, "EVENT_KILL_SWITCH_ACTIVATED");

    // 2. Filter audit logs by specific action
    const filteredRes = await adminController.getEventAuditLogs(event1Id, {
      page: 1,
      limit: 10,
      action: "EVENT_KILL_SWITCH_ACTIVATED",
    });

    assert.equal(filteredRes.success, true);
    assert.equal(filteredRes.data.items.length, 1);
    assert.equal(
      filteredRes.data.items[0]!.action,
      "EVENT_KILL_SWITCH_ACTIVATED",
    );
    assert.equal(filteredRes.data.items[0]!.targetId, event1Id);
    assert.equal(filteredRes.data.items[0]!.targetType, "EVENT");
  });

  it("Scenario 6: Strict RBAC enforcement rejects non-ADMIN roles with 403 ForbiddenException", () => {
    const nonAdminRoles = [
      UserRole.BUYER,
      UserRole.ORGANIZER,
      UserRole.GATE_STAFF,
    ];

    for (const role of nonAdminRoles) {
      const testUser: AuthUser = {
        userId: randomUUID(),
        email: `test_${role.toLowerCase()}@tickethub.vn`,
        role,
      };

      // 1. Test activateKillSwitch
      assert.throws(
        () =>
          rolesGuard.canActivate(
            createMockContext(
              testUser,
              AdminController.prototype.activateKillSwitch,
            ),
          ),
        (err: unknown) => {
          assert.ok(err instanceof ForbiddenException);
          return true;
        },
      );

      // 2. Test resumeEvent
      assert.throws(
        () =>
          rolesGuard.canActivate(
            createMockContext(testUser, AdminController.prototype.resumeEvent),
          ),
        (err: unknown) => {
          assert.ok(err instanceof ForbiddenException);
          return true;
        },
      );

      // 3. Test getEventAuditLogs
      assert.throws(
        () =>
          rolesGuard.canActivate(
            createMockContext(
              testUser,
              AdminController.prototype.getEventAuditLogs,
            ),
          ),
        (err: unknown) => {
          assert.ok(err instanceof ForbiddenException);
          return true;
        },
      );
    }

    // Verify ADMIN role is allowed
    assert.equal(
      rolesGuard.canActivate(
        createMockContext(
          adminUser,
          AdminController.prototype.activateKillSwitch,
        ),
      ),
      true,
    );
    assert.equal(
      rolesGuard.canActivate(
        createMockContext(adminUser, AdminController.prototype.resumeEvent),
      ),
      true,
    );
    assert.equal(
      rolesGuard.canActivate(
        createMockContext(
          adminUser,
          AdminController.prototype.getEventAuditLogs,
        ),
      ),
      true,
    );
  });
});
