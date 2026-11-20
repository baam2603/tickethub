import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  EventStatus,
  OrderStatus,
  OutboxStatus,
  PaymentProvider,
  RefundStatus,
  SeatStatus,
  TransactionStatus,
} from "@tickethub/shared";
import { env } from "../src/config/env.config";
import { db, sqlClient } from "../src/database/db";
import {
  auditLog,
  events,
  orderItems,
  orders,
  outbox,
  refunds,
  seats,
  ticketTypes,
  tickets,
  transactions,
  users,
} from "../src/database/schema";
import { createBookingCommands } from "../src/contexts/booking/booking.composition";
import { createPaymentUseCases } from "../src/contexts/payment/payment.composition";
import { toVnpayAmount } from "../src/contexts/payment/domain/vnpay-amount";
import type { EventReadModel } from "../src/contexts/event/application/event-read-model";

const cacheStub = {
  invalidate: async (_eventId: string): Promise<void> => {},
} as EventReadModel;

const targetDb = decodeURIComponent(
  new URL(env.DATABASE_URL).pathname.slice(1),
);
const expectedTestDb =
  process.env.IPN_TEST_DB_NAME?.trim() || "tickethub_ipn_test";
const isSafeTestDb =
  /^[a-z][a-z0-9_]*_test$/.test(expectedTestDb) && targetDb === expectedTestDb;

const createdOrderIds: string[] = [];
const createdSeatIds: string[] = [];

function ipnFor(transactionRef: string, success = true) {
  const service = createPaymentUseCases(cacheStub).processIpn;
  Object.defineProperty(service, "gateway", {
    value: {
      verifyCallback: () => ({
        verified: true,
        success,
        transactionRef,
        providerTransactionId: "LATEPROVIDER001",
      }),
    },
  });
  return service;
}

async function publishedType(seated: boolean) {
  const [row] = await db
    .select({ tt: ticketTypes, eventStatus: events.status })
    .from(ticketTypes)
    .innerJoin(events, eq(ticketTypes.eventId, events.id))
    .where(
      and(
        eq(ticketTypes.isSeated, seated),
        eq(events.status, EventStatus.PUBLISHED),
      ),
    )
    .limit(1);
  assert.ok(
    row,
    `Test DB needs a ${seated ? "seated" : "GA"} type of a PUBLISHED event`,
  );
  return row.tt;
}

async function createLateOrder(opts: {
  seated: boolean;
  orderStatus?: OrderStatus;
  seatHeldByOther?: boolean;
}) {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  assert.ok(user);
  const tt = await publishedType(opts.seated);

  const orderId = randomUUID();
  const compact = orderId.replace(/-/g, "");
  const transactionRef = "LATE" + compact;
  createdOrderIds.push(orderId);

  await db.insert(orders).values({
    id: orderId,
    orderCode: "LATE" + compact.slice(0, 20),
    userId: user.id,
    eventId: tt.eventId,
    totalAmount: tt.price,
    finalAmount: tt.price,
    status: opts.orderStatus ?? OrderStatus.EXPIRED,
    expiresAt: new Date(Date.now() - 60_000),
  });

  let seatId: string | null = null;
  if (opts.seated) {
    const [seat] = await db
      .insert(seats)
      .values({
        eventId: tt.eventId,
        ticketTypeId: tt.id,
        seatNumber: `L${compact.slice(0, 6)}`,
        rowNumber: 1,
        rowLabel: "Z",
        zoneName: "LATE",
        status: opts.seatHeldByOther ? SeatStatus.SOLD : SeatStatus.AVAILABLE,
        holdOrderId: null,
      })
      .returning();
    seatId = seat!.id;
    createdSeatIds.push(seatId);
  }

  await db.insert(orderItems).values({
    orderId,
    ticketTypeId: tt.id,
    seatId,
    quantity: 1,
    unitPrice: tt.price,
    subtotal: tt.price,
  });
  await db.insert(transactions).values({
    orderId,
    provider: PaymentProvider.VNPAY,
    transactionRef,
    amount: tt.price,
    status: TransactionStatus.PENDING,
    idempotencyKey: `late-test:${orderId}`,
  });

  return {
    orderId,
    transactionRef,
    seatId,
    ticketTypeId: tt.id,
    eventId: tt.eventId,
    amount: toVnpayAmount(tt.price)!,
    price: tt.price,
    userId: user.id,
  };
}

const successCallback = (amount: string) => ({
  vnp_Amount: amount,
  vnp_ResponseCode: "00",
  vnp_TransactionStatus: "00",
});

async function readState(orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  const [transaction] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.orderId, orderId));
  const issued = await db
    .select()
    .from(tickets)
    .where(eq(tickets.orderId, orderId));
  const orderRefunds = await db
    .select()
    .from(refunds)
    .where(eq(refunds.orderId, orderId));
  const events_ = await db
    .select()
    .from(outbox)
    .where(sql`${outbox.payload} ->> 'orderId' = ${orderId}`);
  return { order, transaction, issued, orderRefunds, outboxEvents: events_ };
}

