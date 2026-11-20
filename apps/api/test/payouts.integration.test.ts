import "reflect-metadata";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { and, eq, inArray } from "drizzle-orm";
import { env } from "../src/config/env.config";
import { db, sqlClient } from "../src/database/db";
import {
  adminSettlementExports,
  auditLog,
  events,
  orders,
  organizerProfiles,
  payouts,
  reconciliationReports,
  reconciliationCases,
  refunds,
  transactions,
  users,
} from "../src/database/schema";
import { AdminPayoutsController } from "../src/payouts/admin-payouts.controller";
import { OrganizerPayoutsController } from "../src/payouts/organizer-payouts.controller";
import { PayoutsService } from "../src/payouts/payouts.service";
import { ReconciliationsService } from "../src/payouts/reconciliations.service";
import { processAdminSettlementExport } from "../src/reporting/admin-settlement-exports";
import { retryPayoutApproval } from "../src/payouts/approval-retry";
import { refreshReportViews } from "../src/reporting/report-data";

const jwt = new JwtService({ secret: env.JWT_SECRET });
@Module({
  controllers: [AdminPayoutsController, OrganizerPayoutsController],
  providers: [
    PayoutsService,
    ReconciliationsService,
    { provide: JwtService, useValue: jwt },
  ],
})
class SettlementTestModule {}

const header = "vnp_TxnRef,vnp_TransactionNo,vnp_Amount,vnp_TransactionType";
const csv = (...rows: string[]) => [header, ...rows].join("\r\n") + "\r\n";

