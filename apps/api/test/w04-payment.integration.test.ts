import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { once } from "node:events";
import { SeatStreamService } from "../src/events/seat-stream.service";
import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import Redis from "ioredis";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  OrderStatus,
  OutboxStatus,
  RefundStatus,
  SeatStatus,
} from "@tickethub/shared";
import { env } from "../src/config/env.config";
import { db, sqlClient } from "../src/database/db";
import {
  events,
  idempotencyKeys,
  orderItems,
  orders,
  organizerProfiles,
  outbox,
  refunds,
  seats,
  ticketTypes,
  tickets,
  transactions,
  users,
} from "../src/database/schema";
import { EventReadCacheService } from "../src/events/event-read-cache.service";
import { EventsService } from "../src/events/events.service";
import { JwtAuthGuard } from "../src/auth/guards/jwt-auth.guard";
import { PaymentController } from "../src/payments/payment.controller";
import { PaymentService } from "../src/payments/payment.service";
import { VnpayIpnController } from "../src/payments/vnpay-ipn.controller";
import { VnpayIpnService } from "../src/payments/vnpay-ipn.service";
import { VnpayQueryService } from "../src/payments/vnpay-query.service";
import { VnpayApi, formatVnpayDate } from "../src/payments/vnpay-api";
import { processPaymentOutboxOnce } from "../src/jobs/payment-outbox";

import { RefundsController } from "../src/refunds/refunds.controller";
import { RefundsService } from "../src/refunds/refunds.service";
@Module({})
class PaymentTestModule {}

