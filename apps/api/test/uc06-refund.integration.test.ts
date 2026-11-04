import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, sqlClient } from "../src/database/db";
import { RefundsService } from "../src/refunds/refunds.service";
import { RefundsController } from "../src/refunds/refunds.controller";
import {
  users,
  organizerProfiles,
  events,
  ticketTypes,
  seats,
  orders,
  orderItems,
  tickets,
  refunds,
  outbox,
  auditLog,
} from "../src/database/schema";
import {
  UserRole,
  UserStatus,
  EventStatus,
  RefundPolicyType,
  SeatStatus,
  OrderStatus,
  TicketStatus,
  type AuthUser,
} from "@tickethub/shared";
import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";

describe("UC06: Ticket Cancellation & Automated Refund Integration Tests", () => {
  let refundsService: RefundsService;
  let refundsController: RefundsController;

  let buyer1: { id: string; email: string };
  let buyer2: { id: string; email: string };
  let adminUser: { id: string; email: string };
  let orgProfileId: string;

  // Track created entities for clean teardown
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdTicketTypeIds: string[] = [];
  const createdSeatIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdIdempKeys: string[] = [];

  before(async () => {
    refundsService = new RefundsService();
    refundsController = new RefundsController(refundsService);

    const stamp = Date.now();

    // 1. Setup Organizer Profile
    let orgProfile = await db.query.organizerProfiles.findFirst();
    if (!orgProfile) {
      const [u] = await db
        .insert(users)
        .values({
          email: `org_uc06_${stamp}@tickethub.vn`,
          fullName: "BTC UC06 Test",
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
          organizationName: "To Chuc UC06 Integration",
          taxCode: "0109999999",
          businessLicenseUrl: "https://cdn.tickethub.vn/license.pdf",
          representativeName: "Dai Dien UC06",
        })
        .returning();
      orgProfile = p;
    }
    orgProfileId = orgProfile!.id;

    // 2. Setup Buyers and Admin
    const [b1] = await db
      .insert(users)
      .values({
        email: `buyer1_uc06_${stamp}@tickethub.vn`,
        fullName: "Nguoi Mua Mot",
        passwordHash: "$argon2id$dummy",
        role: UserRole.BUYER,
        status: UserStatus.ACTIVE,
      })
      .returning();
    buyer1 = { id: b1!.id, email: b1!.email };
    createdUserIds.push(buyer1.id);

    const [b2] = await db
      .insert(users)
      .values({
        email: `buyer2_uc06_${stamp}@tickethub.vn`,
        fullName: "Nguoi Mua Hai",
        passwordHash: "$argon2id$dummy",
        role: UserRole.BUYER,
        status: UserStatus.ACTIVE,
      })
      .returning();
    buyer2 = { id: b2!.id, email: b2!.email };
    createdUserIds.push(buyer2.id);

    const [adm] = await db
      .insert(users)
      .values({
        email: `admin_uc06_${stamp}@tickethub.vn`,
        fullName: "Quan Tri Vien UC06",
        passwordHash: "$argon2id$dummy",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      })
      .returning();
    adminUser = { id: adm!.id, email: adm!.email };
    createdUserIds.push(adminUser.id);
  });

  after(async () => {
    // Teardown in reverse dependency order
    if (createdOrderIds.length > 0) {
      await db
        .delete(auditLog)
        .where(inArray(auditLog.targetId, createdOrderIds));
      await sqlClient`DELETE FROM outbox WHERE payload->>'orderId' = ANY(${createdOrderIds})`;
      await db.delete(refunds).where(inArray(refunds.orderId, createdOrderIds));
      await db.delete(tickets).where(inArray(tickets.orderId, createdOrderIds));
      await db
        .delete(orderItems)
        .where(inArray(orderItems.orderId, createdOrderIds));
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
      await db.delete(events).where(inArray(events.id, createdEventIds));
    }

    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }

    if (createdIdempKeys.length > 0) {
      await sqlClient`DELETE FROM idempotency_keys WHERE key = ANY(${createdIdempKeys})`;
    }

    await sqlClient.end();
  });

  it("Scenario 1: Full flow - Preview, IDOR check, partial refund, idempotency, and final refund", async () => {
    const now = new Date();
    // Event 10 days in the future (FLEXIBLE policy => 100% refund)
    const startTime = new Date(now.getTime() + 10 * 24 * 3600 * 1000);
    const endTime = new Date(startTime.getTime() + 4 * 3600 * 1000);

    const [testEvt] = await db
      .insert(events)
      .values({
        organizerId: orgProfileId,
        title: "Live Concert UC06 Seated",
        slug: `uc06-concert-${randomUUID().slice(0, 8)}`,
        description: "Su kien thu nghiem huy va hoan tien UC06",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner.webp",
        venueName: "Nha Hat Hoa Binh",
        venueAddress: "240 Ba Thang Hai, Quan 10",
        city: "TP. Ho Chi Minh",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED,
        isWaitingRoomEnabled: false,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    createdEventIds.push(testEvt!.id);

    const [seatedTt] = await db
      .insert(ticketTypes)
      .values({
        eventId: testEvt!.id,
        name: "Hang Ve VIP Seated",
        price: "2500000.00",
        capacity: 10,
        isSeated: true,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    createdTicketTypeIds.push(seatedTt!.id);

    // Create 2 seats
    const seatIdSuffix = randomUUID().slice(0, 6);
    const [s1] = await db
      .insert(seats)
      .values({
        eventId: testEvt!.id,
        ticketTypeId: seatedTt!.id,
        seatNumber: `A01-${seatIdSuffix}`,
        rowNumber: 1,
        rowLabel: "A",
        zoneName: "VIP",
        status: SeatStatus.SOLD,
      })
      .returning();
    const [s2] = await db
      .insert(seats)
      .values({
        eventId: testEvt!.id,
        ticketTypeId: seatedTt!.id,
        seatNumber: `A02-${seatIdSuffix}`,
        rowNumber: 1,
        rowLabel: "A",
        zoneName: "VIP",
        status: SeatStatus.SOLD,
      })
      .returning();
    createdSeatIds.push(s1!.id, s2!.id);

    // Create an order with 2 tickets:
    // unitPrice: 2,500,000 x 2 = 5,000,000
    // voucher: 500,000 discount => finalAmount: 4,500,000
    const [order] = await db
      .insert(orders)
      .values({
        orderCode: `ORD-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        userId: buyer1.id,
        eventId: testEvt!.id,
        totalAmount: "5000000.00",
        discountAmount: "500000.00",
        finalAmount: "4500000.00",
        status: OrderStatus.PAID,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      })
      .returning();
    createdOrderIds.push(order!.id);

    await db.insert(orderItems).values([
      {
        orderId: order!.id,
        ticketTypeId: seatedTt!.id,
        quantity: 1,
        unitPrice: "2500000.00",
        subtotal: "2500000.00",
      },
      {
        orderId: order!.id,
        ticketTypeId: seatedTt!.id,
        quantity: 1,
        unitPrice: "2500000.00",
        subtotal: "2500000.00",
      },
    ]);

    const [t1] = await db
      .insert(tickets)
      .values({
        orderId: order!.id,
        userId: buyer1.id,
        eventId: testEvt!.id,
        ticketTypeId: seatedTt!.id,
        seatId: s1!.id,
        ticketCode: `TK-UC06-1-${randomUUID().slice(0, 10)}`,
        status: TicketStatus.SOLD,
      })
      .returning();

    const [t2] = await db
      .insert(tickets)
      .values({
        orderId: order!.id,
        userId: buyer1.id,
        eventId: testEvt!.id,
        ticketTypeId: seatedTt!.id,
        seatId: s2!.id,
        ticketCode: `TK-UC06-2-${randomUUID().slice(0, 10)}`,
        status: TicketStatus.SOLD,
      })
      .returning();

    const buyer1User: AuthUser = {
      userId: buyer1.id,
      email: buyer1.email,
      role: UserRole.BUYER,
    };
    const buyer2User: AuthUser = {
      userId: buyer2.id,
      email: buyer2.email,
      role: UserRole.BUYER,
    };
    const adminAuthUser: AuthUser = {
      userId: adminUser.id,
      email: adminUser.email,
      role: UserRole.ADMIN,
    };

    // --- Sub-test 1: Preview refund with pro-rata voucher allocation ---
    const preview1 = await refundsController.preview(buyer1User, {
      orderId: order!.id,
      ticketIds: [t1!.id],
    });

    assert.equal(preview1.orderId, order!.id);
    assert.equal(preview1.refundPercentage, 100);
    assert.equal(preview1.items.length, 1);
    assert.equal(preview1.items[0]!.ticketId, t1!.id);
    assert.equal(preview1.items[0]!.originalPrice, 2500000);
    // Pro-rata: 2,500,000 * (4,500,000 / 5,000,000) = 2,250,000
    assert.equal(preview1.items[0]!.effectivePaidPrice, 2250000);
    assert.equal(preview1.items[0]!.refundAmount, 2250000);
    assert.equal(preview1.items[0]!.feeDeducted, 0);
    assert.equal(preview1.totalRefundAmount, 2250000);
    assert.equal(preview1.totalFeeDeducted, 0);

    // --- Sub-test 2: IDOR Protection ---
    // Buyer 2 tries to preview Buyer 1's order -> Throws ForbiddenException
    await assert.rejects(
      async () => {
        await refundsController.preview(buyer2User, {
          orderId: order!.id,
          ticketIds: [t1!.id],
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        assert.match((err as Error).message, /ACCESS_DENIED/);
        return true;
      },
    );

    // Buyer 2 tries to execute refund on Buyer 1's order -> Throws ForbiddenException
    await assert.rejects(
      async () => {
        await refundsController.request(buyer2User, "test-idemp-unauthorized", {
          orderId: order!.id,
          ticketIds: [t1!.id],
          reason: "IDOR attempt",
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        return true;
      },
    );

    // --- Sub-test 3: Missing Idempotency-Key header throws BadRequestException ---
    await assert.rejects(
      async () => {
        await refundsController.request(buyer1User, "", {
          orderId: order!.id,
          ticketIds: [t1!.id],
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /Missing Idempotency-Key/);
        return true;
      },
    );

    // --- Sub-test 4: Partial Refund 1 (Refund Ticket 1 only) ---
    const idempKey1 = `IK-${randomUUID()}`;
    createdIdempKeys.push(idempKey1);
    const executeRes1 = await refundsController.request(buyer1User, idempKey1, {
      orderId: order!.id,
      ticketIds: [t1!.id],
      reason: "Ke hoach ca nhan thay doi",
    });

    assert.equal(executeRes1.orderId, order!.id);
    assert.equal(executeRes1.status, "PROCESSING");
    assert.equal(executeRes1.refundAmount, 2250000);
    assert.equal(executeRes1.cancelledTicketCount, 1);
    assert.equal(executeRes1.orderStatus, "PAID"); // Still 1 active ticket

    // Verify DB state after partial refund 1
    const dbTicket1 = await db.query.tickets.findFirst({
      where: eq(tickets.id, t1!.id),
    });
    assert.equal(dbTicket1?.status, TicketStatus.CANCELLED);

    const dbTicket2 = await db.query.tickets.findFirst({
      where: eq(tickets.id, t2!.id),
    });
    assert.equal(dbTicket2?.status, TicketStatus.SOLD);

    const dbSeat1 = await db.query.seats.findFirst({
      where: eq(seats.id, s1!.id),
    });
    assert.equal(dbSeat1?.status, SeatStatus.AVAILABLE);
    assert.equal(dbSeat1?.holdOrderId, null);

    const dbSeat2 = await db.query.seats.findFirst({
      where: eq(seats.id, s2!.id),
    });
    assert.equal(dbSeat2?.status, SeatStatus.SOLD);

    const dbOrderAfter1 = await db.query.orders.findFirst({
      where: eq(orders.id, order!.id),
    });
    assert.equal(dbOrderAfter1?.status, OrderStatus.PAID);

    // Verify outbox entry for partial refund 1
    const allOutbox1 = await db.query.outbox.findMany({
      where: eq(outbox.eventType, "REFUND_REQUESTED"),
    });
    const outboxEntries1 = allOutbox1.filter(
      (o) => (o.payload as { orderId: string }).orderId === order!.id,
    );
    assert.equal(outboxEntries1.length, 1);
    const event1Payload = outboxEntries1[0]!.payload as {
      orderId: string;
      amount: number;
      isPartial: boolean;
    };
    assert.equal(event1Payload.orderId, order!.id);
    assert.equal(event1Payload.amount, 2250000);
    assert.equal(event1Payload.isPartial, true);

    // --- Sub-test 5: Idempotency & Conflict Protection ---
    // A) Replay with exact same Idempotency-Key returns cached response without duplicate execution
    const replayRes = await refundsController.request(buyer1User, idempKey1, {
      orderId: order!.id,
      ticketIds: [t1!.id],
    });
    assert.equal(replayRes.refundId, executeRes1.refundId);
    assert.equal(replayRes.refundAmount, executeRes1.refundAmount);

    // Verify DB still only has 1 refund record (no duplicate execution)
    const refundsCountAfterReplay = await db.query.refunds.findMany({
      where: eq(refunds.orderId, order!.id),
    });
    assert.equal(refundsCountAfterReplay.length, 1);

    // B) Re-requesting refund on already-cancelled ticket with a new idempotency key throws ConflictException
    const conflictIdempKey = `IK-CONFLICT-${randomUUID()}`;
    createdIdempKeys.push(conflictIdempKey);
    await assert.rejects(
      async () => {
        await refundsController.request(buyer1User, conflictIdempKey, {
          orderId: order!.id,
          ticketIds: [t1!.id],
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        assert.match((err as Error).message, /TICKET_NOT_ELIGIBLE_FOR_REFUND/);
        return true;
      },
    );

    // --- Sub-test 6: Partial Refund 2 (Refund Ticket 2 -> Full order refund) ---
    const idempKey2 = `IK-${randomUUID()}`;
    createdIdempKeys.push(idempKey2);
    const executeRes2 = await refundsController.request(
      adminAuthUser, // Admin role test: can perform refund on behalf of user
      idempKey2,
      {
        orderId: order!.id,
        ticketIds: [t2!.id],
        reason: "Hoan ve con lai",
      },
    );

    assert.equal(executeRes2.orderId, order!.id);
    assert.equal(executeRes2.refundAmount, 2250000);
    assert.equal(executeRes2.cancelledTicketCount, 1);
    assert.equal(executeRes2.orderStatus, "REFUNDED"); // All tickets cancelled!

    // Verify DB state after partial refund 2
    const dbTicket2After = await db.query.tickets.findFirst({
      where: eq(tickets.id, t2!.id),
    });
    assert.equal(dbTicket2After?.status, TicketStatus.CANCELLED);

    const dbSeat2After = await db.query.seats.findFirst({
      where: eq(seats.id, s2!.id),
    });
    assert.equal(dbSeat2After?.status, SeatStatus.AVAILABLE);

    const dbOrderAfter2 = await db.query.orders.findFirst({
      where: eq(orders.id, order!.id),
    });
    assert.equal(dbOrderAfter2?.status, OrderStatus.REFUNDED);

    // Verify total refunds in DB sum up exactly to 4,500,000 (Safety cap respected)
    const allRefunds = await db.query.refunds.findMany({
      where: eq(refunds.orderId, order!.id),
    });
    assert.equal(allRefunds.length, 2);
    const sumRefunds = allRefunds.reduce(
      (acc, r) => acc + Number.parseFloat(r.amount),
      0,
    );
    assert.equal(sumRefunds, 4500000);

    // Verify outbox entry for second refund (isPartial = false)
    const allOutbox2 = await db.query.outbox.findMany({
      where: eq(outbox.eventType, "REFUND_REQUESTED"),
    });
    const outboxEntries2 = allOutbox2.filter(
      (o) => (o.payload as { orderId: string }).orderId === order!.id,
    );
    assert.equal(outboxEntries2.length, 2);
    const secondEvent = outboxEntries2.find((o) =>
      (o.payload as { refundIds: string[] }).refundIds.includes(
        executeRes2.refundId,
      ),
    );
    assert.ok(secondEvent);
    const event2Payload = secondEvent!.payload as {
      orderId: string;
      amount: number;
      isPartial: boolean;
    };
    assert.equal(event2Payload.isPartial, true);
  });

  it("Scenario 2: Policy tiers (STRICT policy & NO_REFUND policy)", async () => {
    const now = new Date();
    // Event 10 days in the future for STRICT policy (< 14 days => 0% refund)
    const startTimeStrict = new Date(now.getTime() + 10 * 24 * 3600 * 1000);
    const endTimeStrict = new Date(startTimeStrict.getTime() + 4 * 3600 * 1000);

    const [strictEvt] = await db
      .insert(events)
      .values({
        organizerId: orgProfileId,
        title: "Strict Policy Event",
        slug: `strict-evt-${randomUUID().slice(0, 8)}`,
        description: "Su kien chinh sach nghiem ngat",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner.webp",
        venueName: "San Khau Lan Anh",
        venueAddress: "285 CMT8, Quan 10",
        city: "TP. Ho Chi Minh",
        startTime: startTimeStrict,
        endTime: endTimeStrict,
        gateOpeningTime: startTimeStrict,
        status: EventStatus.PUBLISHED,
        isWaitingRoomEnabled: false,
        refundPolicyType: RefundPolicyType.STRICT,
      })
      .returning();
    createdEventIds.push(strictEvt!.id);

    const [strictTt] = await db
      .insert(ticketTypes)
      .values({
        eventId: strictEvt!.id,
        name: "Ve Strict",
        price: "1000000.00",
        capacity: 10,
        isSeated: false,
        saleStartTime: now,
        saleEndTime: startTimeStrict,
      })
      .returning();
    createdTicketTypeIds.push(strictTt!.id);

    const [strictOrder] = await db
      .insert(orders)
      .values({
        orderCode: `ORD-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        userId: buyer1.id,
        eventId: strictEvt!.id,
        totalAmount: "1000000.00",
        discountAmount: "0.00",
        finalAmount: "1000000.00",
        status: OrderStatus.PAID,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      })
      .returning();
    createdOrderIds.push(strictOrder!.id);

    await db.insert(orderItems).values([
      {
        orderId: strictOrder!.id,
        ticketTypeId: strictTt!.id,
        quantity: 1,
        unitPrice: "1000000.00",
        subtotal: "1000000.00",
      },
    ]);

    const [strictTkt] = await db
      .insert(tickets)
      .values({
        orderId: strictOrder!.id,
        userId: buyer1.id,
        eventId: strictEvt!.id,
        ticketTypeId: strictTt!.id,
        ticketCode: `TK-STRICT-${randomUUID().slice(0, 10)}`,
        status: TicketStatus.SOLD,
      })
      .returning();

    const buyer1User: AuthUser = {
      userId: buyer1.id,
      email: buyer1.email,
      role: UserRole.BUYER,
    };

    // Sub-test A: STRICT policy when < 14 days (10 days out) -> throws BadRequestException (0% refund)
    await assert.rejects(
      async () => {
        await refundsController.preview(buyer1User, {
          orderId: strictOrder!.id,
          ticketIds: [strictTkt!.id],
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /REFUND_POLICY_NOT_ELIGIBLE/);
        return true;
      },
    );

    // Sub-test B: STRICT policy when >= 14 days (20 days out) -> allows 50% refund
    const startTimeStrictEligible = new Date(
      now.getTime() + 20 * 24 * 3600 * 1000,
    );
    const endTimeStrictEligible = new Date(
      startTimeStrictEligible.getTime() + 4 * 3600 * 1000,
    );

    const [strictEligibleEvt] = await db
      .insert(events)
      .values({
        organizerId: orgProfileId,
        title: "Strict Eligible Event",
        slug: `strict-ok-evt-${randomUUID().slice(0, 8)}`,
        description: "Su kien chinh sach nghiem ngat tren 14 ngay",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner.webp",
        venueName: "San Khau Lan Anh",
        venueAddress: "285 CMT8, Quan 10",
        city: "TP. Ho Chi Minh",
        startTime: startTimeStrictEligible,
        endTime: endTimeStrictEligible,
        gateOpeningTime: startTimeStrictEligible,
        status: EventStatus.PUBLISHED,
        isWaitingRoomEnabled: false,
        refundPolicyType: RefundPolicyType.STRICT,
      })
      .returning();
    createdEventIds.push(strictEligibleEvt!.id);

    const [strictEligibleTt] = await db
      .insert(ticketTypes)
      .values({
        eventId: strictEligibleEvt!.id,
        name: "Ve Strict 50%",
        price: "1000000.00",
        capacity: 10,
        isSeated: false,
        saleStartTime: now,
        saleEndTime: startTimeStrictEligible,
      })
      .returning();
    createdTicketTypeIds.push(strictEligibleTt!.id);

    const [strictEligibleOrder] = await db
      .insert(orders)
      .values({
        orderCode: `ORD-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        userId: buyer1.id,
        eventId: strictEligibleEvt!.id,
        totalAmount: "1000000.00",
        discountAmount: "0.00",
        finalAmount: "1000000.00",
        status: OrderStatus.PAID,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      })
      .returning();
    createdOrderIds.push(strictEligibleOrder!.id);

    await db.insert(orderItems).values([
      {
        orderId: strictEligibleOrder!.id,
        ticketTypeId: strictEligibleTt!.id,
        quantity: 1,
        unitPrice: "1000000.00",
        subtotal: "1000000.00",
      },
    ]);

    const [strictEligibleTkt] = await db
      .insert(tickets)
      .values({
        orderId: strictEligibleOrder!.id,
        userId: buyer1.id,
        eventId: strictEligibleEvt!.id,
        ticketTypeId: strictEligibleTt!.id,
        ticketCode: `TK-STRICT-OK-${randomUUID().slice(0, 10)}`,
        status: TicketStatus.SOLD,
      })
      .returning();

    const strictEligiblePreview = await refundsController.preview(buyer1User, {
      orderId: strictEligibleOrder!.id,
      ticketIds: [strictEligibleTkt!.id],
    });
    assert.equal(strictEligiblePreview.refundPercentage, 50);
    assert.equal(strictEligiblePreview.totalRefundAmount, 500000);
    assert.equal(strictEligiblePreview.totalFeeDeducted, 500000);

    // Sub-test C: NO_REFUND event test -> always throws BadRequestException
    const [noRefundEvt] = await db
      .insert(events)
      .values({
        organizerId: orgProfileId,
        title: "No Refund Event",
        slug: `no-refund-evt-${randomUUID().slice(0, 8)}`,
        description: "Su kien khong hoan tien",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner.webp",
        venueName: "San Khau 123",
        venueAddress: "123 Tran Hung Dao",
        city: "TP. Ho Chi Minh",
        startTime: startTimeStrict,
        endTime: endTimeStrict,
        gateOpeningTime: startTimeStrict,
        status: EventStatus.PUBLISHED,
        isWaitingRoomEnabled: false,
        refundPolicyType: RefundPolicyType.NO_REFUND,
      })
      .returning();
    createdEventIds.push(noRefundEvt!.id);

    const [noRefundTt] = await db
      .insert(ticketTypes)
      .values({
        eventId: noRefundEvt!.id,
        name: "Ve No Refund",
        price: "800000.00",
        capacity: 10,
        isSeated: false,
        saleStartTime: now,
        saleEndTime: startTimeStrict,
      })
      .returning();
    createdTicketTypeIds.push(noRefundTt!.id);

    const [noRefundOrder] = await db
      .insert(orders)
      .values({
        orderCode: `ORD-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        userId: buyer1.id,
        eventId: noRefundEvt!.id,
        totalAmount: "800000.00",
        discountAmount: "0.00",
        finalAmount: "800000.00",
        status: OrderStatus.PAID,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      })
      .returning();
    createdOrderIds.push(noRefundOrder!.id);

    await db.insert(orderItems).values([
      {
        orderId: noRefundOrder!.id,
        ticketTypeId: noRefundTt!.id,
        quantity: 1,
        unitPrice: "800000.00",
        subtotal: "800000.00",
      },
    ]);

    const [noRefundTkt] = await db
      .insert(tickets)
      .values({
        orderId: noRefundOrder!.id,
        userId: buyer1.id,
        eventId: noRefundEvt!.id,
        ticketTypeId: noRefundTt!.id,
        ticketCode: `TK-NOREF-${randomUUID().slice(0, 10)}`,
        status: TicketStatus.SOLD,
      })
      .returning();

    await assert.rejects(
      async () => {
        await refundsController.preview(buyer1User, {
          orderId: noRefundOrder!.id,
          ticketIds: [noRefundTkt!.id],
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /REFUND_POLICY_NOT_ELIGIBLE/);
        return true;
      },
    );
  });

  it("Scenario 3: GA / Standing Ticket Refund (no seat row assigned)", async () => {
    const now = new Date();
    const startTime = new Date(now.getTime() + 10 * 24 * 3600 * 1000);
    const endTime = new Date(startTime.getTime() + 4 * 3600 * 1000);

    const [gaEvt] = await db
      .insert(events)
      .values({
        organizerId: orgProfileId,
        title: "GA Standing Event",
        slug: `ga-evt-${randomUUID().slice(0, 8)}`,
        description: "Su kien ve dung GA",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner.webp",
        venueName: "San Khau Fanzone",
        venueAddress: "123 Pham Van Dong",
        city: "TP. Ho Chi Minh",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED,
        isWaitingRoomEnabled: false,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    createdEventIds.push(gaEvt!.id);

    const [gaTt] = await db
      .insert(ticketTypes)
      .values({
        eventId: gaEvt!.id,
        name: "GA - Fanzone",
        price: "1500000.00",
        capacity: 100,
        soldCount: 5,
        isSeated: false,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    createdTicketTypeIds.push(gaTt!.id);

    const [gaOrder] = await db
      .insert(orders)
      .values({
        orderCode: `ORD-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        userId: buyer1.id,
        eventId: gaEvt!.id,
        totalAmount: "1500000.00",
        discountAmount: "0.00",
        finalAmount: "1500000.00",
        status: OrderStatus.PAID,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      })
      .returning();
    createdOrderIds.push(gaOrder!.id);

    await db.insert(orderItems).values([
      {
        orderId: gaOrder!.id,
        ticketTypeId: gaTt!.id,
        quantity: 1,
        unitPrice: "1500000.00",
        subtotal: "1500000.00",
      },
    ]);

    const [gaTicket] = await db
      .insert(tickets)
      .values({
        orderId: gaOrder!.id,
        userId: buyer1.id,
        eventId: gaEvt!.id,
        ticketTypeId: gaTt!.id,
        seatId: null, // GA has no seat record
        ticketCode: `TK-GA-${randomUUID().slice(0, 10)}`,
        status: TicketStatus.SOLD,
      })
      .returning();

    const buyer1User: AuthUser = {
      userId: buyer1.id,
      email: buyer1.email,
      role: UserRole.BUYER,
    };

    const gaIdempKey = `IK-GA-${randomUUID()}`;
    createdIdempKeys.push(gaIdempKey);
    const gaRefundRes = await refundsController.request(
      buyer1User,
      gaIdempKey,
      {
        orderId: gaOrder!.id,
        ticketIds: [gaTicket!.id],
        reason: "Huy ve dung GA",
      },
    );

    assert.equal(gaRefundRes.orderId, gaOrder!.id);
    assert.equal(gaRefundRes.refundAmount, 1500000);
    assert.equal(gaRefundRes.cancelledTicketCount, 1);
    assert.equal(gaRefundRes.orderStatus, "REFUNDED");

    // Verify ticket cancelled
    const dbGaTicket = await db.query.tickets.findFirst({
      where: eq(tickets.id, gaTicket!.id),
    });
    assert.equal(dbGaTicket?.status, TicketStatus.CANCELLED);

    // Verify soldCount decremented in ticketTypes
    const dbGaTt = await db.query.ticketTypes.findFirst({
      where: eq(ticketTypes.id, gaTt!.id),
    });
    assert.equal(dbGaTt?.soldCount, 4);

    // Verify outbox entry for 100% full refund on single transaction (isPartial = false)
    const allOutboxGa = await db.query.outbox.findMany({
      where: eq(outbox.eventType, "REFUND_REQUESTED"),
    });
    const gaOutbox = allOutboxGa.find(
      (o) => (o.payload as { orderId: string }).orderId === gaOrder!.id,
    );
    assert.ok(gaOutbox);
    const gaPayload = gaOutbox!.payload as {
      orderId: string;
      amount: number;
      isPartial: boolean;
    };
    assert.equal(gaPayload.amount, 1500000);
    assert.equal(gaPayload.isPartial, false);
  });
});
