import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  OrderStatus,
  OutboxStatus,
  PaymentProvider,
  RefundStatus,
  TransactionStatus,
} from "@tickethub/shared";
import { env } from "../src/config/env.config";
import { db, sqlClient } from "../src/database/db";
import {
  events,
  orders,
  outbox,
  refunds,
  transactions,
  users,
} from "../src/database/schema";
import { ProcessRefundRequestsUseCase } from "../src/contexts/payment/application/process-refund-requests.use-case";
import { DrizzleRefundProcessingStore } from "../src/contexts/payment/infrastructure/drizzle-refund-processing.store";
import { VnpayRefundGateway } from "../src/contexts/payment/infrastructure/vnpay-refund.gateway";
import type {
  RefundOutboxEvent,
  RefundProcessingStore,
} from "../src/contexts/payment/domain/refund-processing.ports";
import {
  FAKE_HASH_SECRET,
  FAKE_TMN_CODE,
  requestSignatureIsValid,
  startFakeVnpayServer,
  type FakeVnpayServer,
} from "./helpers/fake-vnpay-refund-server";

const targetDb = decodeURIComponent(
  new URL(env.DATABASE_URL).pathname.slice(1),
);
const expectedTestDb =
  process.env.IPN_TEST_DB_NAME?.trim() || "tickethub_ipn_test";
const isSafeTestDb =
  /^[a-z][a-z0-9_]*_test$/.test(expectedTestDb) && targetDb === expectedTestDb;

const silent = { log() {}, warn() {}, error() {} };

/** Chi cho tien trinh thay cac su kien do bai test tao, bo qua du lieu khac trong DB. */
class ScopedStore extends DrizzleRefundProcessingStore {
  constructor(private readonly ids: Set<string>) {
    super();
  }
  override async findPending(
    limit: number,
    now: Date,
  ): Promise<RefundOutboxEvent[]> {
    const all = await super.findPending(1000, now);
    return all.filter((e) => this.ids.has(e.id)).slice(0, limit);
  }
}

const createdOrderIds: string[] = [];
const scopedEventIds = new Set<string>();
let server: FakeVnpayServer;

async function createPendingRefund(opts: {
  orderStatus?: OrderStatus;
  isPartial?: boolean;
  retryCount?: number;
  createDate?: string;
}) {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  const [event] = await db.select({ id: events.id }).from(events).limit(1);
  assert.ok(user && event, "Test DB needs a user and an event");

  const orderId = randomUUID();
  const compact = orderId.replace(/-/g, "");
  createdOrderIds.push(orderId);

  await db.insert(orders).values({
    id: orderId,
    orderCode: "RFD" + compact.slice(0, 20),
    userId: user.id,
    eventId: event.id,
    totalAmount: "500000.00",
    finalAmount: "500000.00",
    status: opts.orderStatus ?? OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
    expiresAt: new Date(Date.now() - 60_000),
  });
  await db.insert(transactions).values({
    orderId,
    provider: PaymentProvider.VNPAY,
    transactionRef: "RFD" + compact,
    providerTxNumber: "14999999",
    amount: "500000.00",
    status: TransactionStatus.SUCCESS,
    rawCallback: { vnp_CreateDate: opts.createDate ?? "20260115103000" },
    idempotencyKey: `rfd-test:${orderId}`,
  });
  const [refund] = await db
    .insert(refunds)
    .values({
      orderId,
      amount: "500000.00",
      reason: "PAYMENT_EXPIRED",
      status: RefundStatus.PENDING,
      idempotencyKey: `rfd-test-refund:${orderId}`,
    })
    .returning();
  const [event_] = await db
    .insert(outbox)
    .values({
      eventType: "REFUND_REQUESTED",
      payload: {
        orderId,
        refundIds: [refund!.id],
        isPartial: opts.isPartial ?? false,
        amount: 500000,
      },
      retryCount: opts.retryCount ?? 0,
      // Khong phu thuoc dong ho cua may chu co so du lieu
      nextRetryAt: new Date(Date.now() - 60_000),
    })
    .returning();
  scopedEventIds.add(event_!.id);

  return {
    orderId,
    refundId: refund!.id,
    eventId: event_!.id,
    transactionRef: "RFD" + compact,
  };
}

async function state(f: {
  orderId: string;
  refundId: string;
  eventId: string;
}) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, f.orderId));
  const [refund] = await db
    .select()
    .from(refunds)
    .where(eq(refunds.id, f.refundId));
  const [event] = await db
    .select()
    .from(outbox)
    .where(eq(outbox.id, f.eventId));
  return { order: order!, refund: refund!, event: event! };
}

