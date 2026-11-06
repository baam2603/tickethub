import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/database/db";
import {
  users,
  ticketTypes,
  seats,
  orders,
  tickets,
  refunds,
  outbox,
} from "../src/database/schema";
import {
  OrderStatus,
  TicketStatus,
  SeatStatus,
  UserRole,
} from "@tickethub/shared";
import { RefundsService } from "../src/refunds/refunds.service";

describe("RefundsService Integration Tests", () => {
  const service = new RefundsService();

  it("fails preview if ticket does not belong to user (IDOR prevention)", async () => {
    // 1. Setup user A, user B, event, ticket, order
    const [userA] = await db.select().from(users).limit(1);
    const [userB] = await db.select().from(users).offset(1).limit(1);
    if (!userA || !userB) throw new Error("Need 2 users in db");

    const [tt] = await db.select().from(ticketTypes).limit(1);
    if (!tt) throw new Error("Need at least 1 ticket type in db");
    const eventId = tt.eventId;
    const orderId = randomUUID();

    await db.insert(orders).values({
      id: orderId,
      orderCode: "TEST" + randomUUID().replace(/-/g, "").slice(0, 16),
      userId: userA.id,
      eventId,
      totalAmount: "2500000",
      finalAmount: "2500000",
      status: OrderStatus.PAID,
      expiresAt: new Date(Date.now() + 300000),
    });

    const ticketId = randomUUID();

    await db.insert(tickets).values({
      id: ticketId,
      ticketCode: "TKTEST" + randomUUID().replace(/-/g, "").slice(0, 16),
      orderId,
      userId: userA.id,
      eventId,
      ticketTypeId: tt.id,
      status: TicketStatus.SOLD,
    });

    // User B tries to preview User A's order/ticket
    await assert.rejects(
      async () => {
        await service.previewRefund(userB.id, UserRole.BUYER, {
          orderId,
          ticketIds: [ticketId],
        });
      },
      (err: unknown) => {
        assert.equal((err as { status?: number }).status, 403);
        return true;
      },
    );

    // Clean up
    await db.delete(tickets).where(eq(tickets.id, ticketId));
    await db.delete(orders).where(eq(orders.id, orderId));
  });

  it("successfully previews and executes partial refund, freeing the seat", async () => {
    const [user] = await db.select().from(users).limit(1);
    if (!user) throw new Error("Need at least 1 user in db");
    const [tt] = await db.select().from(ticketTypes).limit(1);
    if (!tt) throw new Error("Need at least 1 ticket type in db");
    const eventId = tt.eventId;

    // Create 2 seats
    const seat1Id = randomUUID();
    const seat2Id = randomUUID();
    const sNum1 = `S${randomUUID().slice(0, 6)}`;
    const sNum2 = `S${randomUUID().slice(0, 6)}`;
    const orderId = randomUUID();
    const ticket1Id = randomUUID();
    const ticket2Id = randomUUID();

    try {
      await db.insert(seats).values([
        {
          id: seat1Id,
          eventId,
          ticketTypeId: tt.id,
          zoneName: "Khu VIP A",
          rowLabel: "T",
          seatNumber: sNum1,
          status: SeatStatus.SOLD,
        },
        {
          id: seat2Id,
          eventId,
          ticketTypeId: tt.id,
          zoneName: "Khu VIP A",
          rowLabel: "T",
          seatNumber: sNum2,
          status: SeatStatus.SOLD,
        },
      ]);

      await db.insert(orders).values({
        id: orderId,
        orderCode: "TEST" + randomUUID().replace(/-/g, "").slice(0, 16),
        userId: user.id,
        eventId,
        totalAmount: "5000000",
        discountAmount: "500000",
        finalAmount: "4500000",
        status: OrderStatus.PAID,
        expiresAt: new Date(Date.now() + 300000),
      });

      await db.insert(tickets).values([
        {
          id: ticket1Id,
          ticketCode: "TKTEST" + randomUUID().replace(/-/g, "").slice(0, 16),
          orderId,
          userId: user.id,
          eventId,
          ticketTypeId: tt.id,
          seatId: seat1Id,
          status: TicketStatus.SOLD,
        },
        {
          id: ticket2Id,
          ticketCode: "TKTEST" + randomUUID().replace(/-/g, "").slice(0, 16),
          orderId,
          userId: user.id,
          eventId,
          ticketTypeId: tt.id,
          seatId: seat2Id,
          status: TicketStatus.SOLD,
        },
      ]);

      // 1. Preview 1 ticket
      const preview = await service.previewRefund(user.id, UserRole.BUYER, {
        orderId,
        ticketIds: [ticket1Id],
      });

      assert.equal(preview.items.length, 1);
      assert.equal(preview.items[0].effectivePaidPrice, 2250000);
      assert.equal(preview.totalRefundAmount, 2250000);

      // 2. Execute refund for ticket 1
      const idempotencyKey = randomUUID();
      const res = await service.executeRefund(
        user.id,
        UserRole.BUYER,
        {
          orderId,
          ticketIds: [ticket1Id],
          reason: "Test refund reason",
        },
        idempotencyKey,
      );

      assert.equal(res.cancelledTicketCount, 1);
      assert.equal(res.refundAmount, 2250000);
      assert.equal(res.orderStatus, OrderStatus.PAID);

      // Check seat 1 was freed
      const [updatedSeat1] = await db
        .select()
        .from(seats)
        .where(eq(seats.id, seat1Id));
      assert.equal(updatedSeat1.status, SeatStatus.AVAILABLE);

      // Check ticket 1 is CANCELLED
      const [updatedTicket1] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticket1Id));
      assert.equal(updatedTicket1.status, TicketStatus.CANCELLED);

      // Check ticket 2 is still SOLD
      const [updatedTicket2] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticket2Id));
      assert.equal(updatedTicket2.status, TicketStatus.SOLD);

      // Check outbox has REFUND_REQUESTED
      const outboxEvents = await db
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, "REFUND_REQUESTED"));
      const matchingEvent = outboxEvents.find(
        (e) => (e.payload as { orderId?: string })?.orderId === orderId,
      );
      assert.ok(matchingEvent);
      assert.equal(
        (matchingEvent?.payload as { isPartial?: boolean })?.isPartial,
        true,
      );
    } finally {
      // Clean up
      await db.delete(outbox).where(eq(outbox.eventType, "REFUND_REQUESTED"));
      await db.delete(refunds).where(eq(refunds.orderId, orderId));
      await db
        .delete(tickets)
        .where(inArray(tickets.id, [ticket1Id, ticket2Id]));
      await db.delete(orders).where(eq(orders.id, orderId));
      await db.delete(seats).where(inArray(seats.id, [seat1Id, seat2Id]));
    }
  });
});