async function inventory(ticketTypeId: string) {
  const [tt] = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.id, ticketTypeId));
  return tt!;
}

if (!isSafeTestDb) {
  test.skip(`Late IPN integration tests skipped: database '${targetDb}' is not '${expectedTestDb}'`, () => {});
} else {
  let originalCapacity: { id: string; capacity: number } | null = null;

  before(async () => {
    const tt = await publishedType(false);
    originalCapacity = { id: tt.id, capacity: tt.capacity };
  });

  after(async () => {
    if (createdSeatIds.length) {
      await db
        .update(seats)
        .set({ status: SeatStatus.AVAILABLE })
        .where(inArray(seats.id, createdSeatIds));
    }
    if (originalCapacity) {
      await db
        .update(ticketTypes)
        .set({ capacity: originalCapacity.capacity })
        .where(eq(ticketTypes.id, originalCapacity.id));
    }
    await sqlClient.end();
  });

  test("Late IPN with no stock left moves the order to refund pending and queues a full refund", async () => {
    const f = await createLateOrder({ seated: false });
    const before_ = await inventory(f.ticketTypeId);
    // Het cho: suc chua bang so ve da ban va dang giu
    await db
      .update(ticketTypes)
      .set({ capacity: before_.soldCount + before_.heldCount })
      .where(eq(ticketTypes.id, f.ticketTypeId));

    const service = ipnFor(f.transactionRef);
    assert.equal(
      await service.process(successCallback(f.amount)),
      "LATE_REFUND_PENDING",
    );

    const state = await readState(f.orderId);
    assert.equal(
      state.order?.status,
      OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
    );
    // Tien da ve tai khoan merchant
    assert.equal(state.transaction?.status, TransactionStatus.SUCCESS);
    assert.equal(state.issued.length, 0);

    assert.equal(state.orderRefunds.length, 1);
    const refund = state.orderRefunds[0]!;
    assert.equal(Number(refund.amount), Number(f.price));
    assert.equal(refund.status, RefundStatus.PENDING);
    assert.equal(refund.ticketId, null);
    assert.equal(refund.reason, "PAYMENT_EXPIRED");

    const requested = state.outboxEvents.filter(
      (e) => e.eventType === "REFUND_REQUESTED",
    );
    assert.equal(requested.length, 1);
    assert.equal(requested[0]?.status, OutboxStatus.PENDING);
    const payload = requested[0]?.payload as Record<string, unknown>;
    assert.deepEqual(payload.refundIds, [refund.id]);
    assert.equal(payload.amount, Number(f.price));
    assert.equal(payload.isPartial, false);
    assert.equal(payload.source, "LATE_IPN");

    const notices = state.outboxEvents.filter(
      (e) => e.eventType === "PAYMENT_EXPIRED_REFUND_NOTICE",
    );
    assert.equal(notices.length, 1);
    assert.equal(
      state.outboxEvents.filter((e) => e.eventType === "ORDER_PAID").length,
      0,
    );

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "VNPAY_IPN_LATE_REFUND_PENDING"),
          eq(auditLog.targetId, state.transaction!.id),
        ),
      );
    assert.equal(audits.length, 1);

    // Ton kho khong doi
    const after_ = await inventory(f.ticketTypeId);
    assert.equal(after_.soldCount, before_.soldCount);
    assert.equal(after_.heldCount, before_.heldCount);

    // IPN lap lai khong tao them hoan tien
    assert.equal(
      await service.process(successCallback(f.amount)),
      "ALREADY_PROCESSED",
    );
    const again = await readState(f.orderId);
    assert.equal(again.orderRefunds.length, 1);
    assert.equal(
      again.outboxEvents.filter((e) => e.eventType === "REFUND_REQUESTED")
        .length,
      1,
    );

    await db
      .update(ticketTypes)
      .set({ capacity: before_.capacity })
      .where(eq(ticketTypes.id, f.ticketTypeId));
  });

  test("Concurrent late IPNs create exactly one refund", async () => {
    const f = await createLateOrder({ seated: false });
    const before_ = await inventory(f.ticketTypeId);
    await db
      .update(ticketTypes)
      .set({ capacity: before_.soldCount + before_.heldCount })
      .where(eq(ticketTypes.id, f.ticketTypeId));

    const service = ipnFor(f.transactionRef);
    const results = await Promise.all([
      service.process(successCallback(f.amount)),
      service.process(successCallback(f.amount)),
      service.process(successCallback(f.amount)),
    ]);
    assert.equal(results.filter((r) => r === "LATE_REFUND_PENDING").length, 1);
    assert.equal(results.filter((r) => r === "ALREADY_PROCESSED").length, 2);

    const state = await readState(f.orderId);
    assert.equal(state.orderRefunds.length, 1);
    assert.equal(
      state.outboxEvents.filter((e) => e.eventType === "REFUND_REQUESTED")
        .length,
      1,
    );

    await db
      .update(ticketTypes)
      .set({ capacity: before_.capacity })
      .where(eq(ticketTypes.id, f.ticketTypeId));
  });

  test("Late IPN for a suspended event is refunded even when stock is free", async () => {
    const f = await createLateOrder({ seated: false });
    await db
      .update(events)
      .set({ status: EventStatus.SUSPENDED })
      .where(eq(events.id, f.eventId));
    try {
      assert.equal(
        await ipnFor(f.transactionRef).process(successCallback(f.amount)),
        "LATE_REFUND_PENDING",
      );
      const state = await readState(f.orderId);
      assert.equal(
        state.order?.status,
        OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
      );
      assert.equal(state.issued.length, 0);
      assert.equal(state.orderRefunds.length, 1);
    } finally {
      await db
        .update(events)
        .set({ status: EventStatus.PUBLISHED })
        .where(eq(events.id, f.eventId));
    }
  });

  test("Late IPN for a cancelled order queues a full refund even when capacity allows", async () => {
    const f = await createLateOrder({
      seated: false,
      orderStatus: OrderStatus.CANCELLED,
    });
    const before_ = await inventory(f.ticketTypeId);
    await db
      .update(ticketTypes)
      .set({ capacity: before_.soldCount + before_.heldCount + 5 })
      .where(eq(ticketTypes.id, f.ticketTypeId));

    assert.equal(
      await ipnFor(f.transactionRef).process(successCallback(f.amount)),
      "LATE_REFUND_PENDING",
    );
    const state = await readState(f.orderId);
    assert.equal(
      state.order?.status,
      OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
    );
    assert.equal(state.transaction?.status, TransactionStatus.SUCCESS);
    assert.equal(state.issued.length, 0);
    assert.equal(state.orderRefunds.length, 1);
    assert.equal(
      state.outboxEvents.filter((e) => e.eventType === "REFUND_REQUESTED")
        .length,
      1,
    );
    assert.equal(Number(state.orderRefunds[0]?.amount), Number(f.amount) / 100);
    const after_ = await inventory(f.ticketTypeId);
    assert.equal(after_.soldCount, before_.soldCount);
    assert.equal(after_.heldCount, before_.heldCount);

    await db
      .update(ticketTypes)
      .set({ capacity: before_.capacity })
      .where(eq(ticketTypes.id, f.ticketTypeId));
  });

  test("Late IPN restores a free seat and sells it", async () => {
    const f = await createLateOrder({ seated: true });
    assert.equal(
      await ipnFor(f.transactionRef).process(successCallback(f.amount)),
      "LATE_RESTORED",
    );
    const state = await readState(f.orderId);
    assert.equal(state.order?.status, OrderStatus.PAID);
    assert.equal(state.issued.length, 1);
    assert.equal(state.issued[0]?.seatId, f.seatId);
    const [seat] = await db.select().from(seats).where(eq(seats.id, f.seatId!));
    assert.equal(seat?.status, SeatStatus.SOLD);
    assert.equal(seat?.holdOrderId, null);
  });

  test("Late IPN refunds when the seat was sold to someone else", async () => {
    const f = await createLateOrder({ seated: true, seatHeldByOther: true });
    assert.equal(
      await ipnFor(f.transactionRef).process(successCallback(f.amount)),
      "LATE_REFUND_PENDING",
    );
    const state = await readState(f.orderId);
    assert.equal(
      state.order?.status,
      OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
    );
    assert.equal(state.issued.length, 0);
    assert.equal(state.orderRefunds.length, 1);
    const [seat] = await db.select().from(seats).where(eq(seats.id, f.seatId!));
    assert.equal(seat?.status, SeatStatus.SOLD); // khong bi ghi de
    assert.equal(seat?.holdOrderId, null);
  });

  test("A late payment never leaves the buyer charged without a ticket or a refund", async () => {
    const booking = createBookingCommands(cacheStub);
    await booking.cleanExpiredOrders();
    const outcomes: Array<"restored" | "refund"> = [];
    for (const seated of [false, true]) {
      const f = await createLateOrder({ seated });
      const result = await ipnFor(f.transactionRef).process(
        successCallback(f.amount),
      );
      const state = await readState(f.orderId);
      if (result === "LATE_RESTORED") {
        assert.equal(state.issued.length, 1);
        outcomes.push("restored");
      } else {
        assert.equal(result, "LATE_REFUND_PENDING");
        assert.equal(state.orderRefunds.length, 1);
        outcomes.push("refund");
      }
      assert.ok(state.issued.length > 0 || state.orderRefunds.length > 0);
    }
    assert.equal(outcomes.length, 2);
  });
}