// Chi gia lap giao thuc nha cung cap. Order, khoa ton kho, IPN, refund/outbox dung code that va DB/Redis that.
describe("W04-BE2: thanh toan, IPN, QueryDR va worker hoan tien qua HTTP", () => {
  const secret = "local-vnpay-fixture-only";
  const merchant = "W04LOCAL";
  const redis = new Redis(env.REDIS_URL);
  const api = new VnpayApi();
  const jwt = new JwtService({ secret: env.JWT_SECRET });
  const createdOrders: string[] = [];
  const createdEvents: string[] = [];
  const createdUsers: string[] = [];
  const providerRefunds = new Map<string, Record<string, string>>();
  const providerCalls: Record<string, string>[] = [];
  const emailCalls: { key: string; text: string }[] = [];
  let provider: Server;
  let app: NestFastifyApplication;
  let base: string;
  let organizerId: string;
  let buyer: string;
  let other: string;
  let tamper = false;
  let wrongAmount = false;
  let loseRefundResponse = false;
  let emailFailure = false;
  let queryStatus = "00";
  let hideRefundEvidence = false;
  let numericAmount = false;
  let tamperPromotion = false;

  function signedQuery(values: Record<string, string>) {
    const query = new URLSearchParams(values);
    query.sort();
    query.set(
      "vnp_SecureHash",
      createHmac("sha512", secret).update(query.toString()).digest("hex"),
    );
    return query.toString();
  }
  function signResponse(data: Record<string, string>) {
    const fields = [
      "vnp_ResponseId",
      "vnp_Command",
      "vnp_ResponseCode",
      "vnp_Message",
      "vnp_TmnCode",
      "vnp_TxnRef",
      "vnp_Amount",
      "vnp_BankCode",
      "vnp_PayDate",
      "vnp_TransactionNo",
      "vnp_TransactionType",
      "vnp_TransactionStatus",
      "vnp_OrderInfo",
    ];
    if (data.vnp_Command === "querydr")
      fields.push("vnp_PromotionCode", "vnp_PromotionAmount");
    data.vnp_SecureHash = createHmac("sha512", secret)
      .update(fields.map((k) => data[k] ?? "").join("|"))
      .digest("hex");
    return data;
  }
  async function http(
    path: string,
    method = "POST",
    body?: unknown,
    tokenUser = buyer,
    key?: string,
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${await jwt.signAsync({ sub: tokenUser, role: "BUYER" })}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    return { status: response.status, body: data };
  }
  async function fixture(
    options: {
      seated?: boolean;
      expired?: boolean;
      lost?: boolean;
      quantity?: number;
    } = {},
  ) {
    const [event] = await db
      .insert(events)
      .values({
        organizerId,
        title: "W04 VNPay",
        slug: `w04-${randomUUID()}`,
        description: "Kiem thu",
        category: "CONCERT",
        city: "Ha Noi",
        bannerUrl: "https://example.com/banner",
        venueName: "San khau",
        venueAddress: "Ha Noi",
        status: "PUBLISHED",
        startTime: new Date(Date.now() + 864000000),
        endTime: new Date(Date.now() + 900000000),
        gateOpeningTime: new Date(),
      })
      .returning();
    createdEvents.push(event!.id);
    const [type] = await db
      .insert(ticketTypes)
      .values({
        eventId: event!.id,
        name: "GA/VIP",
        price: "100000",
        capacity: options.quantity ?? 1,
        isSeated: options.seated ?? false,
        heldCount:
          !options.seated && !options.expired ? (options.quantity ?? 1) : 0,
        soldCount: options.lost && !options.seated ? 1 : 0,
        saleStartTime: new Date(),
        saleEndTime: new Date(Date.now() + 800000000),
      })
      .returning();
    const [order] = await db
      .insert(orders)
      .values({
        userId: buyer,
        eventId: event!.id,
        orderCode: randomUUID().replaceAll("-", ""),
        totalAmount: String(100000 * (options.quantity ?? 1)),
        finalAmount: String(100000 * (options.quantity ?? 1)),
        status: options.expired ? OrderStatus.EXPIRED : OrderStatus.PENDING,
        expiresAt: new Date(Date.now() + (options.expired ? -1000 : 300000)),
      })
      .returning();
    createdOrders.push(order!.id);
    let seatId: string | null = null;
    if (options.seated) {
      const [seat] = await db
        .insert(seats)
        .values({
          eventId: event!.id,
          ticketTypeId: type!.id,
          zoneName: "VIP",
          rowLabel: "A",
          seatNumber: "1",
          status: options.lost
            ? SeatStatus.SOLD
            : options.expired
              ? SeatStatus.AVAILABLE
              : SeatStatus.HELD,
          holdOrderId: options.expired ? null : order!.id,
          holdExpiresAt: options.expired ? null : order!.expiresAt,
        })
        .returning();
      seatId = seat!.id;
    }
    await db.insert(orderItems).values({
      orderId: order!.id,
      ticketTypeId: type!.id,
      seatId,
      quantity: options.quantity ?? 1,
      unitPrice: "100000",
      subtotal: String(100000 * (options.quantity ?? 1)),
    });
    return { order: order!, type: type!, seatId };
  }
  async function payment(orderId: string) {
    return http(
      `/api/v1/payments/orders/${orderId}/vnpay`,
      "POST",
      {},
      buyer,
      randomUUID(),
    );
  }
  async function originalPayment(orderId: string) {
    const ref = randomUUID().replaceAll("-", "");
    const [tx] = await db
      .insert(transactions)
      .values({
        orderId,
        transactionRef: ref,
        amount: "100000",
        provider: "VNPAY",
        idempotencyKey: `test:${ref}`,
        vnpCreateDate: formatVnpayDate(new Date(Date.now() - 600000)),
      })
      .returning();
    return tx!;
  }
  async function ipn(ref: string, overrides: Record<string, string> = {}) {
    return http(
      `/api/v1/payments/vnpay/ipn?${signedQuery({ vnp_TmnCode: merchant, vnp_TxnRef: ref, vnp_Amount: "10000000", vnp_ResponseCode: "00", vnp_TransactionStatus: "00", vnp_TransactionNo: "123456789", vnp_PayDate: formatVnpayDate(new Date()), ...overrides })}`,
      "GET",
    );
  }
  async function orderState(id: string) {
    return db.query.orders.findFirst({ where: eq(orders.id, id) });
  }
  async function eventFor(orderId: string, type: string) {
    const event = await db.query.outbox.findFirst({
      where: and(
        eq(outbox.eventType, type),
        sql`${outbox.payload}->>'orderId' = ${orderId}`,
      ),
    });
    assert.ok(event);
    return event;
  }

  before(async () => {
    assert.match(new URL(env.DATABASE_URL).pathname, /_test$/);
    Object.assign(env, {
      VNPAY_TMN_CODE: merchant,
      VNPAY_HASH_SECRET: secret,
      NODE_ENV: "test",
      RESEND_API_KEY: "local-resend-fixture",
      VNPAY_API_TIMEOUT_MS: 500,
    });
    Object.assign(process.env, {
      ENABLE_VNPAY_IPN_PROCESSING: "true",
      ENABLE_VNPAY_REFUNDS: "true",
      ENABLE_PAYMENT_EMAIL: "true",
    });
    provider = createServer(async (req, res) => {
      try {
        let raw = "";
        for await (const chunk of req) raw += String(chunk);
        const body = JSON.parse(raw) as Record<string, string>;
        if (req.url === "/emails") {
          emailCalls.push({
            key: String(req.headers["idempotency-key"]),
            text: body.text!,
          });
          res.writeHead(emailFailure ? 500 : 200, {
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          });
          res.end(JSON.stringify({ id: "local-email-receipt" }));
          return;
        }
        providerCalls.push(body);
        const fields =
          body.vnp_Command === "refund"
            ? [
                "vnp_RequestId",
                "vnp_Version",
                "vnp_Command",
                "vnp_TmnCode",
                "vnp_TransactionType",
                "vnp_TxnRef",
                "vnp_Amount",
                "vnp_TransactionNo",
                "vnp_TransactionDate",
                "vnp_CreateBy",
                "vnp_CreateDate",
                "vnp_IpAddr",
                "vnp_OrderInfo",
              ]
            : [
                "vnp_RequestId",
                "vnp_Version",
                "vnp_Command",
                "vnp_TmnCode",
                "vnp_TxnRef",
                "vnp_TransactionDate",
                "vnp_CreateDate",
                "vnp_IpAddr",
                "vnp_OrderInfo",
              ];
        assert.equal(
          body.vnp_SecureHash,
          createHmac("sha512", secret)
            .update(fields.map((k) => body[k] ?? "").join("|"))
            .digest("hex"),
        );
        let result = {
          vnp_ResponseId: randomUUID().replaceAll("-", ""),
          vnp_Command: body.vnp_Command!,
          vnp_ResponseCode: "00",
          vnp_Message: "Success",
          vnp_TmnCode: merchant,
          vnp_TxnRef: body.vnp_TxnRef!,
          vnp_Amount: wrongAmount ? "999900" : (body.vnp_Amount ?? "10000000"),
          vnp_TransactionNo: "123456789",
          vnp_TransactionType: body.vnp_TransactionType ?? "01",
          vnp_TransactionStatus:
            body.vnp_Command === "querydr" ? queryStatus : "00",
          vnp_PayDate: formatVnpayDate(new Date()),
          vnp_BankCode: "NCB",
          vnp_OrderInfo: body.vnp_OrderInfo!,
        };
        if (body.vnp_Command === "refund") {
          providerRefunds.set(body.vnp_TxnRef!, result);
          if (loseRefundResponse) {
            loseRefundResponse = false;
            req.socket.destroy();
            return;
          }
        } else if (!hideRefundEvidence && providerRefunds.has(body.vnp_TxnRef!))
          result = {
            ...providerRefunds.get(body.vnp_TxnRef!)!,
            vnp_Command: "querydr",
          };
        const response = signResponse({
          ...result,
          ...(body.vnp_Command === "querydr"
            ? { vnp_PromotionCode: "W04PROMO", vnp_PromotionAmount: "100" }
            : {}),
        });
        if (tamperPromotion) response.vnp_PromotionAmount = "999";
        const responseBody: Record<string, string | number> = { ...response };
        if (numericAmount)
          responseBody.vnp_Amount = Number(response.vnp_Amount);
        if (tamper) response.vnp_SecureHash = "0".repeat(128);
        res.writeHead(200, { "content-type": "application/json" });
        responseBody.vnp_SecureHash = response.vnp_SecureHash!;
        res.end(JSON.stringify(responseBody));
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
    await new Promise<void>((resolve) =>
      provider.listen(0, "127.0.0.1", resolve),
    );
    const address = provider.address();
    assert.ok(address && typeof address !== "string");
    env.VNPAY_API_URL = `http://127.0.0.1:${address.port}/transaction`;
    process.env.RESEND_API_URL = `http://127.0.0.1:${address.port}/emails`;
    const rows = await db
      .insert(users)
      .values(
        ["organizer", "buyer", "other"].map((r) => ({
          email: `w04-${r}-${randomUUID()}@example.com`,
          fullName: r,
          passwordHash: "test-only",
          role: r === "organizer" ? ("ORGANIZER" as const) : ("BUYER" as const),
          status: "ACTIVE" as const,
        })),
      )
      .returning();
    createdUsers.push(...rows.map((u) => u.id));
    buyer = rows[1]!.id;
    other = rows[2]!.id;
    const [org] = await db
      .insert(organizerProfiles)
      .values({
        userId: rows[0]!.id,
        organizationName: "W04",
        representativeName: "W04",
        taxCode: randomUUID(),
        businessLicenseUrl: "https://example.com/license",
      })
      .returning();
    organizerId = org!.id;
    const cache = new EventReadCacheService(redis, new EventsService());
    const stream = new SeatStreamService(redis);
    const ipnService = new VnpayIpnService(cache, stream);
    app = await NestFactory.create<NestFastifyApplication>(
      {
        module: PaymentTestModule,
        controllers: [PaymentController, VnpayIpnController, RefundsController],
        providers: [
          { provide: JwtService, useValue: jwt },
          { provide: SeatStreamService, useValue: stream },
          { provide: RefundsService, useValue: new RefundsService() },
          { provide: JwtAuthGuard, useValue: new JwtAuthGuard(jwt) },
          { provide: PaymentService, useValue: new PaymentService() },
          { provide: VnpayIpnService, useValue: ipnService },
          {
            provide: VnpayQueryService,
            useValue: new VnpayQueryService(api, ipnService),
          },
        ],
      },
      new FastifyAdapter(),
      { logger: false },
    );
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });

  after(async () => {
    await app?.close();
    await api.onModuleDestroy();
    await new Promise<void>((resolve) => provider?.close(() => resolve()));
    if (createdUsers.length)
      await db
        .delete(idempotencyKeys)
        .where(inArray(idempotencyKeys.userId, createdUsers));
    if (createdOrders.length) {
      await db
        .delete(outbox)
        .where(
          inArray(sql<string>`${outbox.payload}->>'orderId'`, createdOrders),
        );
      await db.delete(refunds).where(inArray(refunds.orderId, createdOrders));
      await db.delete(tickets).where(inArray(tickets.orderId, createdOrders));
      await db
        .delete(transactions)
        .where(inArray(transactions.orderId, createdOrders));
      await db
        .delete(orderItems)
        .where(inArray(orderItems.orderId, createdOrders));
      await db.delete(seats).where(inArray(seats.eventId, createdEvents));
      await db.delete(orders).where(inArray(orders.id, createdOrders));
      await db.delete(events).where(inArray(events.id, createdEvents));
      await db
        .delete(organizerProfiles)
        .where(eq(organizerProfiles.id, organizerId));
      await db.delete(users).where(inArray(users.id, createdUsers));
    }
    redis.disconnect();
    await sqlClient.end();
  });

  it("URL/idempotency: 10 request dong thoi chi tao mot transaction va cung URL", async () => {
    const f = await fixture();
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        http(
          `/api/v1/payments/orders/${f.order.id}/vnpay`,
          "POST",
          { amount: 1 },
          buyer,
          key,
        ),
      ),
    );
    assert.ok(
      results.every((r) => r.status === 201),
      JSON.stringify(results),
    );
    assert.equal(new Set(results.map((r) => r.body.data.paymentUrl)).size, 1);
    assert.equal(
      new URL(results[0]!.body.data.paymentUrl).searchParams.get("vnp_Amount"),
      "10000000",
    );
    assert.equal(
      (
        await db
          .select()
          .from(transactions)
          .where(eq(transactions.orderId, f.order.id))
      ).length,
      1,
    );
    const second = await fixture();
    assert.equal(
      (
        await http(
          `/api/v1/payments/orders/${second.order.id}/vnpay`,
          "POST",
          {},
          buyer,
          key,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await http(
          `/api/v1/payments/orders/${second.order.id}/vnpay`,
          "POST",
          {},
          other,
        )
      ).status,
      404,
    );
  });

  it("Tong tien/voucher phai nhat quan va don con han", async () => {
    const f = await fixture();
    await db
      .update(orders)
      .set({ finalAmount: "1" })
      .where(eq(orders.id, f.order.id));
    assert.equal((await payment(f.order.id)).status, 409);
    await db
      .update(orders)
      .set({
        finalAmount: "90000",
        discountAmount: "10000",
        voucherCode: "SERVER_APPROVED",
      })
      .where(eq(orders.id, f.order.id));
    const result = await payment(f.order.id);
    assert.equal(
      new URL(result.body.data.paymentUrl).searchParams.get("vnp_Amount"),
      "9000000",
    );
    const expired = await fixture({ expired: true });
    assert.equal((await payment(expired.order.id)).status, 409);
  });

  it("IPN sai chu ky/so tien khong thay doi don; callback lap chi cap ve mot lan", async () => {
    const f = await fixture();
    const pay = await payment(f.order.id);
    const ref = pay.body.data.transactionRef;
    const invalid = await http(
      `/api/v1/payments/vnpay/ipn?vnp_TxnRef=${ref}&vnp_SecureHash=invalid`,
      "GET",
    );
    assert.equal(invalid.body.RspCode, "97");
    assert.equal((await ipn(ref, { vnp_Amount: "100" })).body.RspCode, "04");
    assert.equal((await orderState(f.order.id))?.status, OrderStatus.PENDING);
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => ipn(ref)),
    );
    assert.equal(responses.filter((r) => r.body.RspCode === "00").length, 1);
    assert.equal(responses.filter((r) => r.body.RspCode === "02").length, 9);
    assert.equal(
      (await db.select().from(tickets).where(eq(tickets.orderId, f.order.id)))
        .length,
      1,
    );
    assert.equal((await orderState(f.order.id))?.status, OrderStatus.PAID);
    const paid = await eventFor(f.order.id, "ORDER_PAID");
    await processPaymentOutboxOnce(api, paid.id);
    assert.equal(
      (await db.query.outbox.findFirst({ where: eq(outbox.id, paid.id) }))
        ?.status,
      OutboxStatus.COMPLETED,
    );
    assert.match(emailCalls.at(-1)!.text, /Ma ve:/);
  });

  it("QueryDR doi soat giao dich thanh cong, chan IDOR va phan hoi gia/sai tien", async () => {
    const f = await fixture();
    await payment(f.order.id);
    const path = `/api/v1/payments/orders/${f.order.id}/vnpay/query`;
    const before = providerCalls.length;
    assert.equal((await http(path, "POST", {}, other)).status, 404);
    assert.equal(providerCalls.length, before);
    tamper = true;
    assert.equal((await http(path)).status, 503);
    tamper = false;
    assert.equal((await orderState(f.order.id))?.status, OrderStatus.PENDING);
    wrongAmount = true;
    assert.equal((await http(path)).body.data.decision, "AMOUNT_MISMATCH");
    wrongAmount = false;
    assert.equal((await http(path)).body.data.decision, "APPLY_SUCCESS");
    assert.equal((await http(path)).body.data.decision, "ALREADY_PROCESSED");
  });

  it("IPN that bai tra ton kho va khong gui email cap ve", async () => {
    const f = await fixture();
    const pay = await payment(f.order.id);
    const result = await ipn(pay.body.data.transactionRef, {
      vnp_ResponseCode: "24",
      vnp_TransactionStatus: "02",
    });
    assert.equal(result.body.RspCode, "00");
    assert.equal((await orderState(f.order.id))?.status, OrderStatus.FAILED);
    assert.equal(
      (
        await db.query.ticketTypes.findFirst({
          where: eq(ticketTypes.id, f.type.id),
        })
      )?.heldCount,
      0,
    );
    assert.equal(
      (await db.select().from(tickets).where(eq(tickets.orderId, f.order.id)))
        .length,
      0,
    );
  });

  it("IPN muon khoi phuc ve GA va ghe ngoi neu van con trong", async () => {
    for (const seated of [false, true]) {
      const f = await fixture({ expired: true, seated });
      const tx = await originalPayment(f.order.id);
      assert.equal((await ipn(tx.transactionRef)).body.RspCode, "00");
      assert.equal((await orderState(f.order.id))?.status, OrderStatus.PAID);
      assert.equal(
        (await db.select().from(tickets).where(eq(tickets.orderId, f.order.id)))
          .length,
        1,
      );
      assert.equal((await ipn(tx.transactionRef)).body.RspCode, "02");
    }
  });

  it("IPN muon mat ghe: tao dung mot refund, worker hoan tien va thong bao", async () => {
    const f = await fixture({ expired: true, seated: true, lost: true });
    const tx = await originalPayment(f.order.id);
    const subscriber = redis.duplicate();
    await subscriber.subscribe(`events:${f.order.eventId}:seats`);
    try {
      const message = once(subscriber, "message", {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal((await ipn(tx.transactionRef)).body.RspCode, "00");
      const [, raw] = await message;
      const update = JSON.parse(String(raw));
      assert.equal(
        update.status,
        "SOLD",
        "Ghe da ban cho don khac khong duoc phat AVAILABLE",
      );
      assert.deepEqual(update.seatIds, [f.seatId]);
    } finally {
      subscriber.disconnect();
    }
    assert.equal(
      (await orderState(f.order.id))?.status,
      OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
    );
    assert.equal((await ipn(tx.transactionRef)).body.RspCode, "02");
    const refundRows = await db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, f.order.id));
    assert.equal(refundRows.length, 1);
    const event = await eventFor(f.order.id, "REFUND_REQUESTED");
    await Promise.all([
      processPaymentOutboxOnce(api, event.id),
      processPaymentOutboxOnce(api, event.id),
    ]);

    assert.equal(
      (
        await db.query.refunds.findFirst({
          where: eq(refunds.id, refundRows[0]!.id),
        })
      )?.status,
      RefundStatus.COMPLETED,
    );
    assert.equal((await orderState(f.order.id))?.status, OrderStatus.REFUNDED);
    assert.equal(
      providerCalls.filter(
        (p) => p.vnp_Command === "refund" && p.vnp_TxnRef === tx.transactionRef,
      ).length,
      1,
    );
    const notification = await eventFor(f.order.id, "REFUND_COMPLETED");
    await processPaymentOutboxOnce(api, notification.id);
    assert.match(emailCalls.at(-1)!.text, /hoan lai tien/);
  });

  it("Refund timeout sau khi provider nhan: retry bang QueryDR, tuyet doi khong refund lan hai", async () => {
    const f = await fixture({ expired: true, lost: true });
    const tx = await originalPayment(f.order.id);
    await ipn(tx.transactionRef);
    const event = await eventFor(f.order.id, "REFUND_REQUESTED");
    loseRefundResponse = true;
    await processPaymentOutboxOnce(api, event.id);
    const pending = await db.query.outbox.findFirst({
      where: eq(outbox.id, event.id),
    });
    assert.equal(pending?.status, OutboxStatus.PENDING);
    assert.equal(pending.retryCount, 1);
    assert.ok(pending.nextRetryAt.getTime() > Date.now());
    assert.equal(
      (await orderState(f.order.id))?.status,
      OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
    );
    await db
      .update(outbox)
      .set({ nextRetryAt: new Date() })
      .where(eq(outbox.id, event.id));
    await processPaymentOutboxOnce(api, event.id);
    assert.equal((await orderState(f.order.id))?.status, OrderStatus.REFUNDED);
    assert.equal(
      providerCalls.filter(
        (p) => p.vnp_Command === "refund" && p.vnp_TxnRef === tx.transactionRef,
      ).length,
      1,
    );
  });

  it("Email loi: retry cung idempotency key va chi danh dau COMPLETED sau khi chap nhan", async () => {
    const f = await fixture();
    const pay = await payment(f.order.id);
    await ipn(pay.body.data.transactionRef);
    const event = await eventFor(f.order.id, "ORDER_PAID");
    emailFailure = true;
    await processPaymentOutboxOnce(api, event.id);
    emailFailure = false;
    assert.equal(
      (await db.query.outbox.findFirst({ where: eq(outbox.id, event.id) }))
        ?.status,
      OutboxStatus.PENDING,
    );
    await db
      .update(outbox)
      .set({ nextRetryAt: new Date() })
      .where(eq(outbox.id, event.id));
    await processPaymentOutboxOnce(api, event.id);
    assert.equal(
      (await db.query.outbox.findFirst({ where: eq(outbox.id, event.id) }))
        ?.status,
      OutboxStatus.COMPLETED,
    );
    assert.equal(emailCalls.at(-1)!.key, emailCalls.at(-2)!.key);
  });
  it("IPN muon truoc cleanup van chuyen held sang sold dung mot lan", async () => {
    const f = await fixture();
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, f.order.id));
    const tx = await originalPayment(f.order.id);
    assert.equal((await ipn(tx.transactionRef)).body.RspCode, "00");
    const inventory = await db.query.ticketTypes.findFirst({
      where: eq(ticketTypes.id, f.type.id),
    });
    assert.equal(inventory?.heldCount, 0);
    assert.equal(inventory?.soldCount, 1);
  });

  it("IPN muon don hon hop: mat kho GA rollback ghe da khoi phuc, roi tao refund day du", async () => {
    const f = await fixture({ expired: true, seated: true });
    const [ga] = await db
      .insert(ticketTypes)
      .values({
        eventId: f.order.eventId,
        name: "GA het ve",
        price: "100000",
        capacity: 1,
        soldCount: 1,
        isSeated: false,
        saleStartTime: new Date(),
        saleEndTime: new Date(Date.now() + 86400000),
      })
      .returning();
    await db.insert(orderItems).values({
      orderId: f.order.id,
      ticketTypeId: ga!.id,
      quantity: 1,
      unitPrice: "100000",
      subtotal: "100000",
    });
    await db
      .update(orders)
      .set({ totalAmount: "200000", finalAmount: "200000" })
      .where(eq(orders.id, f.order.id));
    const tx = await originalPayment(f.order.id);
    await db
      .update(transactions)
      .set({ amount: "200000" })
      .where(eq(transactions.id, tx.id));
    assert.equal(
      (await ipn(tx.transactionRef, { vnp_Amount: "20000000" })).body.RspCode,
      "00",
    );
    assert.equal(
      (await db.query.seats.findFirst({ where: eq(seats.id, f.seatId!) }))
        ?.status,
      SeatStatus.AVAILABLE,
    );
    assert.equal(
      (await orderState(f.order.id))?.status,
      OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
    );
    assert.equal(
      (await db.select().from(tickets).where(eq(tickets.orderId, f.order.id)))
        .length,
      0,
    );
    assert.equal(
      Number(
        (
          await db.query.refunds.findFirst({
            where: eq(refunds.orderId, f.order.id),
          })
        )?.amount,
      ),
      200000,
    );
  });

  it("QueryDR thanh toan that bai tra kho; trang thai chua ket thuc khong cap ve", async () => {
    const f = await fixture();
    await payment(f.order.id);
    const path = `/api/v1/payments/orders/${f.order.id}/vnpay/query`;
    try {
      queryStatus = "01";
      assert.equal((await http(path)).body.data.decision, "MANUAL_REVIEW");
      assert.equal((await orderState(f.order.id))?.status, OrderStatus.PENDING);
      queryStatus = "02";
      assert.equal((await http(path)).body.data.decision, "RECORD_FAILURE");
      assert.equal((await orderState(f.order.id))?.status, OrderStatus.FAILED);
    } finally {
      queryStatus = "00";
    }
  });

  it("Refund QueryDR chua chung minh hoan tien khong duoc danh dau COMPLETED hay gui lai refund", async () => {
    const f = await fixture({ expired: true, lost: true });
    const tx = await originalPayment(f.order.id);
    await ipn(tx.transactionRef);
    const event = await eventFor(f.order.id, "REFUND_REQUESTED");
    try {
      loseRefundResponse = true;
      await processPaymentOutboxOnce(api, event.id);
      hideRefundEvidence = true;
      await db
        .update(outbox)
        .set({ nextRetryAt: new Date() })
        .where(eq(outbox.id, event.id));
      await processPaymentOutboxOnce(api, event.id);
      assert.equal(
        (await orderState(f.order.id))?.status,
        OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
      );
      const refund = await db.query.refunds.findFirst({
        where: eq(refunds.orderId, f.order.id),
      });
      assert.equal(refund?.status, RefundStatus.PROCESSING);
      assert.equal(
        providerCalls.filter(
          (p) =>
            p.vnp_Command === "refund" && p.vnp_TxnRef === tx.transactionRef,
        ).length,
        1,
      );
    } finally {
      hideRefundEvidence = false;
    }
  });
  it("Adapter refund tu nguyen chi nhan ve da thu hoi; hoan mot phan khong doi PAID thanh REFUNDED", async () => {
    const f = await fixture();
    const pay = await payment(f.order.id);
    await ipn(pay.body.data.transactionRef);
    const issued = await db.query.tickets.findFirst({
      where: eq(tickets.orderId, f.order.id),
    });
    assert.ok(issued);
    const [refund] = await db
      .insert(refunds)
      .values({
        orderId: f.order.id,
        ticketId: issued.id,
        amount: "50000",
        reason: "BUYER_CANCELLATION_APPROVED",
        idempotencyKey: `ticket:${issued.id}`,
      })
      .returning();
    const [event] = await db
      .insert(outbox)
      .values({
        eventType: "REFUND_REQUESTED",
        payload: { orderId: f.order.id, refundId: refund!.id },
      })
      .returning();
    const callsBefore = providerCalls.length;
    await processPaymentOutboxOnce(api, event!.id);
    assert.equal(providerCalls.length, callsBefore);
    assert.equal(
      (await db.query.refunds.findFirst({ where: eq(refunds.id, refund!.id) }))
        ?.status,
      RefundStatus.PENDING,
    );
    // Fixture dai dien transaction huy ve do BE1 phu trach, khong mock nghiep vu refund.
    await db
      .update(tickets)
      .set({ status: "CANCELLED" })
      .where(eq(tickets.id, issued.id));
    await db
      .update(outbox)
      .set({ nextRetryAt: new Date() })
      .where(eq(outbox.id, event!.id));
    await processPaymentOutboxOnce(api, event!.id);
    assert.equal(
      (await db.query.refunds.findFirst({ where: eq(refunds.id, refund!.id) }))
        ?.status,
      RefundStatus.COMPLETED,
    );
    assert.equal((await orderState(f.order.id))?.status, OrderStatus.PAID);
    assert.equal(providerCalls.at(-1)?.vnp_TransactionType, "03");
    assert.equal(providerCalls.at(-1)?.vnp_Amount, "5000000");
  });
  it("Tich hop UC06 -> worker VNPay: hoan toan bo don REFUNDED va giu gia luc mua", async () => {
    const f = await fixture();
    const pay = await payment(f.order.id);
    await ipn(pay.body.data.transactionRef);
    const issued = await db.query.tickets.findFirst({
      where: eq(tickets.orderId, f.order.id),
    });
    assert.ok(issued);
    await db
      .update(ticketTypes)
      .set({ price: "1" })
      .where(eq(ticketTypes.id, f.type.id));
    const body = {
      orderId: f.order.id,
      ticketIds: [issued.id],
      reason: "Buyer cancellation",
    };
    const preview = await http("/api/v1/refund/preview", "POST", body);
    assert.equal(preview.status, 201, JSON.stringify(preview.body));
    assert.equal(preview.body.totalRefundAmount, 100000);
    const key = randomUUID();
    const cancelled = await http(
      "/api/v1/refund/request",
      "POST",
      body,
      buyer,
      key,
    );
    assert.equal(cancelled.status, 201, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.refundAmount, 100000);
    assert.equal((await orderState(f.order.id))?.status, OrderStatus.REFUNDED);
    const event = await eventFor(f.order.id, "REFUND_REQUESTED");
    assert.ok(event);
    await processPaymentOutboxOnce(api, event.id);
    const saved = await db.query.refunds.findFirst({
      where: eq(refunds.id, cancelled.body.refundIds[0]),
    });
    assert.equal(saved?.status, RefundStatus.COMPLETED);
    assert.equal(
      (await db.query.outbox.findFirst({ where: eq(outbox.id, event.id) }))
        ?.status,
      OutboxStatus.COMPLETED,
    );
    const sent = providerCalls.filter(
      (p) =>
        p.vnp_Command === "refund" &&
        p.vnp_TxnRef === pay.body.data.transactionRef,
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.vnp_Amount, "10000000");
    const replay = await http(
      "/api/v1/refund/request",
      "POST",
      body,
      buyer,
      key,
    );
    assert.deepEqual(replay.body, cancelled.body);
    assert.equal(
      (
        await http(
          "/api/v1/refund/request",
          "POST",
          { orderId: "invalid" },
          buyer,
          randomUUID(),
        )
      ).status,
      400,
    );
  });
  it("Hoan ca don 3 ve: mot giao dich 02, retry QueryDR khong gui lai va hoan tat dong thoi ca nhom", async () => {
    const f = await fixture({ quantity: 3 });
    const pay = await payment(f.order.id);
    assert.equal(
      (await ipn(pay.body.data.transactionRef, { vnp_Amount: "30000000" })).body
        .RspCode,
      "00",
    );
    const issued = await db
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, f.order.id));
    assert.equal(issued.length, 3);
    const body = {
      orderId: f.order.id,
      ticketIds: issued.map((row) => row.id),
      reason: "Huy ca don nhieu ve",
    };
    const key = randomUUID();
    const response = await http(
      "/api/v1/refund/request",
      "POST",
      body,
      buyer,
      key,
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const event = await eventFor(f.order.id, "REFUND_REQUESTED");
    loseRefundResponse = true;
    await processPaymentOutboxOnce(api, event.id);
    const pending = await db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, f.order.id));
    assert.equal(pending.length, 3);
    assert.ok(pending.every((row) => row.status === RefundStatus.PROCESSING));
    assert.equal(new Set(pending.map((row) => row.providerGroupId)).size, 1);
    assert.equal(pending.filter((row) => row.providerRequestId).length, 1);
    await db
      .update(outbox)
      .set({ nextRetryAt: new Date() })
      .where(eq(outbox.id, event.id));
    await Promise.all(
      Array.from({ length: 5 }, () => processPaymentOutboxOnce(api, event.id)),
    );
    const saved = await db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, f.order.id));
    assert.ok(saved.every((row) => row.status === RefundStatus.COMPLETED));
    const calls = providerCalls.filter(
      (row) => row.vnp_TxnRef === pay.body.data.transactionRef,
    );
    assert.equal(calls.filter((row) => row.vnp_Command === "refund").length, 1);
    assert.equal(
      calls.find((row) => row.vnp_Command === "refund")?.vnp_TransactionType,
      "02",
    );
    assert.equal(
      calls.find((row) => row.vnp_Command === "refund")?.vnp_Amount,
      "30000000",
    );
    assert.ok(calls.some((row) => row.vnp_Command === "querydr"));
    assert.equal(
      (
        await db
          .select()
          .from(outbox)
          .where(
            and(
              eq(outbox.eventType, "REFUND_COMPLETED"),
              sql`${outbox.payload}->>'orderId' = ${f.order.id}`,
            ),
          )
      ).length,
      1,
    );
    assert.deepEqual(
      (await http("/api/v1/refund/request", "POST", body, buyer, key)).body,
      response.body,
    );
  });

  it("Hoan tung dot don 3 ve: 1 ve roi 2 ve deu la 03, tong tien khong vuot giao dich goc", async () => {
    const f = await fixture({ quantity: 3 });
    const pay = await payment(f.order.id);
    await ipn(pay.body.data.transactionRef, { vnp_Amount: "30000000" });
    const issued = await db
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, f.order.id));
    for (const ticketIds of [
      [issued[0]!.id],
      issued.slice(1).map((row) => row.id),
    ]) {
      const response = await http(
        "/api/v1/refund/request",
        "POST",
        { orderId: f.order.id, ticketIds, reason: "Huy mot phan" },
        buyer,
        randomUUID(),
      );
      assert.equal(response.status, 201, JSON.stringify(response.body));
      const events = await db
        .select()
        .from(outbox)
        .where(
          and(
            eq(outbox.eventType, "REFUND_REQUESTED"),
            eq(outbox.status, OutboxStatus.PENDING),
            sql`${outbox.payload}->>'orderId' = ${f.order.id}`,
          ),
        );
      assert.equal(events.length, 1);
      await processPaymentOutboxOnce(api, events[0]!.id);
    }
    const sent = providerCalls.filter(
      (row) =>
        row.vnp_Command === "refund" &&
        row.vnp_TxnRef === pay.body.data.transactionRef,
    );
    assert.deepEqual(
      sent.map((row) => [row.vnp_TransactionType, row.vnp_Amount]),
      [
        ["03", "10000000"],
        ["03", "20000000"],
      ],
    );
    assert.ok(
      (
        await db.select().from(refunds).where(eq(refunds.orderId, f.order.id))
      ).every((row) => row.status === RefundStatus.COMPLETED),
    );
  });

  it("IPN thanh cong tren don CANCELLED hoac su kien SUSPENDED/CANCELLED tu dong hoan tien, khong cap ve", async () => {
    for (const state of [
      "ORDER_CANCELLED",
      "SUSPENDED",
      "CANCELLED",
    ] as const) {
      const f = await fixture();
      const pay = await payment(f.order.id);
      if (state === "ORDER_CANCELLED") {
        await db
          .update(orders)
          .set({ status: OrderStatus.CANCELLED })
          .where(eq(orders.id, f.order.id));
        await db
          .update(ticketTypes)
          .set({ heldCount: 0 })
          .where(eq(ticketTypes.id, f.type.id));
      } else
        await db
          .update(events)
          .set({ status: state })
          .where(eq(events.id, f.order.eventId));
      const first = await ipn(pay.body.data.transactionRef);
      assert.equal(first.body.RspCode, "00", JSON.stringify(first.body));
      assert.equal(
        (await orderState(f.order.id))?.status,
        OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
      );
      assert.equal(
        (await ipn(pay.body.data.transactionRef)).body.RspCode,
        "02",
      );
      assert.equal(
        (await db.select().from(tickets).where(eq(tickets.orderId, f.order.id)))
          .length,
        0,
      );
      const event = await eventFor(f.order.id, "REFUND_REQUESTED");
      await processPaymentOutboxOnce(api, event.id);
      assert.equal(
        (await orderState(f.order.id))?.status,
        OrderStatus.REFUNDED,
      );
      const sent = providerCalls.filter(
        (row) =>
          row.vnp_Command === "refund" &&
          row.vnp_TxnRef === pay.body.data.transactionRef,
      );
      assert.equal(sent.length, 1);
      assert.equal(sent[0]?.vnp_TransactionType, "02");
      const type = await db.query.ticketTypes.findFirst({
        where: eq(ticketTypes.id, f.type.id),
      });
      assert.equal(type?.heldCount, 0);
      assert.equal(type?.soldCount, 0);
    }
  });

  it("QueryDR dung IP merchant cau hinh, khong dung IP buyer", async () => {
    const f = await fixture();
    const pay = await payment(f.order.id);
    const previous = env.VNPAY_REFUND_IP;
    env.VNPAY_REFUND_IP = "203.0.113.10";
    try {
      const response = await http(
        `/api/v1/payments/orders/${f.order.id}/vnpay/query`,
      );
      assert.equal(response.status, 201);
      const sent = providerCalls.findLast(
        (row) =>
          row.vnp_Command === "querydr" &&
          row.vnp_TxnRef === pay.body.data.transactionRef,
      );
      assert.equal(sent?.vnp_IpAddr, "203.0.113.10");
    } finally {
      env.VNPAY_REFUND_IP = previous;
    }
  });
  it("Refund legacy dang PROCESSING duoc doi soat rieng truoc khi gom cac ve chua gui", async () => {
    const f = await fixture({ quantity: 3 });
    const pay = await payment(f.order.id);
    await ipn(pay.body.data.transactionRef, { vnp_Amount: "30000000" });
    const issued = await db
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, f.order.id));
    const response = await http(
      "/api/v1/refund/request",
      "POST",
      {
        orderId: f.order.id,
        ticketIds: issued.map((row) => row.id),
        reason: "Legacy interrupted worker",
      },
      buyer,
      randomUUID(),
    );
    assert.equal(response.status, 201);
    const original = await eventFor(f.order.id, "REFUND_REQUESTED");
    const [legacyEvent] = await db
      .insert(outbox)
      .values({
        eventType: "REFUND_REQUESTED",
        payload: { orderId: f.order.id, refundId: response.body.refundIds[0] },
      })
      .returning();
    loseRefundResponse = true;
    await processPaymentOutboxOnce(api, legacyEvent!.id);
    // Metadata đúng dạng worker cũ: có request ID nhưng chưa có cột nhóm.
    await db
      .update(refunds)
      .set({ providerGroupId: null, providerAmount: null })
      .where(eq(refunds.id, response.body.refundIds[0]));
    await processPaymentOutboxOnce(api, original.id);
    const saved = await db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, f.order.id));
    assert.ok(saved.every((row) => row.status === RefundStatus.COMPLETED));
    const sent = providerCalls.filter(
      (row) =>
        row.vnp_Command === "refund" &&
        row.vnp_TxnRef === pay.body.data.transactionRef,
    );
    assert.deepEqual(
      sent.map((row) => [row.vnp_TransactionType, row.vnp_Amount]),
      [
        ["03", "10000000"],
        ["03", "20000000"],
      ],
    );
    await db
      .update(outbox)
      .set({ nextRetryAt: new Date() })
      .where(eq(outbox.id, legacyEvent!.id));
    const calls = providerCalls.length;
    await processPaymentOutboxOnce(api, legacyEvent!.id);
    assert.equal(providerCalls.length, calls);
  });

  it("Huy tat ca ve nhung chinh sach chi hoan 50% van gui 03", async () => {
    const f = await fixture({ quantity: 3 });
    const pay = await payment(f.order.id);
    await ipn(pay.body.data.transactionRef, { vnp_Amount: "30000000" });
    await db
      .update(events)
      .set({ startTime: new Date(Date.now() + 5 * 86400000) })
      .where(eq(events.id, f.order.eventId));
    const issued = await db
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, f.order.id));
    const response = await http(
      "/api/v1/refund/request",
      "POST",
      {
        orderId: f.order.id,
        ticketIds: issued.map((row) => row.id),
        reason: "Huy theo chinh sach 50%",
      },
      buyer,
      randomUUID(),
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.refundAmount, 150000);
    assert.equal(response.body.orderStatus, OrderStatus.REFUNDED);
    await processPaymentOutboxOnce(
      api,
      (await eventFor(f.order.id, "REFUND_REQUESTED")).id,
    );
    const sent = providerCalls.filter(
      (row) =>
        row.vnp_Command === "refund" &&
        row.vnp_TxnRef === pay.body.data.transactionRef,
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.vnp_TransactionType, "03");
    assert.equal(sent[0]?.vnp_Amount, "15000000");
  });

  it("Su kien SUSPENDED nhung IPN thieu metadata hoac sai tien khong duoc cap ve/tao refund", async () => {
    const f = await fixture();
    const pay = await payment(f.order.id);
    await db
      .update(events)
      .set({ status: "SUSPENDED" })
      .where(eq(events.id, f.order.eventId));
    await db
      .update(transactions)
      .set({ vnpCreateDate: null })
      .where(eq(transactions.orderId, f.order.id));
    assert.equal((await ipn(pay.body.data.transactionRef)).body.RspCode, "99");
    assert.equal(
      (await ipn(pay.body.data.transactionRef, { vnp_Amount: "1" })).body
        .RspCode,
      "04",
    );
    assert.equal(
      (await db.select().from(tickets).where(eq(tickets.orderId, f.order.id)))
        .length,
      0,
    );
    assert.equal(
      (await db.select().from(refunds).where(eq(refunds.orderId, f.order.id)))
        .length,
      0,
    );
    assert.equal((await orderState(f.order.id))?.status, OrderStatus.PENDING);
  });
  it("QueryDR ky ca PromotionCode/Amount va chap nhan so tien JSON integer", async () => {
    const f = await fixture();
    await payment(f.order.id);
    const path = `/api/v1/payments/orders/${f.order.id}/vnpay/query`;
    try {
      tamperPromotion = true;
      assert.equal((await http(path)).status, 503);
      assert.equal((await orderState(f.order.id))?.status, OrderStatus.PENDING);
      tamperPromotion = false;
      numericAmount = true;
      assert.equal((await http(path)).body.data.decision, "APPLY_SUCCESS");
    } finally {
      tamperPromotion = false;
      numericAmount = false;
    }
  });
  it("Handler email tat khong claim su kien hay tieu hao retry budget", async () => {
    const f = await fixture();
    const pay = await payment(f.order.id);
    await ipn(pay.body.data.transactionRef);
    const event = await eventFor(f.order.id, "ORDER_PAID");
    process.env.ENABLE_PAYMENT_EMAIL = "false";
    try {
      assert.equal(await processPaymentOutboxOnce(api, event.id), false);
      const saved = await db.query.outbox.findFirst({
        where: eq(outbox.id, event.id),
      });
      assert.equal(saved?.status, OutboxStatus.PENDING);
      assert.equal(saved.retryCount, 0);
    } finally {
      process.env.ENABLE_PAYMENT_EMAIL = "true";
    }
  });
});
