import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, sqlClient } from "../src/database/db";
import { AdminService } from "../src/admin/admin.service";
import {
  users,
  events,
  ticketTypes,
  seats,
  orders,
  auditLog,
  organizerProfiles,
} from "../src/database/schema";
import {
  UserRole,
  UserStatus,
  EventStatus,
  OrderStatus,
  SeatStatus,
  RefundPolicyType,
} from "@tickethub/shared";
import { ConflictException } from "@nestjs/common";

describe("AdminService Kill Switch, Resumption & Audit Logs", () => {
  let adminService: AdminService;

  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdTicketTypeIds: string[] = [];
  const createdSeatIds: string[] = [];
  const createdOrderIds: string[] = [];

  let adminUserId = "";
  let testEventId = "";
  let testOrderId = "";
  let testSeatId = "";
  let testGaTtId = "";
  let orgProfileId = "";

  before(async () => {
    adminService = new AdminService();
    const stamp = Date.now();

    // 1. Setup Admin
    const [adm] = await db
      .insert(users)
      .values({
        email: `admin_ks_${stamp}@tickethub.vn`,
        fullName: "Admin KillSwitch",
        passwordHash: "$argon2id$dummy",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      })
      .returning();
    adminUserId = adm!.id;
    createdUserIds.push(adminUserId);

    // 2. Setup Organizer
    const [orgUser] = await db
      .insert(users)
      .values({
        email: `org_ks_${stamp}@tickethub.vn`,
        fullName: "BTC KillSwitch",
        passwordHash: "$argon2id$dummy",
        role: UserRole.ORGANIZER,
        status: UserStatus.ACTIVE,
      })
      .returning();
    createdUserIds.push(orgUser!.id);

    const [p] = await db
      .insert(organizerProfiles)
      .values({
        userId: orgUser!.id,
        organizationName: "BTC KillSwitch Co",
        taxCode: "0109998888",
        businessLicenseUrl: "https://cdn.tickethub.vn/license.pdf",
        representativeName: "Giam Doc KS",
      })
      .returning();
    orgProfileId = p!.id;

    // 3. Setup Published Event
    const now = new Date();
    const startTime = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const endTime = new Date(startTime.getTime() + 4 * 3600 * 1000);

    const [evt] = await db
      .insert(events)
      .values({
        organizerId: orgProfileId,
        title: "Dai Nhac Hoi Kill Switch Test",
        slug: `ks-event-${randomUUID().slice(0, 8)}`,
        description: "Su kien thu nghiem admin kill switch",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner.webp",
        venueName: "San Van Dong My Dinh",
        venueAddress: "Le Duc Tho, Nam Tu Liem",
        city: "Ha Noi",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    testEventId = evt!.id;
    createdEventIds.push(testEventId);

    // 4. Setup Seated TicketType & HELD Seat
    const [ttSeated] = await db
      .insert(ticketTypes)
      .values({
        eventId: testEventId,
        name: "VIP Seated",
        price: "1500000.00",
        capacity: 50,
        isSeated: true,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    createdTicketTypeIds.push(ttSeated!.id);

    const [seatHeld] = await db
      .insert(seats)
      .values({
        eventId: testEventId,
        ticketTypeId: ttSeated!.id,
        zoneName: "Khu VIP",
        rowLabel: "A",
        seatNumber: "01",
        status: SeatStatus.HELD,
      })
      .returning();
    testSeatId = seatHeld!.id;
    createdSeatIds.push(testSeatId);

    // 5. Setup GA TicketType with heldCount = 3
    const [ttGa] = await db
      .insert(ticketTypes)
      .values({
        eventId: testEventId,
        name: "GA Standing",
        price: "500000.00",
        capacity: 100,
        heldCount: 3,
        soldCount: 0,
        isSeated: false,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    testGaTtId = ttGa!.id;
    createdTicketTypeIds.push(testGaTtId);

    // 6. Setup PENDING Order
    const [orderPending] = await db
      .insert(orders)
      .values({
        orderCode: `ORD-KS-${randomUUID().replace(/-/g, "").slice(0, 10)}`,
        userId: adminUserId,
        eventId: testEventId,
        totalAmount: "1500000.00",
        discountAmount: "0.00",
        finalAmount: "1500000.00",
        status: OrderStatus.PENDING,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      })
      .returning();
    testOrderId = orderPending!.id;
    createdOrderIds.push(testOrderId);
  });

  after(async () => {
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
        .delete(auditLog)
        .where(inArray(auditLog.targetId, createdEventIds));
      await db.delete(events).where(inArray(events.id, createdEventIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }

    await sqlClient.end();
  });

  it("activates Kill Switch, cascades cancellation & releases holds, and writes audit log", async () => {
    const res = await adminService.activateKillSwitch(
      testEventId,
      adminUserId,
      {
        reason: "Phat hien hanh vi ban ve cho den so luong lon",
      },
      {
        ipAddress: "127.0.0.1",
        userAgent: "TestAgent/1.0",
      },
    );

    assert.equal(res.eventId, testEventId);
    assert.equal(res.status, EventStatus.SUSPENDED);
    assert.equal(res.cancelledPendingOrdersCount, 1);
    assert.equal(res.releasedHeldSeatsCount, 1);
    assert.equal(res.releasedHeldStandingCount, 3);
    assert.equal(res.totalReleasedHoldsCount, 4);

    // Verify DB states directly
    const [dbEvt] = await db
      .select()
      .from(events)
      .where(eq(events.id, testEventId));
    assert.equal(dbEvt!.status, EventStatus.SUSPENDED);
    assert.equal(
      dbEvt!.rejectionReason,
      "Phat hien hanh vi ban ve cho den so luong lon",
    );

    const [dbOrder] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, testOrderId));
    assert.equal(dbOrder!.status, OrderStatus.CANCELLED);

    const [dbSeat] = await db
      .select()
      .from(seats)
      .where(eq(seats.id, testSeatId));
    assert.equal(dbSeat!.status, SeatStatus.AVAILABLE);

    const [dbGa] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.id, testGaTtId));
    assert.equal(dbGa!.heldCount, 0);

    // Check audit_log
    const [log] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, testEventId))
      .orderBy(auditLog.createdAt)
      .limit(1);

    assert.ok(log);
    assert.equal(log!.action, "EVENT_KILL_SWITCH_ACTIVATED");
    assert.equal(log!.actorId, adminUserId);
    assert.equal(log!.actorRole, UserRole.ADMIN);
  });

  it("rejects activating Kill Switch on already SUSPENDED event", async () => {
    await assert.rejects(
      async () =>
        adminService.activateKillSwitch(testEventId, adminUserId, {
          reason: "Kich hoat lai",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        assert.match((err as Error).message, /EVENT_ALREADY_SUSPENDED/);
        return true;
      },
    );
  });

  it("resumes SUSPENDED event back to PUBLISHED", async () => {
    const resumeRes = await adminService.resumeEvent(
      testEventId,
      adminUserId,
      {
        reason: "Ban to chuc da giai trinh hop le",
      },
      {
        ipAddress: "127.0.0.1",
        userAgent: "TestAgent/1.0",
      },
    );

    assert.equal(resumeRes.eventId, testEventId);
    assert.equal(resumeRes.status, EventStatus.PUBLISHED);

    const [dbEvt] = await db
      .select()
      .from(events)
      .where(eq(events.id, testEventId));
    assert.equal(dbEvt!.status, EventStatus.PUBLISHED);
    assert.equal(dbEvt!.rejectionReason, null);
  });

  it("retrieves paginated audit logs for the event", async () => {
    const auditRes = await adminService.getEventAuditLogs(testEventId, {
      page: 1,
      limit: 10,
    });

    assert.ok(auditRes.items.length >= 2);
    assert.equal(auditRes.meta.total >= 2, true);
    assert.equal(auditRes.items[0]!.targetId, testEventId);
    assert.equal(auditRes.items[0]!.targetType, "EVENT");
  });
});
