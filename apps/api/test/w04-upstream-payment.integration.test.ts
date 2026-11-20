import "reflect-metadata";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { eq, inArray, sql } from "drizzle-orm";
import { env } from "../src/config/env.config";
import { db, sqlClient } from "../src/database/db";
import {
  events,
  orderItems,
  orders,
  outbox,
  ticketTypes,
  tickets,
  transactions,
  users,
} from "../src/database/schema";
import { CreateVnpayPaymentUseCase } from "../src/contexts/payment/application/create-vnpay-payment.use-case";
import { QueryVnpayPaymentUseCase } from "../src/contexts/payment/application/query-vnpay-payment.use-case";
import { VNPAY_RESPONSE_FIELDS } from "../src/contexts/payment/infrastructure/vnpay-query.gateway";
import { PaymentController } from "../src/contexts/payment/interface/payment.controller";
import { createPaymentUseCases } from "../src/contexts/payment/payment.composition";

import Redis from "ioredis";
import { createVnpayQueryLimit } from "../src/contexts/payment/infrastructure/redis-vnpay-query-limit";

const jwt = new JwtService({ secret: env.JWT_SECRET });
const redis = new Redis(env.REDIS_URL, { lazyConnect: true });
const payments = createPaymentUseCases(undefined, undefined, {
  takeQuerySlot: createVnpayQueryLimit(redis),
});
@Module({
  controllers: [PaymentController],
  providers: [
    { provide: JwtService, useValue: jwt },
    { provide: CreateVnpayPaymentUseCase, useValue: payments.createPayment },
    { provide: QueryVnpayPaymentUseCase, useValue: payments.queryVnpay },
  ],
})
class PaymentTestModule {}

