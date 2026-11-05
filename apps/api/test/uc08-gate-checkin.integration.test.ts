import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, sqlClient } from "../src/database/db";
import { TicketsService } from "../src/tickets/tickets.service";
import { Ed25519Service } from "../src/tickets/crypto/ed25519.service";
import { TicketsController } from "../src/tickets/tickets.controller";
import { GateController } from "../src/tickets/gate.controller";
import {
  users,
  events,
  ticketTypes,
  seats,
  orders,
  tickets,
  gates,
  eventStaff,
  auditLog,
  organizerProfiles,
} from "../src/database/schema";
import {
  UserRole,
  UserStatus,
  EventStatus,
  TicketStatus,
  OrderStatus,
  SeatStatus,
  RefundPolicyType,
  type AuthUser,
} from "@tickethub/shared";
import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";

describe("UC08: Dynamic Rolling QR & Gate Check-in E2E Integration Suite", () => {
  let ed25519Service: Ed25519Service;
  let ticketsService: TicketsService;
  let ticketsController: TicketsController;
  let gateController: GateController;

  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdTicketTypeIds: string[] = [];
  const createdSeatIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdTicketIds: string[] = [];
  const createdGateIds: string[] = [];

  let buyer1: AuthUser;
  let buyer2: AuthUser;
  let staffEventA: AuthUser;
  let staffEventB: AuthUser;
  let adminUser: AuthUser;

  let eventAId: string;
  let eventBId: string;
  let eventAKillSwitchId: string;

  let gateAId: string;
  let gateBId: string;

  let ticketScenario1Id: string;
  let ticketScenario2Id: string;
  let ticketScenario3Id: string;
  let ticketScenario4Id: string;
  let ticketScenario5Id: string;
  let ticketScenario5Code: string;
  let ticketScenario6Id: string;
  let ticketScenario6Code: string;

  before(async () => {
    ed25519Service = new Ed25519Service();
    ticketsService = new TicketsService(ed25519Service);
    ticketsController = new TicketsController(ticketsService);
    gateController = new GateController(ticketsService);

    const stamp = Date.now();

    // 1. Organizer setup
    let orgProfile = await db.query.organizerProfiles.findFirst();
    if (!orgProfile) {
      const [u] = await db
        .insert(users)
        .values({
          email: `org_uc08_${stamp}@tickethub.vn`,
          fullName: "BTC UC08 Integration",
          passwordHash: "$argon2id$dummy",
          role: UserRole.ORGANIZER,
          status: UserStatus.ACTIVE,
        })
        .returning();
      createdUserIds.push(u!.id);

      const [p] = await db
        .insert(organizerProfiles)
        .values({
          userId: u!.id,
          organizationName: "Cong Ty To Chuc Su Kien UC08",
          taxCode: "0108888888",
          businessLicenseUrl: "https://cdn.tickethub.vn/license.pdf",
          representativeName: "Dai Dien Ban To Chuc UC08",
        })
        .returning();
      orgProfile = p;
    }

    // 2. Users: Buyers, Gate Staffs, and Admin
    const [b1] = await db
      .insert(users)
      .values({
        email: `buyer1_uc08_${stamp}@tickethub.vn`,
        phone: "0901112222",
        fullName: "Nguyen Van Mua Mot",
        passwordHash: "$argon2id$dummy",
        role: UserRole.BUYER,
        status: UserStatus.ACTIVE,
      })
      .returning();
    buyer1 = {
      userId: b1!.id,
      email: b1!.email,
      role: UserRole.BUYER,
      fullName: b1!.fullName,
    };
    createdUserIds.push(b1!.id);

    const [b2] = await db
      .insert(users)
      .values({
        email: `buyer2_uc08_${stamp}@tickethub.vn`,
        phone: "0903334444",
        fullName: "Tran Thi Mua Hai",
        passwordHash: "$argon2id$dummy",
        role: UserRole.BUYER,
        status: UserStatus.ACTIVE,
      })
      .returning();
    buyer2 = {
      userId: b2!.id,
      email: b2!.email,
      role: UserRole.BUYER,
      fullName: b2!.fullName,
    };
    createdUserIds.push(b2!.id);

    const [sA] = await db
      .insert(users)
      .values({
        email: `staff_a_uc08_${stamp}@tickethub.vn`,
        phone: "0912223333",
        fullName: "Nhan Vien Cua Su Kien A",
        passwordHash: "$argon2id$dummy",
        role: UserRole.GATE_STAFF,
        status: UserStatus.ACTIVE,
      })
      .returning();
    staffEventA = {
      userId: sA!.id,
      email: sA!.email,
      role: UserRole.GATE_STAFF,
      fullName: sA!.fullName,
    };
    createdUserIds.push(sA!.id);

    const [sB] = await db
      .insert(users)
      .values({
        email: `staff_b_uc08_${stamp}@tickethub.vn`,
        phone: "0914445555",
        fullName: "Nhan Vien Cua Su Kien B",
        passwordHash: "$argon2id$dummy",
        role: UserRole.GATE_STAFF,
        status: UserStatus.ACTIVE,
      })
      .returning();
    staffEventB = {
      userId: sB!.id,
      email: sB!.email,
      role: UserRole.GATE_STAFF,
      fullName: sB!.fullName,
    };
    createdUserIds.push(sB!.id);

    const [adm] = await db
      .insert(users)
      .values({
        email: `admin_uc08_${stamp}@tickethub.vn`,
        phone: "0999999999",
        fullName: "Quan Tri Vien UC08",
        passwordHash: "$argon2id$dummy",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      })
      .returning();
    adminUser = {
      userId: adm!.id,
      email: adm!.email,
      role: UserRole.ADMIN,
      fullName: adm!.fullName,
    };
    createdUserIds.push(adm!.id);

    // 3. Events: Event A (PUBLISHED), Event B (PUBLISHED), Event A Kill Switch (PUBLISHED then SUSPENDED)
    const now = new Date();
    const startTime = new Date(now.getTime() + 5 * 24 * 3600 * 1000);
    const endTime = new Date(startTime.getTime() + 4 * 3600 * 1000);

    const [evtA] = await db
      .insert(events)
      .values({
        organizerId: orgProfile!.id,
        title: "Dai Nhac Hoi UC08 Su Kien A",
        slug: `uc08-event-a-${randomUUID().slice(0, 8)}`,
        description: "Su kien A thu nghiem checkin",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner-a.webp",
        venueName: "San Van Dong My Dinh",
        venueAddress: "Le Duc Tho, Nam Tu Liem",
        city: "Ha Noi",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED,
        isWaitingRoomEnabled: false,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    eventAId = evtA!.id;
    createdEventIds.push(eventAId);

    const [evtB] = await db
      .insert(events)
      .values({
        organizerId: orgProfile!.id,
        title: "Live Concert UC08 Su Kien B",
        slug: `uc08-event-b-${randomUUID().slice(0, 8)}`,
        description: "Su kien B thu nghiem IDOR nhan vien",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner-b.webp",
        venueName: "Nha Thi Dau Quan Khu 7",
        venueAddress: "202 Hoang Van Thu, Phu Nhuan",
        city: "TP. Ho Chi Minh",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED,
        isWaitingRoomEnabled: false,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    eventBId = evtB!.id;
    createdEventIds.push(eventBId);

    const [evtKill] = await db
      .insert(events)
      .values({
        organizerId: orgProfile!.id,
        title: "Su Kien UC08 Bi Huy Bo Khan Cap",
        slug: `uc08-event-kill-${randomUUID().slice(0, 8)}`,
        description: "Su kien kiem tra kill switch",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner-kill.webp",
        venueName: "Trung Tam Hoi Nghi Quoc Gia",
        venueAddress: "Pham Hung, Me Tri",
        city: "Ha Noi",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED, // se chuyen sang SUSPENDED trong test
        isWaitingRoomEnabled: false,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    eventAKillSwitchId = evtKill!.id;
    createdEventIds.push(eventAKillSwitchId);

    // 4. Gates
    const [gtA] = await db
      .insert(gates)
      .values({
        eventId: eventAId,
        gateCode: `GATE-A1-${randomUUID().slice(0, 4)}`,
        name: "Cong A1 San My Dinh",
      })
      .returning();
    gateAId = gtA!.id;
    createdGateIds.push(gateAId);

    const [gtB] = await db
      .insert(gates)
      .values({
        eventId: eventBId,
        gateCode: `GATE-B1-${randomUUID().slice(0, 4)}`,
        name: "Cong B1 Quan Khu 7",
      })
      .returning();
    gateBId = gtB!.id;
    createdGateIds.push(gateBId);

    // 5. Assign Staff to Events
    await db.insert(eventStaff).values([
      {
        eventId: eventAId,
        userId: staffEventA.userId,
        gateId: gateAId,
        staffRole: "SCANNER",
      },
      {
        eventId: eventBId,
        userId: staffEventB.userId,
        gateId: gateBId,
        staffRole: "SCANNER",
      },
    ]);

    // 6. Ticket Types & Seats for Event A
    const [ttA] = await db
      .insert(ticketTypes)
      .values({
        eventId: eventAId,
        name: "VIP Diamond Khu A",
        price: "2500000.00",
        capacity: 100,
        isSeated: true,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    createdTicketTypeIds.push(ttA!.id);

    const [seat1] = await db
      .insert(seats)
      .values({
        eventId: eventAId,
        ticketTypeId: ttA!.id,
        zoneName: "Khu VIP Diamond",
        rowLabel: "A",
        seatNumber: "01",
        status: SeatStatus.SOLD,
      })
      .returning();
    createdSeatIds.push(seat1!.id);

    const [seat2] = await db
      .insert(seats)
      .values({
        eventId: eventAId,
        ticketTypeId: ttA!.id,
        zoneName: "Khu VIP Diamond",
        rowLabel: "A",
        seatNumber: "02",
        status: SeatStatus.SOLD,
      })
      .returning();
    createdSeatIds.push(seat2!.id);

    // Ticket Type for Event B
    const [ttB] = await db
      .insert(ticketTypes)
      .values({
        eventId: eventBId,
        name: "Fanzone Dung B",
        price: "1000000.00",
        capacity: 200,
        isSeated: false,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    createdTicketTypeIds.push(ttB!.id);

    // Ticket Type for Kill Switch Event
    const [ttKill] = await db
      .insert(ticketTypes)
      .values({
        eventId: eventAKillSwitchId,
        name: "Standard Kill Switch",
        price: "800000.00",
        capacity: 50,
        isSeated: false,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    createdTicketTypeIds.push(ttKill!.id);

    // 7. Orders
    const [orderA] = await db
      .insert(orders)
      .values({
        orderCode: `ORD-A-${randomUUID().replace(/-/g, "").slice(0, 10)}`,
        userId: buyer1.userId,
        eventId: eventAId,
        totalAmount: "10000000.00",
        discountAmount: "0.00",
        finalAmount: "10000000.00",
        status: OrderStatus.PAID,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      })
      .returning();
    createdOrderIds.push(orderA!.id);

    const [orderB] = await db
      .insert(orders)
      .values({
        orderCode: `ORD-B-${randomUUID().replace(/-/g, "").slice(0, 10)}`,
        userId: buyer2.userId,
        eventId: eventBId,
        totalAmount: "1000000.00",
        discountAmount: "0.00",
        finalAmount: "1000000.00",
        status: OrderStatus.PAID,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      })
      .returning();
    createdOrderIds.push(orderB!.id);

    const [orderKill] = await db
      .insert(orders)
      .values({
        orderCode: `ORD-KILL-${randomUUID().replace(/-/g, "").slice(0, 10)}`,
        userId: buyer1.userId,
        eventId: eventAKillSwitchId,
        totalAmount: "800000.00",
        discountAmount: "0.00",
        finalAmount: "800000.00",
        status: OrderStatus.PAID,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      })
      .returning();
    createdOrderIds.push(orderKill!.id);

    // 8. Tickets for individual scenarios
    // Scenario 1 ticket (Seated VIP A-01)
    const [t1] = await db
      .insert(tickets)
      .values({
        orderId: orderA!.id,
        userId: buyer1.userId,
        eventId: eventAId,
        ticketTypeId: ttA!.id,
        seatId: seat1!.id,
        ticketCode: `TK1_${randomUUID().replace(/-/g, "").slice(0, 28)}`,
        status: TicketStatus.SOLD,
      })
      .returning();
    ticketScenario1Id = t1!.id;
    createdTicketIds.push(ticketScenario1Id);

    // Scenario 2 ticket (Seated VIP A-02 for tamper/expiry)
    const [t2] = await db
      .insert(tickets)
      .values({
        orderId: orderA!.id,
        userId: buyer1.userId,
        eventId: eventAId,
        ticketTypeId: ttA!.id,
        seatId: seat2!.id,
        ticketCode: `TK2_${randomUUID().replace(/-/g, "").slice(0, 28)}`,
        status: TicketStatus.SOLD,
      })
      .returning();
    ticketScenario2Id = t2!.id;
    createdTicketIds.push(ticketScenario2Id);

    // Scenario 3 ticket (GA ticket for concurrency check)
    const [t3] = await db
      .insert(tickets)
      .values({
        orderId: orderA!.id,
        userId: buyer1.userId,
        eventId: eventAId,
        ticketTypeId: ttA!.id,
        seatId: null,
        ticketCode: `TK3_${randomUUID().replace(/-/g, "").slice(0, 28)}`,
        status: TicketStatus.SOLD,
      })
      .returning();
    ticketScenario3Id = t3!.id;
    createdTicketIds.push(ticketScenario3Id);

    // Scenario 4 ticket (Event B ticket to test staff scoping IDOR)
    const [t4] = await db
      .insert(tickets)
      .values({
        orderId: orderB!.id,
        userId: buyer2.userId,
        eventId: eventBId,
        ticketTypeId: ttB!.id,
        seatId: null,
        ticketCode: `TK4_${randomUUID().replace(/-/g, "").slice(0, 28)}`,
        status: TicketStatus.SOLD,
      })
      .returning();
    ticketScenario4Id = t4!.id;
    createdTicketIds.push(ticketScenario4Id);

    // Scenario 5 ticket (Kill Switch ticket)
    ticketScenario5Code = `TK5_${randomUUID().replace(/-/g, "").slice(0, 28)}`;
    const [t5] = await db
      .insert(tickets)
      .values({
        orderId: orderKill!.id,
        userId: buyer1.userId,
        eventId: eventAKillSwitchId,
        ticketTypeId: ttKill!.id,
        seatId: null,
        ticketCode: ticketScenario5Code,
        status: TicketStatus.SOLD,
      })
      .returning();
    ticketScenario5Id = t5!.id;
    createdTicketIds.push(ticketScenario5Id);

    // Scenario 6 ticket (Manual fallback lookup ticket)
    ticketScenario6Code = `LK6_${randomUUID().replace(/-/g, "").slice(0, 28)}`;
    const [t6] = await db
      .insert(tickets)
      .values({
        orderId: orderA!.id,
        userId: buyer1.userId,
        eventId: eventAId,
        ticketTypeId: ttA!.id,
        seatId: null,
        ticketCode: ticketScenario6Code,
        status: TicketStatus.SOLD,
      })
      .returning();
    ticketScenario6Id = t6!.id;
    createdTicketIds.push(ticketScenario6Id);
  });

  after(async () => {
    // Teardown in reverse dependency order
    if (createdTicketIds.length > 0) {
      await db
        .delete(auditLog)
        .where(inArray(auditLog.targetId, createdTicketIds));
      await db.delete(tickets).where(inArray(tickets.id, createdTicketIds));
    }

    if (createdOrderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, createdOrderIds));
    }

    if (createdSeatIds.length > 0) {
      await db.delete(seats).where(inArray(seats.id, createdSeatIds));
    }

    if (createdTicketTypeIds.length > 0) {
      await db
        .delete(ticketTypes)
        .where(inArray(ticketTypes.id, createdTicketTypeIds));
    }

    if (createdEventIds.length > 0) {
      await db
        .delete(eventStaff)
        .where(inArray(eventStaff.eventId, createdEventIds));
      await db.delete(gates).where(inArray(gates.eventId, createdEventIds));
      await db.delete(events).where(inArray(events.id, createdEventIds));
    }

    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }

    await sqlClient.end();
  });

  it("Scenario 1: Standard rolling QR check-in flow", async () => {
    // 1. Buyer 1 retrieves dynamic QR token for Ticket 1
    const qrResult = await ticketsController.getQrToken(
      buyer1,
      ticketScenario1Id,
    );

    assert.ok(qrResult.qrToken);
    assert.equal(qrResult.ticketId, ticketScenario1Id);
    assert.equal(qrResult.remainingSeconds, 30);

    // 2. Gate Staff of Event A scans the QR token at Gate A
    const scanResult = await gateController.scanTicket(staffEventA, {
      qrToken: qrResult.qrToken,
      gateId: gateAId,
    });

    assert.equal(scanResult.status, TicketStatus.CHECKED_IN);
    assert.equal(scanResult.ticketId, ticketScenario1Id);
    assert.equal(scanResult.eventTitle, "Dai Nhac Hoi UC08 Su Kien A");
    assert.equal(scanResult.buyerName, "Nguyen Van Mua Mot");
    assert.equal(scanResult.ticketTypeName, "VIP Diamond Khu A");
    assert.equal(scanResult.seatLabel, "Hàng A - Ghế 01");
    assert.equal(scanResult.gateId, gateAId);
    assert.ok(scanResult.checkedInAt);

    // 3. Verify PostgreSQL database state directly
    const [dbTicket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketScenario1Id))
      .limit(1);

    assert.equal(dbTicket!.status, TicketStatus.CHECKED_IN);
    assert.equal(dbTicket!.checkedInBy, staffEventA.userId);
    assert.equal(dbTicket!.gateId, gateAId);
    assert.ok(dbTicket!.checkedInAt);

    // 4. Duplicate scan attempt must fail with 409 Conflict
    await assert.rejects(
      async () =>
        gateController.scanTicket(staffEventA, {
          qrToken: qrResult.qrToken,
          gateId: gateAId,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        assert.match((err as Error).message, /TICKET_ALREADY_USED/);
        return true;
      },
    );
  });

  it("Scenario 2: Anti-tamper and QR expiration protection", async () => {
    // 1. Generate valid token
    const qrResult = await ticketsController.getQrToken(
      buyer1,
      ticketScenario2Id,
    );
    const validToken = qrResult.qrToken;

    // 2. Tampered signature: flip last characters of token
    const tamperedToken =
      validToken.slice(0, -6) +
      (validToken.slice(-6, -5) === "A" ? "B" : "A") +
      validToken.slice(-5);

    await assert.rejects(
      async () =>
        gateController.scanTicket(staffEventA, {
          qrToken: tamperedToken,
          gateId: gateAId,
        }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /INVALID_QR_SIGNATURE/);
        return true;
      },
    );

    // 3. Expired token: issued 36 seconds ago (exceeding 35s clock-skew tolerance)
    const expiredToken = ed25519Service.createTokenForTesting({
      sub: ticketScenario2Id,
      eventId: eventAId,
      orderId: createdOrderIds[0]!,
      userId: buyer1.userId,
      issuedAtSecondsAgo: 36,
    });

    await assert.rejects(
      async () =>
        gateController.scanTicket(staffEventA, {
          qrToken: expiredToken,
          gateId: gateAId,
        }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /QR_TOKEN_EXPIRED/);
        return true;
      },
    );

    // 4. Token within tolerance window (issued 20 seconds ago) succeeds
    const validToleranceToken = ed25519Service.createTokenForTesting({
      sub: ticketScenario2Id,
      eventId: eventAId,
      orderId: createdOrderIds[0]!,
      userId: buyer1.userId,
      issuedAtSecondsAgo: 20,
    });

    const successScan = await gateController.scanTicket(staffEventA, {
      qrToken: validToleranceToken,
      gateId: gateAId,
    });
    assert.equal(successScan.status, TicketStatus.CHECKED_IN);
    assert.equal(successScan.ticketId, ticketScenario2Id);
  });

  it("Scenario 3: Concurrency race condition handling (2 simultaneous scans)", async () => {
    // Buyer generates QR token for Ticket 3
    const qrResult = await ticketsController.getQrToken(
      buyer1,
      ticketScenario3Id,
    );

    // Simulate 2 gate scanners simultaneously scanning the exact same QR
    const [result1, result2] = await Promise.allSettled([
      gateController.scanTicket(staffEventA, {
        qrToken: qrResult.qrToken,
        gateId: gateAId,
      }),
      gateController.scanTicket(staffEventA, {
        qrToken: qrResult.qrToken,
        gateId: gateAId,
      }),
    ]);

    const successes = [result1, result2].filter(
      (r) => r.status === "fulfilled",
    );
    const rejections = [result1, result2].filter(
      (r) => r.status === "rejected",
    );

    assert.equal(
      successes.length,
      1,
      "Exactly one simultaneous scan must succeed",
    );
    assert.equal(
      rejections.length,
      1,
      "Exactly one simultaneous scan must be rejected",
    );

    const fulfilledResult = (
      successes[0] as PromiseFulfilledResult<{ status: string }>
    ).value;
    assert.equal(fulfilledResult.status, TicketStatus.CHECKED_IN);

    const rejectedReason = (rejections[0] as PromiseRejectedResult).reason;
    assert.ok(rejectedReason instanceof ConflictException);
    assert.match(rejectedReason.message, /TICKET_ALREADY_USED/);

    // Verify DB ticket is checked in exactly once
    const [dbTicket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketScenario3Id))
      .limit(1);

    assert.equal(dbTicket!.status, TicketStatus.CHECKED_IN);
  });

  it("Scenario 4: Staff IDOR event scoping and Admin bypass", async () => {
    // Ticket 4 belongs to Event B
    const qrResultEventB = await ticketsController.getQrToken(
      buyer2,
      ticketScenario4Id,
    );

    // 1. Staff of Event A attempts to scan ticket of Event B -> 403 Forbidden
    await assert.rejects(
      async () =>
        gateController.scanTicket(staffEventA, {
          qrToken: qrResultEventB.qrToken,
          gateId: gateAId,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        assert.match((err as Error).message, /STAFF_NOT_ASSIGNED_TO_EVENT/);
        return true;
      },
    );

    // 2. Admin scans ticket of Event B -> Bypasses event scoping and succeeds
    const adminScanResult = await gateController.scanTicket(adminUser, {
      qrToken: qrResultEventB.qrToken,
      gateId: gateBId,
    });

    assert.equal(adminScanResult.status, TicketStatus.CHECKED_IN);
    assert.equal(adminScanResult.ticketId, ticketScenario4Id);
  });

  it("Scenario 5: Emergency Kill Switch enforcement on SUSPENDED event", async () => {
    // 1. Initially event is PUBLISHED, buyer can get QR
    const qrResult = await ticketsController.getQrToken(
      buyer1,
      ticketScenario5Id,
    );
    assert.ok(qrResult.qrToken);

    // 2. Admin activates Emergency Kill Switch -> event status becomes SUSPENDED
    await db
      .update(events)
      .set({ status: EventStatus.SUSPENDED })
      .where(eq(events.id, eventAKillSwitchId));

    // 3. Buyer attempts to fetch new QR token -> 400 EVENT_NOT_ACTIVE
    await assert.rejects(
      async () => ticketsController.getQrToken(buyer1, ticketScenario5Id),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /EVENT_NOT_ACTIVE/);
        return true;
      },
    );

    // 4. Gate staff attempts to scan existing QR token -> 400 EVENT_NOT_ACTIVE
    await assert.rejects(
      async () =>
        gateController.scanTicket(adminUser, {
          qrToken: qrResult.qrToken,
        }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /EVENT_NOT_ACTIVE/);
        return true;
      },
    );

    // 5. Gate staff attempts manual lookup -> 400 EVENT_NOT_ACTIVE
    await assert.rejects(
      async () =>
        gateController.lookupTicket(adminUser, {
          eventId: eventAKillSwitchId,
          ticketCode: ticketScenario5Code,
          phoneOrEmailLast4: "2222",
          reason: "Emergency test",
        }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /EVENT_NOT_ACTIVE/);
        return true;
      },
    );
  });

  it("Scenario 6: Manual lookup fallback with 4-digit verification and audit log", async () => {
    // Buyer1 has phone "0901112222" (last 4: "2222")

    // 1. Wrong 4 digits ("9999") -> 400 VERIFICATION_FAILED
    await assert.rejects(
      async () =>
        gateController.lookupTicket(staffEventA, {
          eventId: eventAId,
          ticketCode: ticketScenario6Code,
          phoneOrEmailLast4: "9999",
          reason: "Khach het pin dien thoai",
          gateId: gateAId,
        }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /VERIFICATION_FAILED/);
        return true;
      },
    );

    // 2. Correct 4 digits ("2222") -> Succeeded
    const lookupResult = await gateController.lookupTicket(staffEventA, {
      eventId: eventAId,
      ticketCode: ticketScenario6Code,
      phoneOrEmailLast4: "2222",
      reason: "Khach het pin dien thoai tai cong",
      gateId: gateAId,
    });

    assert.equal(lookupResult.status, TicketStatus.CHECKED_IN);
    assert.equal(lookupResult.ticketId, ticketScenario6Id);
    assert.equal(lookupResult.method, "MANUAL_LOOKUP");
    assert.equal(lookupResult.buyerName, "Nguyen Van Mua Mot");
    assert.equal(lookupResult.gateId, gateAId);

    // 3. Verify audit log entry in PostgreSQL
    const [log] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, ticketScenario6Id))
      .limit(1);

    assert.ok(log, "Audit log entry must be created");
    assert.equal(log!.action, "MANUAL_TICKET_CHECK_IN");
    assert.equal(log!.actorId, staffEventA.userId);
    assert.equal(log!.actorRole, UserRole.GATE_STAFF);
    assert.equal(log!.targetType, "TICKET");
    assert.equal(log!.targetId, ticketScenario6Id);

    const changes = log!.changes as Record<string, unknown>;
    assert.equal(changes.reason, "Khach het pin dien thoai tai cong");
    assert.equal(changes.gateId, gateAId);

    // 4. Repeated lookup on already checked-in ticket -> 409 TICKET_ALREADY_USED
    await assert.rejects(
      async () =>
        gateController.lookupTicket(staffEventA, {
          eventId: eventAId,
          ticketCode: ticketScenario6Code,
          phoneOrEmailLast4: "2222",
          reason: "Thu lai",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        assert.match((err as Error).message, /TICKET_ALREADY_USED/);
        return true;
      },
    );
  });
});