describe("W06 BE2: đối soát VNPay và quyết toán UC11 qua HTTP", () => {
  const createdUsers: string[] = [];
  const createdEvents: string[] = [];
  const createdProfiles: string[] = [];
  let app: NestFastifyApplication;
  let base: string;
  let admin: string;
  let buyer: string;
  let organizer: string;
  let otherOrganizer: string;
  let eventId: string;
  let otherEvent: string;
  let orderId: string;
  let paymentRef: string;
  let paymentNumber: string;
  let refundNumber: string;
  let report: string;
  const now = new Date();
  const reconciliation = new ReconciliationsService();

  async function http(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      actor?: string;
      role?: string;
    } = {},
  ) {
    return fetch(base + "/api/v1" + path, {
      method: options.method ?? "GET",
      headers: {
        authorization:
          "Bearer " +
          (await jwt.signAsync({
            sub: options.actor ?? admin,
            role: options.role ?? "ADMIN",
          })),
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  }

  async function makeUser(role: "ADMIN" | "ORGANIZER" | "BUYER") {
    const [created] = await db
      .insert(users)
      .values({
        email: `w06-${randomUUID()}@example.com`,
        fullName: "UC11 Fixture",
        phone: "0912345678",
        passwordHash: "test",
        role,
        status: "ACTIVE",
      })
      .returning({ id: users.id });
    createdUsers.push(created!.id);
    return created!.id;
  }

  async function makeEvent(owner: string, endTime: Date) {
    const [profile] = await db
      .insert(organizerProfiles)
      .values({
        userId: owner,
        organizationName: "UC11 Organizer",
        taxCode: randomUUID(),
        businessLicenseUrl: "https://example.com/license",
        representativeName: "UC11",
        status: "VERIFIED",
      })
      .returning({ id: organizerProfiles.id });
    createdProfiles.push(profile!.id);
    const [event] = await db
      .insert(events)
      .values({
        organizerId: profile!.id,
        title: "UC11 Event",
        slug: `w06-${randomUUID()}`,
        description: "UC11",
        category: "CONCERT",
        bannerUrl: "https://example.com/event",
        venueName: "UC11",
        venueAddress: "UC11",
        city: "+UC11",
        startTime: new Date(now.getTime() - 86_400_000),
        endTime,
        gateOpeningTime: now,
        status: "PUBLISHED",
      })
      .returning({ id: events.id });
    createdEvents.push(event!.id);
    return event!.id;
  }

  before(async () => {
    assert.match(new URL(env.DATABASE_URL).pathname, /_test$/);
    admin = await makeUser("ADMIN");
    buyer = await makeUser("BUYER");
    organizer = await makeUser("ORGANIZER");
    otherOrganizer = await makeUser("ORGANIZER");
    eventId = await makeEvent(organizer, new Date(now.getTime() - 60_000));
    otherEvent = await makeEvent(
      otherOrganizer,
      new Date(now.getTime() + 86_400_000),
    );

    const [order] = await db
      .insert(orders)
      .values({
        orderCode: `W06-${randomUUID().slice(0, 24)}`,
        userId: buyer,
        eventId,
        totalAmount: "120000",
        discountAmount: "20000",
        finalAmount: "100000",
        expiresAt: now,
        paidAt: now,
        status: "PAID",
      })
      .returning({ id: orders.id });
    orderId = order!.id;
    paymentRef = `BE2${randomUUID().replaceAll("-", "")}`;
    paymentNumber = String(Date.now());
    refundNumber = String(Date.now() + 1);
    await db.insert(transactions).values({
      orderId,
      transactionRef: paymentRef,
      providerTxNumber: paymentNumber,
      amount: "100000",
      status: "SUCCESS",
      payDate: now,
      idempotencyKey: randomUUID(),
    });
    await db.insert(refunds).values({
      orderId,
      amount: "20000",
      status: "COMPLETED",
      providerRefundRef: refundNumber,
      processedAt: now,
      reason: "Partial refund",
      idempotencyKey: randomUUID(),
    });
    report = csv(
      `${paymentRef},${paymentNumber},10000000,01`,
      `${paymentRef},${refundNumber},2000000,03`,
    );
    app = await NestFactory.create<NestFastifyApplication>(
      SettlementTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });

  after(async () => {
    await app?.close();
    if (createdEvents.length) {
      const settlementIds = await db
        .delete(payouts)
        .where(inArray(payouts.eventId, createdEvents))
        .returning({ id: payouts.id });
      await db
        .delete(auditLog)
        .where(
          inArray(auditLog.targetId, [
            ...createdEvents,
            ...settlementIds.map(({ id }) => id),
          ]),
        );
      await db
        .delete(reconciliationCases)
        .where(inArray(reconciliationCases.eventId, createdEvents));
      await db
        .delete(reconciliationReports)
        .where(inArray(reconciliationReports.eventId, createdEvents));
      if (orderId) {
        await db.delete(refunds).where(eq(refunds.orderId, orderId));
        await db.delete(transactions).where(eq(transactions.orderId, orderId));
        await db.delete(orders).where(eq(orders.id, orderId));
      }
      await db.delete(events).where(inArray(events.id, createdEvents));
    }
    if (createdProfiles.length)
      await db
        .delete(organizerProfiles)
        .where(inArray(organizerProfiles.id, createdProfiles));
    if (createdUsers.length) {
      await db
        .delete(adminSettlementExports)
        .where(inArray(adminSettlementExports.requestedBy, createdUsers));
      await db.delete(users).where(inArray(users.id, createdUsers));
    }
    if (createdEvents.length) await refreshReportViews();
    await sqlClient.end();
  });

  it("yêu cầu ADMIN và chỉ chốt sự kiện đã qua giờ kết thúc", async () => {
    assert.equal(
      (
        await http(`/admin/events/${eventId}/end`, {
          method: "POST",
          actor: organizer,
          role: "ORGANIZER",
        })
      ).status,
      403,
    );
    assert.equal(
      (await http(`/admin/events/${otherEvent}/end`, { method: "POST" }))
        .status,
      409,
    );
    assert.equal(
      (
        await http("/admin/payouts/generate", {
          method: "POST",
          body: { eventId },
        })
      ).status,
      409,
    );
    assert.equal(
      (await http(`/admin/events/${eventId}/end`, { method: "POST" })).status,
      200,
    );
    const empty = await http(`/admin/reconciliations?eventId=${eventId}`);
    assert.equal((await empty.json()).data.report, null);
  });

  it("phân loại sai số, khoản thanh toán thiếu và bản ghi mồ côi, giữ lệnh chi trả", async () => {
    const first = await reconciliation.importReport(eventId, report);
    assert.equal(first.discrepancyCount, 0);
    const create = await http("/admin/payouts/generate", {
      method: "POST",
      body: { eventId },
    });
    assert.equal(create.status, 200);
    const { data: payout } = await create.json();
    assert.equal(payout.status, "PENDING");
    assert.equal(payout.netPayout, 74_500);

    const mismatch = csv(
      `${paymentRef},${paymentNumber},9000000,01`,
      "ORPHAN,998,100000,01",
    );
    const imported = await reconciliation.importReport(eventId, mismatch);
    assert.equal(imported.discrepancyCount, 3);
    assert.ok(imported.investigationId);
    const repeated = await reconciliation.importReport(eventId, mismatch);
    assert.equal(repeated.reused, true);
    assert.equal(repeated.investigationId, imported.investigationId);
    const root = `/admin/reconciliations/${eventId}/investigations`;
    assert.equal(
      (
        await http(root + "/resolve", {
          method: "POST",
          body: { reason: "Chưa sạch" },
        })
      ).status,
      409,
    );
    await assert.rejects(
      reconciliation.importReport(eventId, csv("INVALID,12,0,01")),
      /INVALID_VNPAY_REPORT_ROW/,
    );
    const response = await http(
      `/admin/reconciliations?eventId=${eventId}&status=ORPHAN_TRANSACTION&limit=1`,
    );
    const { data } = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.report.discrepancyCount, 3);
    assert.equal(data.summary.mismatchedCount, 3);
    assert.equal(data.items[0].issue, "LOCAL_TRANSACTION_MISSING");
    assert.equal(data.meta.total, 1);
    assert.equal(
      (await http(`/admin/payouts/${payout.id}/approve`, { method: "POST" }))
        .status,
      409,
    );
    assert.equal(
      (
        await http(`/admin/payouts/${payout.id}/release`, {
          method: "POST",
          body: { reason: "Đã rà soát" },
        })
      ).status,
      409,
    );
    assert.equal(
      (await reconciliation.importReport(eventId, report)).discrepancyCount,
      0,
    );
    const history = await http(root);
    assert.equal((await history.json()).data.items.length, 1);
    const evidence = await http(
      root + "/" + imported.investigationId + "?limit=1",
    );
    const details = (await evidence.json()).data;
    assert.equal(details.items.length, 1);
    assert.equal(details.meta.hasMore, true);
    const blocked = await http(`/admin/payouts/${payout.id}/release`, {
      method: "POST",
      body: { reason: "Thiếu kết luận điều tra" },
    });
    assert.equal(blocked.status, 409);
    const resolved = await http(root + "/resolve", {
      method: "POST",
      body: { reason: "Đã xác minh báo cáo sửa" },
    });
    assert.equal(resolved.status, 200);
    assert.equal((await resolved.json()).data.resolvedCount, 1);
    const released = await http(`/admin/payouts/${payout.id}/release`, {
      method: "POST",
      body: { reason: "Đã rà soát báo cáo VNPay" },
    });
    assert.equal(released.status, 200);
    assert.equal((await released.json()).data.status, "PENDING");
  });

  it("chặn dữ liệu hết hiệu lực, duyệt đúng một lần và chỉ hiển thị cho BTC sở hữu", async () => {
    await db.insert(refunds).values({
      orderId,
      amount: "10000",
      status: "PENDING",
      reason: "New refund",
      idempotencyKey: randomUUID(),
    });
    const [pendingPayment] = await db
      .insert(transactions)
      .values({
        orderId,
        amount: "100000",
        status: "PENDING",
        transactionRef: "BE2" + randomUUID().replaceAll("-", ""),
        idempotencyKey: randomUUID(),
        rawCallback: { vnp_ResponseCode: "00", vnp_TransactionStatus: "00" },
      })
      .returning({ id: transactions.id });
    const listing = await http(`/admin/payouts?eventId=${eventId}`);
    const { data } = await listing.json();
    const payout = data.items[0];
    assert.equal(
      (await http(`/admin/payouts/${payout.id}/approve`, { method: "POST" }))
        .status,
      409,
    );
    assert.equal(
      (await reconciliation.importReport(eventId, report)).discrepancyCount,
      2,
    );
    const pendingReport = await http(
      `/admin/reconciliations?eventId=${eventId}&status=MISSING_TRANSACTION`,
    );
    assert.ok(
      (await pendingReport.json()).data.items.some(
        (row: { issue: string }) =>
          row.issue === "VERIFIED_PAYMENT_NOT_SETTLED",
      ),
    );
    await db
      .delete(transactions)
      .where(eq(transactions.id, pendingPayment!.id));
    await db
      .delete(refunds)
      .where(and(eq(refunds.status, "PENDING"), eq(refunds.orderId, orderId)));
    assert.equal(
      (await reconciliation.importReport(eventId, report)).discrepancyCount,
      0,
    );
    const resolved = await http(
      `/admin/reconciliations/${eventId}/investigations/resolve`,
      {
        method: "POST",
        body: { reason: "Đã xác minh giao dịch và hoàn tiền" },
      },
    );
    assert.equal(resolved.status, 200);
    assert.equal(
      (
        await http(`/admin/payouts/${payout.id}/release`, {
          method: "POST",
          body: { reason: "Đã giải quyết hoàn tiền" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await http(`/admin/payouts/${payout.id}/hold`, {
          method: "POST",
          body: { reason: "Khiếu nại đang xử lý" },
        })
      ).status,
      200,
    );
    const recalculated = await http(`/admin/payouts/${payout.id}/recalculate`, {
      method: "POST",
    });
    assert.equal(recalculated.status, 200);
    const held = (await recalculated.json()).data;
    assert.equal(held.status, "HOLD");
    assert.equal(held.holdReason, "Khiếu nại đang xử lý");
    assert.equal(
      (await http(`/admin/payouts/${payout.id}/approve`, { method: "POST" }))
        .status,
      409,
    );
    assert.equal(
      (
        await http(`/admin/payouts/${payout.id}/release`, {
          method: "POST",
          body: { reason: "Khiếu nại đã giải quyết" },
        })
      ).status,
      200,
    );
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        http(`/admin/payouts/${payout.id}/approve`, { method: "POST" }),
      ),
    );
    assert.deepEqual(responses.map((row) => row.status).sort(), [200, 409]);
    const logs = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, payout.id));
    assert.equal(
      logs.filter((entry) => entry.action === "APPROVE_PAYOUT").length,
      1,
    );
    assert.equal(
      (
        await http(`/admin/payouts/${payout.id}/recalculate`, {
          method: "POST",
        })
      ).status,
      409,
    );
    const owner = await http("/organizer/payouts", {
      actor: organizer,
      role: "ORGANIZER",
    });
    assert.equal((await owner.json()).data.items[0].status, "PAID_OUT");
    const other = await http("/organizer/payouts", {
      actor: otherOrganizer,
      role: "ORGANIZER",
    });
    assert.equal((await other.json()).data.items.length, 0);
  });

  it("tổng hợp số liệu theo bộ lọc và xuất CSV an toàn", async () => {
    let refreshed = false;
    for (let index = 0; index < 10 && !refreshed; index++) {
      refreshed = await refreshReportViews();
      if (!refreshed) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(refreshed, true);
    const date = new Date(now.getTime() + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const path = `/admin/settlement-report?fromDate=${date}&toDate=${date}&groupBy=city&city=%2BUC11&provider=VNPAY`;
    const response = await http(path);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(Number(data.items[0].paidRevenue), 100_000);
    assert.equal(Number(data.items[0].refundedAmount), 20_000);
    const exported = await http(path + "&format=csv");
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(await exported.text(), /"'\+UC11",100000/);
  });
  it("tạo Excel nền, chỉ người tạo được tải và từ chối ADMIN đã khóa", async () => {
    const date = new Date(now.getTime() + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const root = "/admin/settlement-report/exports";
    const created = await http(root, {
      method: "POST",
      body: {
        fromDate: date,
        toDate: date,
        groupBy: "city",
        city: "+UC11",
        format: "xlsx",
      },
    });
    assert.equal(created.status, 202);
    const { data: job } = await created.json();
    const path = `${root}/${job.id}/download`;
    assert.equal((await http(path)).status, 409);
    assert.deepEqual(
      await Promise.all([
        processAdminSettlementExport(),
        processAdminSettlementExport(),
      ]).then((runs) => runs.sort()),
      [false, true],
    );
    const outsider = await makeUser("ADMIN");
    assert.equal((await http(path, { actor: outsider })).status, 404);
    const list = await http(root);
    assert.equal((await list.json()).data.items[0].status, "COMPLETED");
    const result = await http(path);
    assert.equal(result.status, 200);
    assert.match(result.headers.get("content-type") ?? "", /spreadsheetml/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await result.arrayBuffer());
    assert.equal(book.getWorksheet("UC11")!.getCell("A2").value, "+UC11");
    assert.equal(book.getWorksheet("UC11")!.getCell("B2").value, "100000.00");
    await db.update(users).set({ status: "LOCKED" }).where(eq(users.id, admin));
    assert.equal((await http(path)).status, 403);
  });

  it("thử lại lỗi rollback đã xác nhận và giữ nguyên lỗi nghiệp vụ", async () => {
    let attempts = 0;
    const result = await retryPayoutApproval(randomUUID(), async () => {
      if (++attempts < 3)
        throw Object.assign(new Error("Serialization failure"), {
          code: "40001",
        });
      return "OK";
    });
    assert.equal(result, "OK");
    assert.equal(attempts, 3);
    let exhausted = 0;
    await assert.rejects(
      retryPayoutApproval(randomUUID(), async () => {
        exhausted++;
        throw new Error("Write conflict", { cause: { code: "40P01" } });
      }),
      /PAYOUT_APPROVAL_RETRY_EXHAUSTED/,
    );
    assert.equal(exhausted, 3);
    await assert.rejects(
      retryPayoutApproval(randomUUID(), async () => {
        throw new Error("CLEAN_CURRENT_RECONCILIATION_REQUIRED");
      }),
      /CLEAN_CURRENT_RECONCILIATION_REQUIRED/,
    );
  });
});