test("W04 upstream: kiểm giá và idempotency, tra cứu chủ đơn, chỉ chốt bằng QueryDR đã ký", async () => {
  assert.match(new URL(env.DATABASE_URL).pathname, /_test$/);
  const [buyer] = await db.select({ id: users.id }).from(users).limit(1);
  const [event] = await db.select({ id: events.id }).from(events).limit(1);
  assert.ok(buyer && event);
  const now = Date.now();
  const ids = [randomUUID(), randomUUID()];
  let typeId: string | undefined;
  let app: NestFastifyApplication | undefined;
  const settings = {
    NODE_ENV: env.NODE_ENV,
    VNPAY_TMN_CODE: env.VNPAY_TMN_CODE,
    VNPAY_HASH_SECRET: env.VNPAY_HASH_SECRET,
    VNPAY_API_URL: env.VNPAY_API_URL,
    VNPAY_REFUND_IP: env.VNPAY_REFUND_IP,
  };
  const merchant = "W04TEST";
  const secret = "local-gateway-test-only";
  let invalid = true;
  const queryIps: string[] = [];
  const merchantIp = "192.0.2.8";
  const rateKey = `payment:querydr:${buyer.id}`;
  const vendor = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      const request = JSON.parse(body);
      queryIps.push(request.vnp_IpAddr);
      const response: Record<string, string> = {
        vnp_ResponseId: "W04QUERY",
        vnp_Command: "querydr",
        vnp_ResponseCode: "00",
        vnp_TmnCode: merchant,
        vnp_TxnRef: request.vnp_TxnRef,
        vnp_Amount: "9000000",
        vnp_TransactionNo: "1234567",
        vnp_TransactionType: "01",
        vnp_TransactionStatus: "00",
      };
      const text = [
        ...VNPAY_RESPONSE_FIELDS,
        "vnp_PromotionCode",
        "vnp_PromotionAmount",
      ]
        .map((field) => response[field] ?? "")
        .join("|");
      response.vnp_SecureHash = invalid
        ? "0".repeat(128)
        : createHmac("sha512", secret).update(text).digest("hex");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(response));
    });
  });
  try {
    await redis.del(rateKey);
    await new Promise<void>((resolve) =>
      vendor.listen(0, "127.0.0.1", resolve),
    );
    const address = vendor.address();
    assert.ok(address && typeof address !== "string");
    Object.assign(env, {
      VNPAY_REFUND_IP: undefined,
      VNPAY_TMN_CODE: merchant,
      VNPAY_HASH_SECRET: secret,
      VNPAY_API_URL: `http://127.0.0.1:${address.port}`,
    });
    const [type] = await db
      .insert(ticketTypes)
      .values({
        eventId: event.id,
        name: "W04",
        price: "100000",
        capacity: 5,
        heldCount: 2,
        isSeated: false,
        saleStartTime: new Date(now - 1000),
        saleEndTime: new Date(now + 600000),
      })
      .returning();
    typeId = type!.id;
    for (const id of ids) {
      await db.insert(orders).values({
        id,
        orderCode: "W04-" + id.slice(0, 20),
        userId: buyer.id,
        eventId: event.id,
        totalAmount: "100000",
        discountAmount: "10000",
        finalAmount: "90000",
        voucherCode: "APPROVED",
        expiresAt: new Date(now + 300000),
      });
      await db.insert(orderItems).values({
        orderId: id,
        ticketTypeId: typeId,
        quantity: 1,
        unitPrice: "100000",
        subtotal: "100000",
      });
    }
    app = await NestFactory.create<NestFastifyApplication>(
      PaymentTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    async function call(
      path: string,
      method = "GET",
      userId = buyer!.id,
      key?: string,
    ) {
      return fetch(origin + "/api/v1/payments" + path, {
        method,
        headers: {
          authorization:
            "Bearer " + (await jwt.signAsync({ sub: userId, role: "BUYER" })),
          ...(key ? { "idempotency-key": key } : {}),
        },
      });
    }
    const path = `/orders/${ids[0]}/vnpay`;
    const key = randomUUID();
    await db
      .update(orderItems)
      .set({ unitPrice: "1" })
      .where(eq(orderItems.orderId, ids[0]!));
    assert.equal((await call(path, "POST", buyer.id, key)).status, 409);
    await db
      .update(orderItems)
      .set({ unitPrice: "100000" })
      .where(eq(orderItems.orderId, ids[0]!));
    const [a, b] = await Promise.all([
      call(path, "POST", buyer.id, key),
      call(path, "POST", buyer.id, key),
    ]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const { data: first } = await a.json();
    const { data: second } = await b.json();
    assert.equal(first.paymentUrl, second.paymentUrl);
    assert.equal(
      new URL(first.paymentUrl).searchParams.get("vnp_Amount"),
      "9000000",
    );
    assert.equal(
      (await call(`/orders/${ids[1]}/vnpay`, "POST", buyer.id, key)).status,
      409,
    );
    const status = `/vnpay/status/${first.transactionRef}`;
    assert.equal((await call(status, "GET", randomUUID())).status, 404);
    assert.equal(
      (await (await call(status + "?vnp_ResponseCode=00")).json()).data
        .orderStatus,
      "PENDING",
    );
    assert.equal((await call(path + "/query", "POST")).status, 503);
    env.NODE_ENV = "production";
    env.VNPAY_REFUND_IP = "::ffff:127.0.0.1";
    assert.equal((await call(path + "/query", "POST")).status, 503);
    env.NODE_ENV = settings.NODE_ENV;
    assert.deepEqual(queryIps, []);
    env.VNPAY_REFUND_IP = merchantIp;
    assert.equal((await call(path + "/query", "POST")).status, 503);
    invalid = false;
    assert.equal(
      (await (await call(path + "/query", "POST")).json()).data.decision,
      "APPLY_SUCCESS",
    );
    assert.equal((await call(path + "/query", "POST")).status, 201);
    assert.equal((await call(path + "/query", "POST")).status, 429);
    assert.deepEqual(queryIps, [merchantIp, merchantIp, merchantIp]);
    assert.equal((await (await call(status)).json()).data.orderStatus, "PAID");
    assert.equal(
      (await db.select().from(tickets).where(eq(tickets.orderId, ids[0]!)))
        .length,
      1,
    );
  } finally {
    await redis.del(rateKey).finally(() => redis.disconnect());
    await app?.close();
    vendor.closeAllConnections();
    await new Promise<void>((resolve) => vendor.close(() => resolve()));
    Object.assign(env, settings);
    await db
      .delete(outbox)
      .where(inArray(sql<string>`${outbox.payload}->>'orderId'`, ids));
    await db.delete(tickets).where(inArray(tickets.orderId, ids));
    await db.delete(transactions).where(inArray(transactions.orderId, ids));
    await db.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await db.delete(orders).where(inArray(orders.id, ids));
    if (typeId) await db.delete(ticketTypes).where(eq(ticketTypes.id, typeId));
    await sqlClient.end();
  }
});
