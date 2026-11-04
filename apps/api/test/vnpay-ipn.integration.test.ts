import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { BookingService } from "../src/booking/booking.service";
import type { WaitingRoomService } from "../src/waiting-room/waiting-room.service";
import { PaymentService } from "../src/payments/payment.service";
import { VnpayGateway } from "../src/payments/vnpay.gateway";
import type { EventReadCacheService } from "../src/events/event-read-cache.service";
import {
  OrderStatus,
  TransactionStatus,
  PaymentProvider,
  SeatStatus,
} from "@tickethub/shared";

import { env } from "../src/config/env.config";
import { db } from "../src/database/db";
import {
  users,
  orders,
  orderItems,
  transactions,
  ticketTypes,
  tickets,
  outbox,
  seats,
  auditLog,
} from "../src/database/schema";

import { VnpayIpnService } from "../src/payments/vnpay-ipn.service";
import { toVnpayAmount } from "../src/payments/vnpay-ipn.preview.service";

// Safety guard: never write integration fixtures to dev DB.

const cacheStub = {
  invalidate: async (_eventId: string): Promise<void> => {
    // Unit/integration test khong can xoa Redis cache that
  },
} as EventReadCacheService;

const targetDb = decodeURIComponent(
  new URL(env.DATABASE_URL).pathname.slice(1),
);

// Cho phep developer cau hinh ten database test rieng.
// Mac dinh van su dung tickethub_ipn_test.
const expectedTestDb =
  process.env.IPN_TEST_DB_NAME?.trim() || "tickethub_ipn_test";

const isValidExpectedDb = /^[a-z][a-z0-9_]*_test$/.test(expectedTestDb);
const isSafeTestDb = isValidExpectedDb && targetDb === expectedTestDb;

async function createFixture(expired = false) {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);

  const [tt] = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.isSeated, false))
    .limit(1);

  if (!user || !tt) {
    throw new Error("Test DB needs seeded users and GA ticket types");
  }

  const id = randomUUID();
  const orderId = id;
  const transactionRef = "IPNTEST" + id.replace(/-/g, "");
  const orderCode = "IPN" + id.replace(/-/g, "").slice(0, 20);

  await db.transaction(async (tx) => {
    await tx.insert(orders).values({
      id: orderId,
      orderCode,
      userId: user.id,
      eventId: tt.eventId,
      totalAmount: tt.price,
      finalAmount: tt.price,
      status: OrderStatus.PENDING,
      expiresAt: new Date(Date.now() + (expired ? -60_000 : 300_000)),
    });

    await tx.insert(orderItems).values({
      orderId,
      ticketTypeId: tt.id,
      quantity: 1,
      unitPrice: tt.price,
      subtotal: tt.price,
    });

    await tx.insert(transactions).values({
      orderId,
      provider: PaymentProvider.VNPAY,
      transactionRef,
      amount: tt.price,
      status: TransactionStatus.PENDING,
      idempotencyKey: `ipn-test:${id}`,
    });

    await tx
      .update(ticketTypes)
      .set({
        heldCount: sql`${ticketTypes.heldCount} + 1`,
      })
      .where(eq(ticketTypes.id, tt.id));
  });

  return {
    userId: user.id,
    orderId,
    transactionRef,
    amount: toVnpayAmount(tt.price)!,
    ticketTypeId: tt.id,
    heldBefore: tt.heldCount,
    soldBefore: tt.soldCount,
  };
}

// Mock only the already-verified gateway result.
// Database transactions and inventory changes remain real.
function serviceWithVerifiedCallback(transactionRef: string, success: boolean) {
  const service = new VnpayIpnService(cacheStub);

  Object.defineProperty(service, "gateway", {
    value: {
      verifyCallback: () => ({
        verified: true,
        success,
        transactionRef,
        providerTransactionId: "TESTPROVIDER001",
      }),
    },
  });

  return service;
}