function processor(
  apiUrl: string,
  store: RefundProcessingStore = new ScopedStore(scopedEventIds),
) {
  return new ProcessRefundRequestsUseCase(
    store,
    new VnpayRefundGateway({
      apiUrl,
      tmnCode: FAKE_TMN_CODE,
      hashSecret: FAKE_HASH_SECRET,
    }),
    { ipAddress: "127.0.0.1", createBy: "tickethub-system" },
    silent,
  );
}

if (!isSafeTestDb) {
  test.skip(`Refund processor integration tests skipped: database '${targetDb}' is not '${expectedTestDb}'`, () => {});
} else {
  before(async () => {
    server = await startFakeVnpayServer();
  });

  after(async () => {
    await server.close();
    if (createdOrderIds.length) {
      await db
        .delete(outbox)
        .where(
          inArray(sql<string>`${outbox.payload}->>'orderId'`, createdOrderIds),
        );
      await db.delete(refunds).where(inArray(refunds.orderId, createdOrderIds));
      await db
        .delete(transactions)
        .where(inArray(transactions.orderId, createdOrderIds));
      await db.delete(orders).where(inArray(orders.id, createdOrderIds));
    }
    await sqlClient.end();
  });

  test("a successful VNPay refund completes the refund and outbox and moves the order to REFUNDED", async () => {
    server.requests.length = 0;
    server.behavior.responseCode = "00";
    const f = await createPendingRefund({});

    const res = await processor(server.url).run();
    assert.equal(res.completed, 1);

    assert.equal(server.requests.length, 1);
    const body = server.requests[0]!;
    assert.equal(body.vnp_Command, "refund");
    assert.equal(body.vnp_TransactionType, "02");
    assert.equal(body.vnp_Amount, "50000000");
    assert.equal(body.vnp_TxnRef, f.transactionRef);
    assert.equal(body.vnp_TransactionNo, "14999999");
    assert.equal(body.vnp_TransactionDate, "20260115103000");
    assert.ok(requestSignatureIsValid(body));

    const s = await state(f);
    assert.equal(s.refund.status, RefundStatus.COMPLETED);
    assert.ok(s.refund.providerRefundRef);
    assert.ok(s.refund.processedAt);
    assert.equal(s.event.status, OutboxStatus.COMPLETED);
    assert.equal(s.order.status, OrderStatus.REFUNDED);
  });

  test("a partial refund uses type 03 and keeps the order PAID", async () => {
    server.requests.length = 0;
    server.behavior.responseCode = "00";
    const f = await createPendingRefund({
      orderStatus: OrderStatus.PAID,
      isPartial: true,
    });

    const res = await processor(server.url).run();
    assert.equal(res.completed, 1, JSON.stringify(res));

    assert.equal(server.requests[0]?.vnp_TransactionType, "03");
    const s = await state(f);
    assert.equal(s.refund.status, RefundStatus.COMPLETED);
    assert.equal(s.event.status, OutboxStatus.COMPLETED);
    assert.equal(s.order.status, OrderStatus.PAID);
  });

  test("a definitive rejection fails the refund and outbox without touching the order", async () => {
    server.requests.length = 0;
    server.behavior.responseCode = "91";
    const f = await createPendingRefund({});

    const res = await processor(server.url).run();
    assert.equal(res.rejected, 1);

    const s = await state(f);
    assert.equal(s.refund.status, RefundStatus.FAILED);
    assert.match(s.refund.errorMessage ?? "", /91/);
    assert.equal(s.event.status, OutboxStatus.FAILED);
    assert.equal(s.order.status, OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING);
    server.behavior.responseCode = "00";
  });

  test("checks QueryDR after timeout without issuing a second refund", async () => {
    const f = await createPendingRefund({});
    const runner = new ProcessRefundRequestsUseCase(
      new ScopedStore(new Set([f.eventId])),
      new VnpayRefundGateway({
        apiUrl: server.url,
        tmnCode: FAKE_TMN_CODE,
        hashSecret: FAKE_HASH_SECRET,
      }),
      { ipAddress: "127.0.0.1", createBy: "test" },
      silent,
      {
        async queryTransaction() {
          return {
            vnp_ResponseCode: "00",
            vnp_TransactionStatus: "00",
            vnp_TransactionType: "02",
            vnp_Amount: "50000000",
            vnp_TransactionNo: "454545",
          };
        },
      },
    );
    const before = server.requests.length;
    try {
      server.behavior.dropConnection = true;
      await runner.run();
      assert.equal((await state(f)).refund.status, RefundStatus.PROCESSING);
      await db
        .update(outbox)
        .set({ nextRetryAt: new Date(0) })
        .where(eq(outbox.id, f.eventId));
      await runner.run();
      assert.equal((await state(f)).refund.status, RefundStatus.COMPLETED);
      assert.equal(server.requests.length, before + 1);
    } finally {
      server.behavior.dropConnection = false;
    }
  });

  test("an uncertain outcome keeps everything PROCESSING and is never resent", async () => {
    server.requests.length = 0;
    server.behavior.responseCode = "94";
    const f = await createPendingRefund({});

    const first = await processor(server.url).run();
    assert.equal(first.uncertain, 1);
    assert.equal(server.requests.length, 1);

    const s = await state(f);
    assert.equal(s.refund.status, RefundStatus.PROCESSING);
    assert.equal(s.event.status, OutboxStatus.PROCESSING);
    assert.match(s.event.errorMessage ?? "", /manual reconciliation/i);
    assert.equal(s.order.status, OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING);

    // Chay lai khong gui them yeu cau nao
    await processor(server.url).run();
    assert.equal(server.requests.length, 1);
    server.behavior.responseCode = "00";
  });

  test("a forged response (bad signature) is treated as uncertain, not as success", async () => {
    server.requests.length = 0;
    server.behavior.badSignature = true;
    const f = await createPendingRefund({});

    const res = await processor(server.url).run();
    assert.equal(res.uncertain, 1);

    const s = await state(f);
    assert.equal(s.refund.status, RefundStatus.PROCESSING);
    assert.equal(s.event.status, OutboxStatus.PROCESSING);
    assert.equal(s.order.status, OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING);
    server.behavior.badSignature = false;
  });

  test("an unreachable gateway returns the refund to PENDING and schedules a retry", async () => {
    const dead = await startFakeVnpayServer();
    const deadUrl = dead.url;
    await dead.close();
    const f = await createPendingRefund({});

    const res = await processor(deadUrl).run();
    assert.equal(res.retried, 1);

    const s = await state(f);
    assert.equal(s.refund.status, RefundStatus.PENDING);
    assert.equal(s.refund.retryCount, 1);
    assert.equal(s.event.status, OutboxStatus.PENDING);
    assert.equal(s.event.retryCount, 1);
    assert.ok(s.event.nextRetryAt.getTime() > Date.now());

    // Chua den gio thu lai thi khong duoc xu ly
    const again = await processor(server.url).run();
    assert.equal(again.found, 0);
  });

  test("an unreachable gateway gives up after the maximum attempts", async () => {
    const dead = await startFakeVnpayServer();
    const deadUrl = dead.url;
    await dead.close();
    const f = await createPendingRefund({ retryCount: 4 });

    const res = await processor(deadUrl).run();
    assert.equal(res.failed, 1);

    const s = await state(f);
    assert.equal(s.event.status, OutboxStatus.FAILED);
    assert.equal(s.refund.status, RefundStatus.PENDING);
    assert.equal(s.order.status, OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING);
  });

  test("concurrent processors send exactly one refund request per event", async () => {
    server.requests.length = 0;
    server.behavior.responseCode = "00";
    const f = await createPendingRefund({});

    await Promise.all([
      processor(server.url).run(),
      processor(server.url).run(),
      processor(server.url).run(),
    ]);

    assert.equal(
      server.requests.filter((r) => r.vnp_TxnRef === f.transactionRef).length,
      1,
    );
    const s = await state(f);
    assert.equal(s.refund.status, RefundStatus.COMPLETED);
    assert.equal(s.event.status, OutboxStatus.COMPLETED);
    assert.equal(s.order.status, OrderStatus.REFUNDED);
  });

  test("falls back to the transaction creation time when no create date was stored", async () => {
    server.requests.length = 0;
    const f = await createPendingRefund({});
    await db
      .update(transactions)
      .set({ rawCallback: null })
      .where(eq(transactions.orderId, f.orderId));

    await processor(server.url).run();

    assert.match(server.requests[0]?.vnp_TransactionDate ?? "", /^\d{14}$/);
    const s = await state(f);
    assert.equal(s.event.status, OutboxStatus.COMPLETED);
  });

  test("an event whose refund rows are missing is failed without calling VNPay", async () => {
    server.requests.length = 0;
    const f = await createPendingRefund({});
    await db.delete(refunds).where(eq(refunds.id, f.refundId));

    const res = await processor(server.url).run();
    assert.equal(res.failed, 1);
    assert.equal(server.requests.length, 0);

    const [event] = await db
      .select()
      .from(outbox)
      .where(eq(outbox.id, f.eventId));
    assert.equal(event?.status, OutboxStatus.FAILED);
  });
}
