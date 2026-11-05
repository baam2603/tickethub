import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, sqlClient } from "../src/database/db";
import { TicketsService } from "../src/tickets/tickets.service";
import { Ed25519Service } from "../src/tickets/crypto/ed25519.service";
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
} from "@tickethub/shared";
import {
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";

describe("TicketsService Gate Check-in Tests", () => {
  let ed25519Service: Ed25519Service;
  let ticketsService: TicketsService;

  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdTicketTypeIds: string[] = [];
  const createdSeatIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdGateIds: string[] = [];

  let testBuyerId = "";
  let testStaffId = "";
  let unassignedStaffId = "";
  let adminUserId = "";
  let testEventId = "";
  let testGateId = "";
  let testTicketId = "";
  let testTicketCode = "";
  let testTicketId2 = "";
  let testTicketCode2 = "";

  before(async () => {
    ed25519Service = new Ed25519Service();
    ticketsService = new TicketsService(ed25519Service);

    const stamp = Date.now();

    // 1. Setup Organizer
    let orgProfile = await db.query.organizerProfiles.findFirst();
    if (!orgProfile) {
      const [u] = await db
        .insert(users)
        .values({
          email: `org_gate_${stamp}@tickethub.vn`,
          fullName: "BTC Gate Test",
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
          organizationName: "BTC Gate Test Co",
          taxCode: "0107777777",
          businessLicenseUrl: "https://cdn.tickethub.vn/license.pdf",
          representativeName: "Giam Doc Gate",
        })
        .returning();
      orgProfile = p;
    }

    // 2. Setup Buyer with phone
    const [buyer] = await db
      .insert(users)
      .values({
        email: `buyer_gate_${stamp}@tickethub.vn`,
        phone: "0901234567",
        fullName: "Nguoi Mua Gate",
        passwordHash: "$argon2id$dummy",
        role: UserRole.BUYER,
        status: UserStatus.ACTIVE,
      })
      .returning();
    testBuyerId = buyer!.id;
    createdUserIds.push(testBuyerId);

    // 3. Setup Assigned Gate Staff
    const [assignedStaff] = await db
      .insert(users)
      .values({
        email: `staff_assigned_${stamp}@tickethub.vn`,
        fullName: "Nhan Vien Soat Ve 1",
        passwordHash: "$argon2id$dummy",
        role: UserRole.GATE_STAFF,
        status: UserStatus.ACTIVE,
      })
      .returning();
    testStaffId = assignedStaff!.id;
    createdUserIds.push(testStaffId);

    // 4. Setup Unassigned Gate Staff
    const [unassignedStaff] = await db
      .insert(users)
      .values({
        email: `staff_unassigned_${stamp}@tickethub.vn`,
        fullName: "Nhan Vien Khong Phan Cong",
        passwordHash: "$argon2id$dummy",
        role: UserRole.GATE_STAFF,
        status: UserStatus.ACTIVE,
      })
      .returning();
    unassignedStaffId = unassignedStaff!.id;
    createdUserIds.push(unassignedStaffId);

    // 5. Setup Admin
    const [admin] = await db
      .insert(users)
      .values({
        email: `admin_gate_${stamp}@tickethub.vn`,
        fullName: "Admin Gate Test",
        passwordHash: "$argon2id$dummy",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      })
      .returning();
    adminUserId = admin!.id;
    createdUserIds.push(adminUserId);

    // 6. Setup Event
    const now = new Date();
    const startTime = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const endTime = new Date(startTime.getTime() + 4 * 3600 * 1000);

    const [testEvt] = await db
      .insert(events)
      .values({
        organizerId: orgProfile!.id,
        title: "Live Concert Gate Checkin Test",
        slug: `gate-checkin-evt-${randomUUID().slice(0, 8)}`,
        description: "Su kien thu nghiem soat ve UC08",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner.webp",
        venueName: "San Van Dong Quan Khu 7",
        venueAddress: "202 Hoang Van Thu",
        city: "TP. Ho Chi Minh",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED,
        isWaitingRoomEnabled: false,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    testEventId = testEvt!.id;
    createdEventIds.push(testEventId);

    // 7. Setup Gate
    const [gateRow] = await db
      .insert(gates)
      .values({
        eventId: testEventId,
        name: "Cong A - VIP",
        locationDesc: "Cua so 1, Tang tret",
      })
      .returning();
    testGateId = gateRow!.id;
    createdGateIds.push(testGateId);

    // 8. Assign Staff to Event
    await db.insert(eventStaff).values({
      eventId: testEventId,
      userId: testStaffId,
      gateId: testGateId,
      staffRole: "SCANNER",
    });

    // 9. Setup TicketType & Seat
    const [tt] = await db
      .insert(ticketTypes)
      .values({
        eventId: testEventId,
        name: "Hang VIP A",
        price: "2000000.00",
        capacity: 10,
        isSeated: true,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    createdTicketTypeIds.push(tt!.id);

    const [seatRow] = await db
      .insert(seats)
      .values({
        eventId: testEventId,
        ticketTypeId: tt!.id,
        zoneName: "Khu VIP",
        rowLabel: "A",
        seatNumber: `G-${randomUUID().slice(0, 5)}`,
        status: SeatStatus.SOLD,
      })
      .returning();
    createdSeatIds.push(seatRow!.id);

    // 10. Setup Order & Ticket
    const [order] = await db
      .insert(orders)
      .values({
        orderCode: `ORD-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        userId: testBuyerId,
        eventId: testEventId,
        totalAmount: "2000000.00",
        discountAmount: "0.00",
        finalAmount: "2000000.00",
        status: OrderStatus.PAID,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      })
      .returning();
    createdOrderIds.push(order!.id);

    testTicketCode = `TK-GATE-${randomUUID().slice(0, 8)}`;
    const [tkt] = await db
      .insert(tickets)
      .values({
        orderId: order!.id,
        userId: testBuyerId,
        eventId: testEventId,
        ticketTypeId: tt!.id,
        seatId: seatRow!.id,
        ticketCode: testTicketCode,
        status: TicketStatus.SOLD,
      })
      .returning();
    testTicketId = tkt!.id;

    testTicketCode2 = `TK-GATE2-${randomUUID().slice(0, 8)}`;
    const [tkt2] = await db
      .insert(tickets)
      .values({
        orderId: order!.id,
        userId: testBuyerId,
        eventId: testEventId,
        ticketTypeId: tt!.id,
        seatId: null, // GA ticket
        ticketCode: testTicketCode2,
        status: TicketStatus.SOLD,
      })
      .returning();
    testTicketId2 = tkt2!.id;
  });

  after(async () => {
    if (createdOrderIds.length > 0) {
      await db
        .delete(auditLog)
        .where(inArray(auditLog.targetId, [testTicketId, testTicketId2]));
      await db.delete(tickets).where(inArray(tickets.orderId, createdOrderIds));
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

  it("allows buyer to get QR token and rejects another buyer (IDOR)", async () => {
    const qrRes = await ticketsService.getTicketQr(
      testBuyerId,
      UserRole.BUYER,
      testTicketId,
    );
    assert.ok(qrRes.qrToken);
    assert.equal(qrRes.remainingSeconds, 30);
    assert.equal(qrRes.ticketId, testTicketId);

    // Buyer khác bị từ chối
    const otherBuyerId = randomUUID();
    await assert.rejects(
      async () =>
        ticketsService.getTicketQr(otherBuyerId, UserRole.BUYER, testTicketId),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        assert.match((err as Error).message, /ACCESS_DENIED/);
        return true;
      },
    );
  });

  it("rejects check-in if staff is not assigned to the event", async () => {
    const qrRes = await ticketsService.getTicketQr(
      testBuyerId,
      UserRole.BUYER,
      testTicketId,
    );

    await assert.rejects(
      async () =>
        ticketsService.scanTicket(unassignedStaffId, UserRole.GATE_STAFF, {
          qrToken: qrRes.qrToken,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        assert.match((err as Error).message, /STAFF_NOT_ASSIGNED_TO_EVENT/);
        return true;
      },
    );
  });

  it("successfully checks in ticket on first scan and rejects duplicate scan with 409", async () => {
    const qrRes = await ticketsService.getTicketQr(
      testBuyerId,
      UserRole.BUYER,
      testTicketId,
    );

    // Quét lần 1 thành công
    const scanRes = await ticketsService.scanTicket(
      testStaffId,
      UserRole.GATE_STAFF,
      {
        qrToken: qrRes.qrToken,
        gateId: testGateId,
      },
    );

    assert.equal(scanRes.status, TicketStatus.CHECKED_IN);
    assert.equal(scanRes.ticketId, testTicketId);
    assert.equal(scanRes.ticketCode, testTicketCode);
    assert.ok(scanRes.checkedInAt);
    assert.equal(scanRes.gateId, testGateId);
    assert.equal(scanRes.staffId, testStaffId);

    // Kiểm tra trong DB
    const dbTicket = await db.query.tickets.findFirst({
      where: eq(tickets.id, testTicketId),
    });
    assert.equal(dbTicket?.status, TicketStatus.CHECKED_IN);
    assert.equal(dbTicket?.checkedInBy, testStaffId);

    // Quét lần 2 bị từ chối với 409 Conflict
    await assert.rejects(
      async () =>
        ticketsService.scanTicket(testStaffId, UserRole.GATE_STAFF, {
          qrToken: qrRes.qrToken,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        assert.match((err as Error).message, /TICKET_ALREADY_USED/);
        return true;
      },
    );
  });

  it("handles manual lookup fallback with 4-digit check and audit log", async () => {
    // 1. Nhập sai 4 số cuối SĐT (SĐT là 0901234567, nhập 9999) -> thất bại 400
    await assert.rejects(
      async () =>
        ticketsService.lookupTicket(testStaffId, UserRole.GATE_STAFF, {
          eventId: testEventId,
          ticketCode: testTicketCode2,
          phoneOrEmailLast4: "9999",
          reason: "Khach het pin",
        }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match((err as Error).message, /VERIFICATION_FAILED/);
        return true;
      },
    );

    // 2. Nhập đúng 4 số cuối SĐT ("4567") -> Thành công
    const lookupRes = await ticketsService.lookupTicket(
      testStaffId,
      UserRole.GATE_STAFF,
      {
        eventId: testEventId,
        ticketCode: testTicketCode2,
        phoneOrEmailLast4: "4567",
        reason: "Khach het pin dien thoai",
        gateId: testGateId,
      },
    );

    assert.equal(lookupRes.status, TicketStatus.CHECKED_IN);
    assert.equal(lookupRes.ticketId, testTicketId2);
    assert.equal(lookupRes.method, "MANUAL_LOOKUP");

    // 3. Kiểm tra nhật ký kiểm toán trong audit_log
    const [log] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, testTicketId2))
      .limit(1);

    assert.ok(log);
    assert.equal(log.action, "MANUAL_TICKET_CHECK_IN");
    assert.equal(log.actorId, testStaffId);
    assert.equal(log.actorRole, UserRole.GATE_STAFF);

    // 4. Tra cứu lại vé đã check-in -> 409 TICKET_ALREADY_USED
    await assert.rejects(
      async () =>
        ticketsService.lookupTicket(testStaffId, UserRole.GATE_STAFF, {
          eventId: testEventId,
          ticketCode: testTicketCode2,
          phoneOrEmailLast4: "4567",
          reason: "Tra cuu lai",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        assert.match((err as Error).message, /TICKET_ALREADY_USED/);
        return true;
      },
    );
  });
});