async function readOrder(orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));

  const [transaction] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.orderId, orderId));

  return { order, transaction };
}

if (!isSafeTestDb) {
  test.skip(`VNPay IPN integration tests skipped: database '${targetDb}' is not test database '${expectedTestDb}'. To run integration tests, point DATABASE_URL to a database ending in _test.`, () => {});
} else {
  test("Successful IPN updates payment once", async () => {
    const fixture = await createFixture();
    const service = serviceWithVerifiedCallback(fixture.transactionRef, true);

    const callback = {
      vnp_Amount: fixture.amount,
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
    };

    const first = await service.process(callback);
    assert.equal(first, "APPLY_SUCCESS");

    const second = await service.process(callback);
    assert.equal(second, "ALREADY_PROCESSED");

    const { order, transaction } = await readOrder(fixture.orderId);

    assert.equal(order?.status, OrderStatus.PAID);
    assert.equal(transaction?.status, TransactionStatus.SUCCESS);

    // Kiem tra ve thuc su duoc tao sau thanh toan
    const issuedTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, fixture.orderId));

    // Don hang GA mua 1 ve phai tao dung 1 ban ghi
    assert.equal(issuedTickets.length, 1);

    // Ve GA khong co ghe cu the
    assert.equal(issuedTickets[0]?.seatId, null);

    // Ma ve phai duoc tao
    assert.ok(issuedTickets[0]?.ticketCode.startsWith("TK"));

    const [tt] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.id, fixture.ticketTypeId));

    assert.equal(tt?.heldCount, fixture.heldBefore);
    assert.equal(tt?.soldCount, fixture.soldBefore + 1);

    const emittedEvents = await db
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          eq(outbox.eventType, "ORDER_PAID"),
          sql`${outbox.payload} ->> 'orderId' = ${fixture.orderId}`,
        ),
      );

    assert.equal(emittedEvents.length, 1);
  });

  test("Failed IPN releases GA hold", async () => {
    const fixture = await createFixture();
    const service = serviceWithVerifiedCallback(fixture.transactionRef, false);

    const result = await service.process({
      vnp_Amount: fixture.amount,
      vnp_ResponseCode: "24",
      vnp_TransactionStatus: "02",
    });

    assert.equal(result, "RECORD_FAILURE");

    const { order, transaction } = await readOrder(fixture.orderId);

    assert.equal(order?.status, OrderStatus.FAILED);
    assert.equal(transaction?.status, TransactionStatus.FAILED);

    const [tt] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.id, fixture.ticketTypeId));

    assert.equal(tt?.heldCount, fixture.heldBefore);
    assert.equal(tt?.soldCount, fixture.soldBefore);
  });

  test("Expired order never becomes PAID", async () => {
    const fixture = await createFixture(true);
    const service = serviceWithVerifiedCallback(fixture.transactionRef, true);

    const result = await service.process({
      vnp_Amount: fixture.amount,
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
    });

    assert.equal(result, "MANUAL_REVIEW");

    const { order, transaction } = await readOrder(fixture.orderId);

    assert.equal(order?.status, OrderStatus.PENDING);
    assert.equal(transaction?.status, TransactionStatus.PENDING);
  });

  test("Concurrent duplicate IPNs update inventory only once", async () => {
    const fixture = await createFixture();

    const service = serviceWithVerifiedCallback(fixture.transactionRef, true);

    const callback = {
      vnp_Amount: fixture.amount,
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
    };

    const results = await Promise.all([
      service.process(callback),
      service.process(callback),
    ]);

    assert.deepEqual(
      results.sort(),
      ["ALREADY_PROCESSED", "APPLY_SUCCESS"].sort(),
    );

    const { order, transaction } = await readOrder(fixture.orderId);

    assert.equal(order?.status, OrderStatus.PAID);
    assert.equal(transaction?.status, TransactionStatus.SUCCESS);

    const [tt] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.id, fixture.ticketTypeId));

    assert.equal(tt?.heldCount, fixture.heldBefore);
    assert.equal(tt?.soldCount, fixture.soldBefore + 1);
  });

  test("Wrong VNPay amount does not change database state", async () => {
    const fixture = await createFixture();

    const service = serviceWithVerifiedCallback(fixture.transactionRef, true);

    const wrongAmount = (BigInt(fixture.amount) + 100n).toString();

    const result = await service.process({
      vnp_Amount: wrongAmount,
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
    });

    assert.equal(result, "AMOUNT_MISMATCH");

    const { order, transaction } = await readOrder(fixture.orderId);

    assert.equal(order?.status, OrderStatus.PENDING);
    assert.equal(transaction?.status, TransactionStatus.PENDING);

    const [tt] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.id, fixture.ticketTypeId));

    assert.equal(tt?.heldCount, fixture.heldBefore + 1);
    assert.equal(tt?.soldCount, fixture.soldBefore);
  });

  test("Repeated failed callback does not release tickets twice", async () => {
    const fixture = await createFixture();

    const service = serviceWithVerifiedCallback(fixture.transactionRef, false);

    const callback = {
      vnp_Amount: fixture.amount,
      vnp_ResponseCode: "24",
      vnp_TransactionStatus: "02",
    };

    const first = await service.process(callback);
    const second = await service.process(callback);

    assert.equal(first, "RECORD_FAILURE");
    assert.equal(second, "ALREADY_PROCESSED");

    const { order, transaction } = await readOrder(fixture.orderId);

    assert.equal(order?.status, OrderStatus.FAILED);
    assert.equal(transaction?.status, TransactionStatus.FAILED);

    const [tt] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.id, fixture.ticketTypeId));

    assert.equal(tt?.heldCount, fixture.heldBefore);
    assert.equal(tt?.soldCount, fixture.soldBefore);
  });

  test("IPN vs releaseHold: payment and cancellation cannot both win", async () => {
    const fixture = await createFixture();

    const ipn = serviceWithVerifiedCallback(fixture.transactionRef, true);

    const booking = new BookingService({} as WaitingRoomService, cacheStub);

    const [paymentResult, releaseResult] = await Promise.allSettled([
      ipn.process({
        vnp_Amount: fixture.amount,
        vnp_ResponseCode: "00",
        vnp_TransactionStatus: "00",
      }),
      booking.releaseHold(fixture.userId, fixture.orderId),
    ]);

    const { order, transaction } = await readOrder(fixture.orderId);

    const [tt] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.id, fixture.ticketTypeId));

    assert.ok(order);
    assert.ok(transaction);
    assert.ok(tt);

    if (order.status === OrderStatus.PAID) {
      assert.equal(transaction.status, TransactionStatus.SUCCESS);
      assert.equal(paymentResult.status, "fulfilled");
      assert.equal(paymentResult.value, "APPLY_SUCCESS");
      assert.equal(releaseResult.status, "rejected");

      assert.equal(tt.heldCount, fixture.heldBefore);
      assert.equal(tt.soldCount, fixture.soldBefore + 1);
    } else {
      assert.equal(order.status, OrderStatus.CANCELLED);
      assert.equal(transaction.status, TransactionStatus.PENDING);
      assert.equal(releaseResult.status, "fulfilled");
      assert.equal(paymentResult.status, "fulfilled");
      assert.equal(paymentResult.value, "MANUAL_REVIEW");

      assert.equal(tt.heldCount, fixture.heldBefore);
      assert.equal(tt.soldCount, fixture.soldBefore);
    }
  });

  test("IPN vs Booking Cleanup: expired order never becomes PAID", async () => {
    const booking = new BookingService({} as WaitingRoomService, cacheStub);

    // Don cac hold da het han cua cac test truoc.
    await booking.cleanExpiredOrders();

    const fixture = await createFixture(true);

    const ipn = serviceWithVerifiedCallback(fixture.transactionRef, true);

    const [paymentResult, cleanupResult] = await Promise.allSettled([
      ipn.process({
        vnp_Amount: fixture.amount,
        vnp_ResponseCode: "00",
        vnp_TransactionStatus: "00",
      }),
      booking.cleanExpiredOrders(),
    ]);

    assert.equal(paymentResult.status, "fulfilled");
    assert.equal(cleanupResult.status, "fulfilled");

    if (paymentResult.status === "fulfilled") {
      assert.equal(paymentResult.value, "MANUAL_REVIEW");
    }

    const { order, transaction } = await readOrder(fixture.orderId);

    assert.equal(order?.status, OrderStatus.EXPIRED);
    assert.equal(transaction?.status, TransactionStatus.PENDING);

    const [tt] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.id, fixture.ticketTypeId));

    assert.equal(tt?.heldCount, fixture.heldBefore);
    assert.equal(tt?.soldCount, fixture.soldBefore);
  });

  test("Seated IPN sells seat and issues ticket once", async () => {
    const [user] = await db.select({ id: users.id }).from(users).limit(1);

    const [tt] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.isSeated, true))
      .limit(1);

    assert.ok(user, "Test DB needs a user");
    assert.ok(tt, "Test DB needs a seated ticket type");

    const unique = randomUUID().replace(/-/g, "");
    const orderId = randomUUID();
    const transactionRef = `IPNSEAT${unique}`;
    const expiresAt = new Date(Date.now() + 300000);
    let seatId = "";

    await db.transaction(async (tx) => {
      await tx.insert(orders).values({
        id: orderId,
        orderCode: `SIT${unique.slice(0, 20)}`,
        userId: user.id,
        eventId: tt.eventId,
        totalAmount: tt.price,
        finalAmount: tt.price,
        status: OrderStatus.PENDING,
        expiresAt,
      });

      const [seat] = await tx
        .insert(seats)
        .values({
          eventId: tt.eventId,
          ticketTypeId: tt.id,
          zoneName: "IPN_INTEGRATION",
          rowLabel: "TEST",
          seatNumber: unique.slice(0, 14),
          status: SeatStatus.HELD,
          holdOrderId: orderId,
          holdExpiresAt: expiresAt,
        })
        .returning({ id: seats.id });

      assert.ok(seat);
      seatId = seat.id;

      await tx.insert(orderItems).values({
        orderId,
        ticketTypeId: tt.id,
        seatId,
        quantity: 1,
        unitPrice: tt.price,
        subtotal: tt.price,
      });

      await tx.insert(transactions).values({
        orderId,
        provider: PaymentProvider.VNPAY,
        transactionRef,
        amount: tt.price,
        status: TransactionStatus.PENDING,
        idempotencyKey: `ipn-seat-test:${unique}`,
      });
    });

    const service = serviceWithVerifiedCallback(transactionRef, true);

    const callback = {
      vnp_Amount: toVnpayAmount(tt.price)!,
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
    };

    assert.equal(await service.process(callback), "APPLY_SUCCESS");

    assert.equal(await service.process(callback), "ALREADY_PROCESSED");

    const { order, transaction } = await readOrder(orderId);

    const [seatAfter] = await db
      .select()
      .from(seats)
      .where(eq(seats.id, seatId));

    const issuedTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, orderId));

    assert.equal(order?.status, OrderStatus.PAID);
    assert.equal(transaction?.status, TransactionStatus.SUCCESS);

    assert.equal(seatAfter?.status, SeatStatus.SOLD);
    assert.equal(seatAfter?.holdOrderId, null);

    assert.equal(issuedTickets.length, 1);
    assert.equal(issuedTickets[0]?.seatId, seatId);
    assert.equal(issuedTickets[0]?.ticketTypeId, tt.id);
    assert.ok(issuedTickets[0]?.ticketCode.startsWith("TK"));
  });

  test("Failed seated IPN releases seat without issuing tickets", async () => {
    const [user] = await db.select({ id: users.id }).from(users).limit(1);

    const [tt] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.isSeated, true))
      .limit(1);

    assert.ok(user, "Test DB needs a user");
    assert.ok(tt, "Test DB needs a seated ticket type");

    const unique = randomUUID().replace(/-/g, "");
    const orderId = randomUUID();
    const transactionRef = `IPNFAILSEAT${unique}`;
    const expiresAt = new Date(Date.now() + 300000);

    let seatId = "";

    await db.transaction(async (tx) => {
      await tx.insert(orders).values({
        id: orderId,
        orderCode: `SF${unique.slice(0, 20)}`,
        userId: user.id,
        eventId: tt.eventId,
        totalAmount: tt.price,
        finalAmount: tt.price,
        status: OrderStatus.PENDING,
        expiresAt,
      });

      const [seat] = await tx
        .insert(seats)
        .values({
          eventId: tt.eventId,
          ticketTypeId: tt.id,
          zoneName: "IPN_FAILURE_TEST",
          rowLabel: "TEST",
          seatNumber: unique.slice(0, 14),
          status: SeatStatus.HELD,
          holdOrderId: orderId,
          holdExpiresAt: expiresAt,
        })
        .returning({ id: seats.id });

      assert.ok(seat);
      seatId = seat.id;

      await tx.insert(orderItems).values({
        orderId,
        ticketTypeId: tt.id,
        seatId,
        quantity: 1,
        unitPrice: tt.price,
        subtotal: tt.price,
      });

      await tx.insert(transactions).values({
        orderId,
        provider: PaymentProvider.VNPAY,
        transactionRef,
        amount: tt.price,
        status: TransactionStatus.PENDING,
        idempotencyKey: `ipn-failure:${unique}`,
      });
    });

    // Gia lap VNPay da xac minh chu ky,
    // nhung ket qua thanh toan that bai.
    const service = serviceWithVerifiedCallback(transactionRef, false);

    const callback = {
      vnp_Amount: toVnpayAmount(tt.price)!,
      vnp_ResponseCode: "24",
      vnp_TransactionStatus: "02",
    };

    // Callback lan dau
    assert.equal(await service.process(callback), "RECORD_FAILURE");

    // Callback lap lai
    assert.equal(await service.process(callback), "ALREADY_PROCESSED");

    const { order, transaction } = await readOrder(orderId);

    const [seatAfter] = await db
      .select()
      .from(seats)
      .where(eq(seats.id, seatId));

    const issuedTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, orderId));

    // Order va Transaction that bai
    assert.equal(order?.status, OrderStatus.FAILED);
    assert.equal(transaction?.status, TransactionStatus.FAILED);

    // Ghe duoc tra lai, khong con bi giu
    assert.equal(seatAfter?.status, SeatStatus.AVAILABLE);
    assert.equal(seatAfter?.holdOrderId, null);
    assert.equal(seatAfter?.holdExpiresAt, null);

    // Khong phat hanh ve cho giao dich that bai
    assert.equal(issuedTickets.length, 0);
  });

  test("VNPay retry reuses pending transaction", async () => {
    const fixture = await createFixture();

    // Mock chi buoc tao URL, khong goi VNPay that.
    const originalCreatePaymentUrl = VnpayGateway.prototype.createPaymentUrl;

    const generatedRefs: string[] = [];

    VnpayGateway.prototype.createPaymentUrl = async (request) => {
      generatedRefs.push(request.transactionRef);

      return {
        transactionRef: request.transactionRef,
        paymentUrl: `https://sandbox.example.test/pay?ref=${request.transactionRef}`,
      };
    };

    try {
      const service = new PaymentService();

      // Fixture da co mot giao dich PENDING.
      // Goi lai lan 1.
      const first = await service.createVnpayPayment(
        fixture.userId,
        fixture.orderId,
        "127.0.0.1",
      );

      // Goi lai lan 2.
      const second = await service.createVnpayPayment(
        fixture.userId,
        fixture.orderId,
        "127.0.0.1",
      );

      // Hai lan phai su dung cung ma giao dich.
      assert.equal(first.transactionRef, fixture.transactionRef);

      assert.equal(second.transactionRef, fixture.transactionRef);

      assert.deepEqual(generatedRefs, [fixture.transactionRef]);
      assert.equal(first.paymentUrl, second.paymentUrl);

      // Kiem tra database chi co 1 transaction.
      const savedTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.orderId, fixture.orderId));

      assert.equal(savedTransactions.length, 1);

      assert.equal(savedTransactions[0]?.status, TransactionStatus.PENDING);

      assert.equal(
        savedTransactions[0]?.transactionRef,
        fixture.transactionRef,
      );

      // Order van dang cho thanh toan.
      const { order } = await readOrder(fixture.orderId);

      assert.equal(order?.status, OrderStatus.PENDING);
    } finally {
      // Khoi phuc gateway, tranh anh huong test khac.
      VnpayGateway.prototype.createPaymentUrl = originalCreatePaymentUrl;
    }
  });

  test("Late successful IPN after cleanup must not issue tickets", async () => {
    // 1. Tao mot don hang GA da het han
    const fixture = await createFixture(true);

    const booking = new BookingService({} as WaitingRoomService, cacheStub);

    // 2. Cleanup chay truoc khi VNPay callback
    await booking.cleanExpiredOrders();

    const before = await readOrder(fixture.orderId);

    assert.equal(before.order?.status, OrderStatus.EXPIRED);

    // 3. Gia lap VNPay thong bao thanh toan thanh cong
    const service = serviceWithVerifiedCallback(fixture.transactionRef, true);

    const callback = {
      vnp_Amount: fixture.amount,
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
    };

    const result = await service.process(callback);

    // Don da het han phai chuyen sang doi soat
    assert.equal(result, "MANUAL_REVIEW");

    // 4. Kiem tra trang thai database
    const { order, transaction } = await readOrder(fixture.orderId);

    assert.equal(order?.status, OrderStatus.EXPIRED);

    assert.equal(transaction?.status, TransactionStatus.PENDING);

    // 5. Khong duoc phat hanh ve
    const issuedTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, fixture.orderId));

    assert.equal(issuedTickets.length, 0);

    // 6. Khong duoc tao su kien ORDER_PAID
    const paidEvents = await db
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          eq(outbox.eventType, "ORDER_PAID"),
          sql`${outbox.payload} ->> 'orderId' = ${fixture.orderId}`,
        ),
      );

    assert.equal(paidEvents.length, 0);

    // 7. Callback lap lai cung khong duoc phat hanh ve
    const second = await service.process(callback);

    assert.equal(second, "MANUAL_REVIEW");

    // 8. Kiem tra callback can doi soat da duoc luu.
    assert.ok(transaction);

    const auditRecords = await db
      .select({
        id: auditLog.id,
        changes: auditLog.changes,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "VNPAY_IPN_MANUAL_REVIEW"),
          eq(auditLog.targetType, "TRANSACTION"),
          eq(auditLog.targetId, transaction.id),
        ),
      );

    // Callback gui 2 lan chi tao 1 ban ghi doi soat.
    assert.equal(auditRecords.length, 1);

    const changes = auditRecords[0]?.changes as Record<string, unknown> | null;

    assert.equal(changes?.orderId, fixture.orderId);

    // 9. Kiem tra bang transactions luu callback VNPay.
    const { transaction: savedTransaction } = await readOrder(fixture.orderId);

    const savedCallback = savedTransaction?.rawCallback as Record<
      string,
      unknown
    > | null;

    assert.equal(savedCallback?.vnp_ResponseCode, "00");
    assert.equal(savedCallback?.vnp_TransactionStatus, "00");

    // Transaction van PENDING de cho doi soat.
    assert.equal(savedTransaction?.status, TransactionStatus.PENDING);
  });
}
