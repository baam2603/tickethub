import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { Reflector } from "@nestjs/core";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { db } from "../src/database/db";
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
} from "../src/database/schema";
import {
  UserRole,
  UserStatus,
  EventStatus,
  OrderStatus,
  SeatStatus,
  TicketStatus,
  RefundPolicyType,
} from "@tickethub/shared";

import { BuyerOrderService } from "../src/booking/buyer-order.service";
import { BuyerOrderController } from "../src/booking/buyer-order.controller";
import { TicketsService } from "../src/tickets/tickets.service";
import { TicketsController } from "../src/tickets/tickets.controller";
import { Ed25519Service } from "../src/tickets/crypto/ed25519.service";
import { RolesGuard } from "../src/auth/guards/roles.guard";

describe("Buyer Orders & Personal Tickets E2E Integration Suite", () => {
  let buyerOrderService: BuyerOrderService;
  let buyerOrderController: BuyerOrderController;
  let ticketsService: TicketsService;
  let ticketsController: TicketsController;
  let ed25519Service: Ed25519Service;
  let rolesGuard: RolesGuard;

  // Track entities for clean teardown
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdTicketTypeIds: string[] = [];
  const createdSeatIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdTicketIds: string[] = [];
  const createdRefundIds: string[] = [];

  let organizerUserId = "";
  let buyer1Id = "";
  let buyer2Id = "";
  let adminUserId = "";
  let staffUserId = "";

  let seatedEventId = "";
  let standingEventId = "";
  let seatedTicketTypeId = "";
  let standingTicketTypeId = "";
  let seat1Id = "";

  let order1PaidId = "";
  let order2PendingId = "";
  let order3PaidId = "";
  let order4CancelledTicketId = "";

  let ticket1Id = "";
  let ticket3Id = "";
  let cancelledTicketId = "";

  before(async () => {
    buyerOrderService = new BuyerOrderService();
    buyerOrderController = new BuyerOrderController(buyerOrderService);
    ed25519Service = new Ed25519Service();
    ticketsService = new TicketsService(ed25519Service);
    ticketsController = new TicketsController(ticketsService);
    rolesGuard = new RolesGuard(new Reflector());

    // 1. Create Users
    organizerUserId = randomUUID();
    buyer1Id = randomUUID();
    buyer2Id = randomUUID();
    adminUserId = randomUUID();
    staffUserId = randomUUID();
    createdUserIds.push(
      organizerUserId,
      buyer1Id,
      buyer2Id,
      adminUserId,
      staffUserId,
    );

    await db.insert(users).values([
      {
        id: organizerUserId,
        email: `org-${Date.now()}@tickethub.test`,
        passwordHash: "$argon2id$dummy",
        fullName: "Ban To Chuc E2E",
        role: UserRole.ORGANIZER,
        status: UserStatus.ACTIVE,
      },
      {
        id: buyer1Id,
        email: `buyer1-${Date.now()}@tickethub.test`,
        passwordHash: "$argon2id$dummy",
        fullName: "Nguyen Van A",
        role: UserRole.BUYER,
        status: UserStatus.ACTIVE,
      },
      {
        id: buyer2Id,
        email: `buyer2-${Date.now()}@tickethub.test`,
        passwordHash: "$argon2id$dummy",
        fullName: "Tran Thi B",
        role: UserRole.BUYER,
        status: UserStatus.ACTIVE,
      },
      {
        id: adminUserId,
        email: `admin-${Date.now()}@tickethub.test`,
        passwordHash: "$argon2id$dummy",
        fullName: "Admin Tong",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
      {
        id: staffUserId,
        email: `staff-${Date.now()}@tickethub.test`,
        passwordHash: "$argon2id$dummy",
        fullName: "Soat Ve Gate",
        role: UserRole.GATE_STAFF,
        status: UserStatus.ACTIVE,
      },
    ]);

    const [orgProfile] = await db
      .insert(organizerProfiles)
      .values({
        id: randomUUID(),
        userId: organizerUserId,
        organizationName: "Cong Ty Su Kien Test",
        taxCode: "0101234567",
        businessLicenseUrl: "https://minio.tickethub.test/license.pdf",
        representativeName: "Nguyen Dai Dien",
      })
      .returning();

    // 2. Create Events (Seated Event starts earlier, GA Event starts later)
    seatedEventId = randomUUID();
    standingEventId = randomUUID();
    createdEventIds.push(seatedEventId, standingEventId);

    const now = new Date();
    const startTime1 = new Date(now.getTime() + 7 * 24 * 3600 * 1000); // +7 days
    const endTime1 = new Date(startTime1.getTime() + 3 * 3600 * 1000);
    const startTime2 = new Date(now.getTime() + 14 * 24 * 3600 * 1000); // +14 days
    const endTime2 = new Date(startTime2.getTime() + 3 * 3600 * 1000);

    await db.insert(events).values([
      {
        id: seatedEventId,
        organizerId: orgProfile!.id,
        title: "Live Concert Anh Trai Say Hi",
        slug: `concert-anh-trai-say-hi-${Date.now()}`,
        description: "Dai nhac hoi anh trai",
        category: "CONCERT",
        bannerUrl: "https://minio.tickethub.test/banner1.jpg",
        venueName: "San Van Dong My Dinh",
        venueAddress: "1 Le Duc Tho, Nam Tu Liem",
        city: "Ha Noi",
        startTime: startTime1,
        endTime: endTime1,
        gateOpeningTime: new Date(startTime1.getTime() - 2 * 3600 * 1000),
        status: EventStatus.PUBLISHED,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      },
      {
        id: standingEventId,
        organizerId: orgProfile!.id,
        title: "EDM Festival Ravolution",
        slug: `edm-ravolution-${Date.now()}`,
        description: "Le hoi am nhac dien tu",
        category: "FESTIVAL",
        bannerUrl: "https://minio.tickethub.test/banner2.jpg",
        venueName: "Pho Di Bo Nguyen Hue",
        venueAddress: "Nguyen Hue, Quan 1",
        city: "TP Ho Chi Minh",
        startTime: startTime2,
        endTime: endTime2,
        gateOpeningTime: new Date(startTime2.getTime() - 2 * 3600 * 1000),
        status: EventStatus.PUBLISHED,
        refundPolicyType: RefundPolicyType.NO_REFUND,
      },
    ]);

    // 3. Create Ticket Types
    seatedTicketTypeId = randomUUID();
    standingTicketTypeId = randomUUID();
    createdTicketTypeIds.push(seatedTicketTypeId, standingTicketTypeId);

    await db.insert(ticketTypes).values([
      {
        id: seatedTicketTypeId,
        eventId: seatedEventId,
        name: "VIP",
        description: "Hang ghe VIP",
        price: "1000000",
        capacity: 100,
        soldCount: 2,
        isSeated: true,
        saleStartTime: new Date(now.getTime() - 24 * 3600 * 1000),
        saleEndTime: startTime1,
      },
      {
        id: standingTicketTypeId,
        eventId: standingEventId,
        name: "GA - Fanzone",
        description: "Khu dung Fanzone",
        price: "500000",
        capacity: 500,
        soldCount: 0,
        isSeated: false,
        saleStartTime: new Date(now.getTime() - 24 * 3600 * 1000),
        saleEndTime: startTime2,
      },
    ]);

    // 4. Create Seat for Seated TicketType
    seat1Id = randomUUID();
    createdSeatIds.push(seat1Id);
    await db.insert(seats).values({
      id: seat1Id,
      eventId: seatedEventId,
      ticketTypeId: seatedTicketTypeId,
      zoneName: "VIP",
      rowLabel: "A",
      seatNumber: "01",
      status: SeatStatus.BOOKED,
    });

    // 5. Seed Orders:
    // Order 1: Buyer 1, PAID, Seated Ticket + Voucher (1,000,000 -> 800,000)
    order1PaidId = randomUUID();
    // Order 2: Buyer 1, PENDING, GA Ticket (500,000 x 2 = 1,000,000). No tickets created yet!
    order2PendingId = randomUUID();
    // Order 3: Buyer 2, PAID, Seated Ticket (1,000,000)
    order3PaidId = randomUUID();
    // Order 4: Buyer 1, CANCELLED Ticket Order (for my-tickets status filter check)
    order4CancelledTicketId = randomUUID();

    createdOrderIds.push(
      order1PaidId,
      order2PendingId,
      order3PaidId,
      order4CancelledTicketId,
    );

    await db.insert(orders).values([
      {
        id: order1PaidId,
        orderCode: `ORD-B1-PAID-${Date.now()}`,
        userId: buyer1Id,
        eventId: seatedEventId,
        totalAmount: "1000000",
        discountAmount: "200000",
        finalAmount: "800000",
        voucherCode: "DISCOUNT20",
        status: OrderStatus.PAID,
        expiresAt: new Date(now.getTime() + 300 * 1000),
        paidAt: now,
      },
      {
        id: order2PendingId,
        orderCode: `ORD-B1-PENDING-${Date.now()}`,
        userId: buyer1Id,
        eventId: standingEventId,
        totalAmount: "1000000",
        discountAmount: "0",
        finalAmount: "1000000",
        status: OrderStatus.PENDING,
        expiresAt: new Date(now.getTime() + 300 * 1000),
      },
      {
        id: order3PaidId,
        orderCode: `ORD-B2-PAID-${Date.now()}`,
        userId: buyer2Id,
        eventId: seatedEventId,
        totalAmount: "1000000",
        discountAmount: "0",
        finalAmount: "1000000",
        status: OrderStatus.PAID,
        expiresAt: new Date(now.getTime() + 300 * 1000),
        paidAt: now,
      },
      {
        id: order4CancelledTicketId,
        orderCode: `ORD-B1-REFUND-${Date.now()}`,
        userId: buyer1Id,
        eventId: seatedEventId,
        totalAmount: "1000000",
        discountAmount: "0",
        finalAmount: "1000000",
        status: OrderStatus.REFUNDED,
        expiresAt: new Date(now.getTime() + 300 * 1000),
        paidAt: now,
      },
    ]);

    // Order Items
    await db.insert(orderItems).values([
      {
        id: randomUUID(),
        orderId: order1PaidId,
        ticketTypeId: seatedTicketTypeId,
        seatId: seat1Id,
        quantity: 1,
        unitPrice: "1000000",
        subtotal: "1000000",
      },
      {
        id: randomUUID(),
        orderId: order2PendingId,
        ticketTypeId: standingTicketTypeId,
        seatId: null,
        quantity: 2,
        unitPrice: "500000",
        subtotal: "1000000",
      },
      {
        id: randomUUID(),
        orderId: order3PaidId,
        ticketTypeId: seatedTicketTypeId,
        seatId: null,
        quantity: 1,
        unitPrice: "1000000",
        subtotal: "1000000",
      },
      {
        id: randomUUID(),
        orderId: order4CancelledTicketId,
        ticketTypeId: seatedTicketTypeId,
        seatId: null,
        quantity: 1,
        unitPrice: "1000000",
        subtotal: "1000000",
      },
    ]);

    // 6. Tickets
    ticket1Id = randomUUID();
    ticket3Id = randomUUID();
    cancelledTicketId = randomUUID();
    createdTicketIds.push(ticket1Id, ticket3Id, cancelledTicketId);

    await db.insert(tickets).values([
      {
        id: ticket1Id,
        ticketCode: `TCK-1-${Date.now()}`,
        orderId: order1PaidId,
        userId: buyer1Id,
        eventId: seatedEventId,
        ticketTypeId: seatedTicketTypeId,
        seatId: seat1Id,
        status: TicketStatus.SOLD,
      },
      {
        id: ticket3Id,
        ticketCode: `TCK-3-${Date.now()}`,
        orderId: order3PaidId,
        userId: buyer2Id,
        eventId: seatedEventId,
        ticketTypeId: seatedTicketTypeId,
        seatId: null,
        status: TicketStatus.SOLD,
      },
      {
        id: cancelledTicketId,
        ticketCode: `TCK-CANCEL-${Date.now()}`,
        orderId: order4CancelledTicketId,
        userId: buyer1Id,
        eventId: seatedEventId,
        ticketTypeId: seatedTicketTypeId,
        seatId: null,
        status: TicketStatus.CANCELLED,
      },
    ]);

    // Refund Record for Order 4
    const refundRecordId = randomUUID();
    createdRefundIds.push(refundRecordId);
    await db.insert(refunds).values({
      id: refundRecordId,
      orderId: order4CancelledTicketId,
      ticketId: cancelledTicketId,
      amount: "1000000",
      reason: "Huy ve theo yeu cau nguoi mua",
      status: "COMPLETED",
      idempotencyKey: randomUUID(),
    });
  });

  after(async () => {
    try {
      if (createdRefundIds.length > 0) {
        await db.delete(refunds).where(inArray(refunds.id, createdRefundIds));
      }
      if (createdTicketIds.length > 0) {
        await db.delete(tickets).where(inArray(tickets.id, createdTicketIds));
      }
      if (createdOrderIds.length > 0) {
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
        await db
          .delete(organizerProfiles)
          .where(inArray(organizerProfiles.userId, createdUserIds));
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
    } catch (err) {
      console.error("TEARDOWN ERROR in buyer-orders-tickets suite:", err);
    }
  });

  function createMockContext(
    user: { id: string; role: UserRole },
    handler: (...args: unknown[]) => unknown,
  ): ExecutionContext {
    const req = {
      user: {
        userId: user.id,
        role: user.role,
        email: "test@test.vn",
      },
    } as unknown as FastifyRequest;

    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
      getHandler: () => handler,
      getClass: () => ({}),
      getArgs: () => [],
      getArgByIndex: () => ({}),
      getType: () => "http",
    } as unknown as ExecutionContext;
  }

  it("Scenario 1: Buyer queries order history (GET /api/v1/buyer/orders) with filtering, pagination and ticketCount", async () => {
    // 1. Buyer 1 queries orders: should see Order 1 (PAID), Order 2 (PENDING), Order 4 (REFUNDED)
    const resultBuyer1 = await buyerOrderService.listBuyerOrders(buyer1Id, {
      page: 1,
      limit: 10,
    });
    assert.equal(resultBuyer1.meta.total, 3);
    assert.equal(resultBuyer1.items.length, 3);

    // Verify Buyer 1 cannot see Buyer 2's order
    const orderIds = resultBuyer1.items.map((i) => i.id);
    assert.ok(orderIds.includes(order1PaidId));
    assert.ok(orderIds.includes(order2PendingId));
    assert.ok(orderIds.includes(order4CancelledTicketId));
    assert.ok(!orderIds.includes(order3PaidId));

    // Verify ticketCount: Order 2 (PENDING) booked 2 tickets via order_items.quantity
    const pendingOrderSummary = resultBuyer1.items.find(
      (i) => i.id === order2PendingId,
    );
    assert.ok(pendingOrderSummary);
    assert.equal(pendingOrderSummary.ticketCount, 2);
    assert.equal(pendingOrderSummary.status, OrderStatus.PENDING);

    // 2. Filter by status: status=PAID
    const filteredPaid = await buyerOrderService.listBuyerOrders(buyer1Id, {
      page: 1,
      limit: 10,
      status: OrderStatus.PAID,
    });
    assert.equal(filteredPaid.meta.total, 1);
    assert.equal(filteredPaid.items.length, 1);
    assert.equal(filteredPaid.items[0]!.id, order1PaidId);

    // 3. Pagination check: page=1, limit=1
    const paginated = await buyerOrderService.listBuyerOrders(buyer1Id, {
      page: 1,
      limit: 1,
    });
    assert.equal(paginated.meta.total, 3);
    assert.equal(paginated.meta.totalPages, 3);
    assert.equal(paginated.items.length, 1);
  });

  it("Scenario 2: Deep Order Details (GET /api/v1/buyer/orders/:id) formatting and Review Focus 1 (unpaid order tickets: [])", async () => {
    // 1. Order 1 (PAID with voucher 20%): total=1,000,000, final=800,000
    const detailPaid = await buyerOrderService.getBuyerOrderDetail(
      buyer1Id,
      UserRole.BUYER,
      order1PaidId,
    );
    assert.equal(detailPaid.id, order1PaidId);
    assert.equal(detailPaid.status, OrderStatus.PAID);
    assert.equal(detailPaid.totalAmount, 1000000);
    assert.equal(detailPaid.discountAmount, 200000);
    assert.equal(detailPaid.finalAmount, 800000);
    assert.equal(detailPaid.voucherCode, "DISCOUNT20");
    assert.equal(detailPaid.event.id, seatedEventId);
    assert.equal(detailPaid.items.length, 1);
    assert.equal(detailPaid.tickets.length, 1);

    const ticketDetail = detailPaid.tickets[0]!;
    assert.equal(ticketDetail.id, ticket1Id);
    assert.equal(ticketDetail.price, 1000000);
    // Review Focus 2: Pro-rata effectivePaidPrice = 800,000
    assert.equal(ticketDetail.effectivePaidPrice, 800000);
    assert.equal(ticketDetail.isSeated, true);
    assert.equal(ticketDetail.seatInfo.zoneName, "VIP");
    assert.equal(ticketDetail.seatInfo.rowLabel, "A");
    assert.equal(ticketDetail.seatInfo.seatNumber, "01");
    assert.equal(
      ticketDetail.seatInfo.formattedLabel,
      "Khu VIP - Hàng A - Ghế 01",
    );

    // 2. Order 2 (PENDING unpaid order) -> Review Focus 1: tickets must be []
    const detailPending = await buyerOrderService.getBuyerOrderDetail(
      buyer1Id,
      UserRole.BUYER,
      order2PendingId,
    );
    assert.equal(detailPending.id, order2PendingId);
    assert.equal(detailPending.status, OrderStatus.PENDING);
    assert.deepEqual(detailPending.tickets, []);
    assert.equal(detailPending.items.length, 1);
    assert.equal(detailPending.items[0]!.ticketTypeName, "GA - Fanzone");
    assert.equal(detailPending.items[0]!.quantity, 2);

    // 3. Order 4 (REFUNDED order): has 1 ticket and 1 refund record
    const detailRefunded = await buyerOrderService.getBuyerOrderDetail(
      buyer1Id,
      UserRole.BUYER,
      order4CancelledTicketId,
    );
    assert.equal(detailRefunded.status, OrderStatus.REFUNDED);
    assert.equal(detailRefunded.refunds.length, 1);
    assert.equal(detailRefunded.refunds[0]!.amount, 1000000);
  });

  it("Scenario 3: Anti-IDOR Enforcement & Access Control (Review Focus 4)", async () => {
    // 1. Buyer 2 attempts to access Buyer 1's Order 1 -> 403 ForbiddenException ACCESS_DENIED
    await assert.rejects(
      async () =>
        buyerOrderService.getBuyerOrderDetail(
          buyer2Id,
          UserRole.BUYER,
          order1PaidId,
        ),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        const resp = (err as ForbiddenException).getResponse() as {
          error?: { code?: string };
        };
        assert.equal(resp.error?.code, "ACCESS_DENIED");
        return true;
      },
    );

    // 2. Admin accesses Buyer 1's Order 1 -> Allowed (200 OK)
    const adminView = await buyerOrderService.getBuyerOrderDetail(
      adminUserId,
      UserRole.ADMIN,
      order1PaidId,
    );
    assert.equal(adminView.id, order1PaidId);

    // 3. Nonexistent order -> 404 NotFoundException ORDER_NOT_FOUND
    const fakeOrderId = randomUUID();
    await assert.rejects(
      async () =>
        buyerOrderService.getBuyerOrderDetail(
          buyer1Id,
          UserRole.BUYER,
          fakeOrderId,
        ),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundException);
        const resp = (err as NotFoundException).getResponse() as {
          error?: { code?: string };
        };
        assert.equal(resp.error?.code, "ORDER_NOT_FOUND");
        return true;
      },
    );
  });

  it("Scenario 4: Personal Tickets Wallet (GET /api/v1/tickets/my-tickets) with default filtering and sorting (Review Focus 3 & 5)", async () => {
    // 1. Buyer 1 queries my-tickets without status param:
    // Review Focus 5: Defaults to status IN ('SOLD', 'CHECKED_IN').
    // The CANCELLED ticket (Order 4) must NOT be returned!
    const myTicketsBuyer1 = await ticketsService.getMyTickets(buyer1Id, {
      page: 1,
      limit: 20,
    });
    assert.equal(myTicketsBuyer1.meta.total, 1);
    assert.equal(myTicketsBuyer1.items.length, 1);
    assert.equal(myTicketsBuyer1.items[0]!.id, ticket1Id);
    assert.equal(myTicketsBuyer1.items[0]!.status, TicketStatus.SOLD);

    // 2. Buyer 1 explicitly filters status=CANCELLED -> returns the cancelled ticket
    const myCancelled = await ticketsService.getMyTickets(buyer1Id, {
      page: 1,
      limit: 20,
      status: TicketStatus.CANCELLED,
    });
    assert.equal(myCancelled.meta.total, 1);
    assert.equal(myCancelled.items[0]!.id, cancelledTicketId);
    assert.equal(myCancelled.items[0]!.status, TicketStatus.CANCELLED);

    // 3. Buyer 2 queries my-tickets: only sees ticket 3
    const myTicketsBuyer2 = await ticketsService.getMyTickets(buyer2Id, {
      page: 1,
      limit: 20,
    });
    assert.equal(myTicketsBuyer2.meta.total, 1);
    assert.equal(myTicketsBuyer2.items[0]!.id, ticket3Id);

    // 4. Standing GA ticket check (Review Focus 3):
    // Insert a valid GA ticket for buyer 1 to verify formatting
    const gaTicketId = randomUUID();
    createdTicketIds.push(gaTicketId);
    await db.insert(tickets).values({
      id: gaTicketId,
      ticketCode: `TCK-GA-${Date.now()}`,
      orderId: order1PaidId,
      userId: buyer1Id,
      eventId: standingEventId,
      ticketTypeId: standingTicketTypeId,
      seatId: null,
      status: TicketStatus.SOLD,
    });

    const refreshedWallet = await ticketsService.getMyTickets(buyer1Id, {
      page: 1,
      limit: 20,
    });
    assert.equal(refreshedWallet.meta.total, 2);

    const gaTicket = refreshedWallet.items.find((t) => t.id === gaTicketId);
    assert.ok(gaTicket);
    assert.equal(gaTicket.isSeated, false);
    assert.equal(gaTicket.seatInfo.rowLabel, null);
    assert.equal(gaTicket.seatInfo.seatNumber, null);
    assert.equal(gaTicket.seatInfo.zoneName, "GA - Fanzone");
    assert.equal(
      gaTicket.seatInfo.formattedLabel,
      "Khu vực: GA - Fanzone (Vé đứng)",
    );
    assert.ok(!JSON.stringify(gaTicket.seatInfo).includes("N/A"));

    // Sorting check: seatedEvent starts earlier (startTime1 < startTime2)
    assert.equal(refreshedWallet.items[0]!.eventId, seatedEventId);
    assert.equal(refreshedWallet.items[1]!.eventId, standingEventId);
  });

  it("Scenario 5: Controller Validation & RBAC Guard Enforcement", async () => {
    // 1. Controller query validation: page < 1 -> 400 BadRequestException
    await assert.rejects(
      async () =>
        buyerOrderController.listOrders(
          { userId: buyer1Id, role: UserRole.BUYER, email: "b1@test.vn" },
          { page: "0" },
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      },
    );

    // 2. Controller query validation: limit > 50 -> 400 BadRequestException
    await assert.rejects(
      async () =>
        buyerOrderController.listOrders(
          { userId: buyer1Id, role: UserRole.BUYER, email: "b1@test.vn" },
          { limit: "999" },
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      },
    );

    // 3. TicketsController validation: invalid eventId UUID -> 400 BadRequestException
    await assert.rejects(
      async () =>
        ticketsController.getMyTickets(
          { userId: buyer1Id, role: UserRole.BUYER, email: "b1@test.vn" },
          { eventId: "not-a-uuid" },
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      },
    );

    // 4. RBAC: GATE_STAFF is rejected on BuyerOrderController endpoints
    assert.throws(
      () =>
        rolesGuard.canActivate(
          createMockContext(
            { id: staffUserId, role: UserRole.GATE_STAFF },
            BuyerOrderController.prototype.listOrders,
          ),
        ),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        return true;
      },
    );

    // 5. RBAC: BUYER and ADMIN are allowed
    assert.equal(
      rolesGuard.canActivate(
        createMockContext(
          { id: buyer1Id, role: UserRole.BUYER },
          BuyerOrderController.prototype.listOrders,
        ),
      ),
      true,
    );
    assert.equal(
      rolesGuard.canActivate(
        createMockContext(
          { id: adminUserId, role: UserRole.ADMIN },
          BuyerOrderController.prototype.listOrders,
        ),
      ),
      true,
    );
  });
});
