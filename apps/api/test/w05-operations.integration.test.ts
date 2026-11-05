import "reflect-metadata";
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { eq, inArray, sql } from "drizzle-orm";
import Redis from "ioredis";
import ExcelJS from "exceljs";
import { db, sqlClient } from "../src/database/db";
import {
  users,
  organizerProfiles,
  events,
  gates,
  eventStaff,
  organizerStaff,
  orders,
  orderItems,
  ticketTypes,
  tickets,
  refunds,
  reportExports,
  gateCheckinLogs,
} from "../src/database/schema";
import { env } from "../src/config/env.config";
import { StaffService } from "../src/organizer-operations/staff.service";
import { OperationsController } from "../src/organizer-operations/operations.controller";
import { ReportsController } from "../src/reporting/reports.controller";
import { ReportsService } from "../src/reporting/reports.service";
import {
  processReportExport,
  cleanupReportExports,
} from "../src/reporting/export-worker";
import { refreshReportViews } from "../src/reporting/report-data";
import { TicketsService } from "../src/tickets/tickets.service";
import { Ed25519Service } from "../src/tickets/crypto/ed25519.service";
import { GateController } from "../src/tickets/gate.controller";
import { JwtAuthGuard } from "../src/auth/guards/jwt-auth.guard";
import { RolesGuard } from "../src/auth/guards/roles.guard";

@Module({})
class W05Module {}
describe("W05 BE2: staff, manual checkin, materialized reports va export", () => {
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    retryStrategy: () => null,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 500,
  });
  // Ket noi chi bat dau trong before; loi connect duoc bao qua promise.
  redis.on("error", () => {});
  const previousExportDir = process.env.REPORT_EXPORT_DIR;
  const jwt = new JwtService({ secret: env.JWT_SECRET });
  const userIds: string[] = [];
  const eventIds: string[] = [];
  const orderIds: string[] = [];
  let orgId: string;
  let otherOrg: string;
  let buyer: string;
  let orgProfile: string;
  let eventId: string;
  let foreignEvent: string;
  let gateId: string;
  let gate2: string;
  let staffId: string;
  let app: NestFastifyApplication;
  let base: string;
  let dir: string | undefined;
  let crypto: Ed25519Service;
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    actor = orgId,
    role = "ORGANIZER",
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${await jwt.signAsync({ sub: actor, role })}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json() };
  }
  async function makeEvent(owner: string, title = "W05 Event") {
    const [e] = await db
      .insert(events)
      .values({
        organizerId: owner,
        title,
        slug: `w05-${randomUUID()}`,
        description: "Test",
        category: "CONCERT",
        city: "Ha Noi",
        bannerUrl: "https://example.com/a",
        venueName: "San khau",
        venueAddress: "Ha Noi",
        startTime: new Date(Date.now() + 86400000),
        endTime: new Date(Date.now() + 90000000),
        gateOpeningTime: new Date(),
        status: "PUBLISHED",
        isWaitingRoomEnabled: false,
      })
      .returning();
    eventIds.push(e!.id);
    return e!.id;
  }
  async function makeTicket(amount = "100", discount = "0", qty = 1) {
    const [tt] = await db
      .insert(ticketTypes)
      .values({
        eventId,
        name: "GA",
        price: amount,
        capacity: 100,
        isSeated: false,
        saleStartTime: new Date(),
        saleEndTime: new Date(Date.now() + 86400000),
      })
      .returning();
    const total = Number(amount) * qty;
    const [order] = await db
      .insert(orders)
      .values({
        userId: buyer,
        eventId,
        orderCode: randomUUID().replaceAll("-", ""),
        status: "PAID",
        totalAmount: String(total),
        discountAmount: discount,
        finalAmount: String(total - Number(discount)),
        expiresAt: new Date(),
        paidAt: new Date("2026-11-10T12:00:00Z"),
      })
      .returning();
    orderIds.push(order!.id);
    await db.insert(orderItems).values({
      orderId: order!.id,
      ticketTypeId: tt!.id,
      quantity: qty,
      unitPrice: amount,
      subtotal: String(total),
    });
    const issued = await db
      .insert(tickets)
      .values(
        Array.from({ length: qty }, () => ({
          ticketCode: randomUUID().replaceAll("-", ""),
          orderId: order!.id,
          eventId,
          userId: buyer,
          ticketTypeId: tt!.id,
          status: "SOLD" as const,
        })),
      )
      .returning();
    return { order: order!, tickets: issued };
  }
  before(async () => {
    assert.match(new URL(env.DATABASE_URL).pathname, /_test$/);
    env.ED25519_PRIVATE_KEY = generateKeyPairSync("ed25519")
      .privateKey.export({ format: "der", type: "pkcs8" })
      .toString("base64");
    crypto = new Ed25519Service();
    dir = await mkdtemp(join(tmpdir(), "w05-exports-"));
    process.env.REPORT_EXPORT_DIR = dir;
    await redis.connect();
    const created = await db
      .insert(users)
      .values(
        ["ORGANIZER", "ORGANIZER", "BUYER"].map((role) => ({
          email: `w05-${randomUUID()}@example.com`,
          fullName: "W05",
          passwordHash: "test-only",
          phone: "0901234567",
          role: role as "ORGANIZER" | "BUYER",
          status: "ACTIVE" as const,
        })),
      )
      .returning();
    userIds.push(...created.map((u) => u.id));
    orgId = created[0]!.id;
    otherOrg = created[1]!.id;
    buyer = created[2]!.id;
    const profiles = await db
      .insert(organizerProfiles)
      .values(
        [orgId, otherOrg].map((userId) => ({
          userId,
          organizationName: "W05",
          taxCode: randomUUID(),
          businessLicenseUrl: "https://example.com/license",
          representativeName: "W05",
          status: "VERIFIED" as const,
        })),
      )
      .returning();
    orgProfile = profiles[0]!.id;
    eventId = await makeEvent(orgProfile);
    foreignEvent = await makeEvent(profiles[1]!.id);
    const gs = await db
      .insert(gates)
      .values([
        { eventId, name: "A" },
        { eventId, name: "B" },
      ])
      .returning();
    gateId = gs[0]!.id;
    gate2 = gs[1]!.id;
    app = await NestFactory.create<NestFastifyApplication>(
      {
        module: W05Module,
        controllers: [OperationsController, ReportsController, GateController],
        providers: [
          { provide: JwtService, useValue: jwt },
          RolesGuard,
          JwtAuthGuard,
          { provide: StaffService, useValue: new StaffService() },
          { provide: ReportsService, useValue: new ReportsService(redis) },
          { provide: TicketsService, useValue: new TicketsService(crypto) },
        ],
      },
      new FastifyAdapter(),
      { logger: false },
    );
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  after(async () => {
    try {
      await app?.close();
      if (eventIds.length) {
        await db
          .delete(reportExports)
          .where(inArray(reportExports.eventId, eventIds));
        await db.delete(refunds).where(inArray(refunds.orderId, orderIds));
        await db.delete(tickets).where(inArray(tickets.eventId, eventIds));
        await db
          .delete(orderItems)
          .where(inArray(orderItems.orderId, orderIds));
        await db.delete(orders).where(inArray(orders.id, orderIds));
        await db
          .delete(eventStaff)
          .where(inArray(eventStaff.eventId, eventIds));
        await db.delete(gates).where(inArray(gates.eventId, eventIds));
        await db.delete(events).where(inArray(events.id, eventIds));
      }
      if (userIds.length) {
        await db
          .delete(organizerStaff)
          .where(inArray(organizerStaff.userId, userIds));
        await db
          .delete(organizerProfiles)
          .where(inArray(organizerProfiles.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
    } finally {
      redis.disconnect();
      if (previousExportDir === undefined) delete process.env.REPORT_EXPORT_DIR;
      else process.env.REPORT_EXPORT_DIR = previousExportDir;
      try {
        if (dir)
          await rm(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100,
          });
      } finally {
        await sqlClient.end();
      }
    }
  });
  it("BTC tao staff an toan, khong lo password; khong cho sua role hay email trung", async () => {
    const body = {
      email: `staff-${randomUUID()}@example.com`,
      fullName: "Gate Agent",
      password: "StrongPassword123!",
    };
    const result = await request("/api/v1/organizer/staff", "POST", body);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    staffId = result.body.data.id;
    userIds.push(staffId);
    assert.equal(result.body.data.passwordHash, undefined);
    assert.equal(result.body.data.password, undefined);
    assert.equal(
      (await request("/api/v1/organizer/staff", "POST", body)).status,
      409,
    );
    assert.equal(
      (
        await request(`/api/v1/organizer/staff/${staffId}`, "PATCH", {
          role: "ADMIN",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          `/api/v1/organizer/staff/${staffId}`,
          "PATCH",
          { fullName: "Stolen" },
          otherOrg,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          "/api/v1/organizer/staff",
          "GET",
          undefined,
          buyer,
          "BUYER",
        )
      ).status,
      403,
    );
  });
  it("Gan staff dung BTC, su kien va cong; BTC khac khong duoc xem/gan", async () => {
    const result = await request(
      `/api/v1/organizer/events/${eventId}/staff`,
      "POST",
      { userId: staffId, gateId },
    );
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(
      (
        await request(
          `/api/v1/organizer/events/${foreignEvent}/staff`,
          "POST",
          { userId: staffId, gateId },
        )
      ).status,
      404,
    );
    const [foreignGate] = await db
      .insert(gates)
      .values({ eventId: foreignEvent, name: "Foreign" })
      .returning();
    assert.equal(
      (
        await request(`/api/v1/organizer/events/${eventId}/staff`, "POST", {
          userId: staffId,
          gateId: foreignGate!.id,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/v1/organizer/events/${eventId}/staff`,
          "GET",
          undefined,
          otherOrg,
        )
      ).status,
      404,
    );
  });
  it("Tra cuu full email va 4 so cuoi dien thoai; khong chap nhan duoi email", async () => {
    const f = await makeTicket();
    const code = f.tickets[0]!.ticketCode;
    const input = {
      eventId,
      ticketCode: code,
      phoneOrEmailLast4: ".com",
      reason: "Khach het pin",
    };
    assert.equal(
      (
        await request(
          "/api/v1/gate/lookup",
          "POST",
          input,
          staffId,
          "GATE_STAFF",
        )
      ).status,
      400,
    );
    const account = await db.query.users.findFirst({
      where: eq(users.id, buyer),
    });
    const good = await request(
      "/api/v1/gate/lookup",
      "POST",
      {
        eventId,
        ticketCode: code,
        email: account!.email.toUpperCase(),
        reason: "Khach het pin",
      },
      staffId,
      "GATE_STAFF",
    );
    assert.equal(good.status, 200, JSON.stringify(good.body));
    assert.equal(good.body.gateId, gateId);
    const logs = await db
      .select()
      .from(gateCheckinLogs)
      .where(eq(gateCheckinLogs.ticketId, f.tickets[0]!.id));
    assert.equal(logs.filter((l) => l.outcome === "SUCCESS").length, 1);
    assert.equal(logs.filter((l) => l.outcome === "REJECTED").length, 1);
  });
  it("Scan QR va manual tranh chap mot ve: dung 1 thanh cong, 19 xung dot", async () => {
    const f = await makeTicket();
    const t = f.tickets[0]!;
    const qr = crypto.signDynamicQr({
      sub: t.id,
      eventId,
      orderId: t.orderId,
      userId: buyer,
    }).token;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        i % 2
          ? request(
              "/api/v1/gate/scan",
              "POST",
              { qrToken: qr },
              staffId,
              "GATE_STAFF",
            )
          : request(
              "/api/v1/gate/lookup",
              "POST",
              {
                eventId,
                ticketCode: t.ticketCode,
                phoneOrEmailLast4: "4567",
                reason: "Device failure",
              },
              staffId,
              "GATE_STAFF",
            ),
      ),
    );
    assert.equal(
      results.filter((r) => r.status === 200).length,
      1,
      JSON.stringify(results),
    );
    assert.equal(results.filter((r) => r.status === 409).length, 19);
    const logs = await db
      .select()
      .from(gateCheckinLogs)
      .where(eq(gateCheckinLogs.ticketId, t.id));
    assert.equal(logs.filter((l) => l.outcome === "SUCCESS").length, 1);
    assert.equal(logs.length, 20);
  });
  it("Nhan vien sai cong, bi khoa, bi go phan cong khong duoc checkin voi JWT cu", async () => {
    const f = await makeTicket();
    const body = {
      eventId,
      ticketCode: f.tickets[0]!.ticketCode,
      phoneOrEmailLast4: "4567",
      reason: "Check",
    };
    assert.equal(
      (
        await request(
          "/api/v1/gate/lookup",
          "POST",
          { ...body, gateId: gate2 },
          staffId,
          "GATE_STAFF",
        )
      ).status,
      403,
    );
    await request(`/api/v1/organizer/staff/${staffId}`, "PATCH", {
      status: "LOCKED",
    });
    assert.equal(
      (
        await request(
          "/api/v1/gate/lookup",
          "POST",
          body,
          staffId,
          "GATE_STAFF",
        )
      ).status,
      403,
    );
    await request(`/api/v1/organizer/staff/${staffId}`, "PATCH", {
      status: "ACTIVE",
    });
    assert.equal(
      (
        await request(
          `/api/v1/organizer/events/${eventId}/staff/${staffId}`,
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/v1/gate/lookup",
          "POST",
          body,
          staffId,
          "GATE_STAFF",
        )
      ).status,
      403,
    );
    await request(`/api/v1/organizer/events/${eventId}/staff`, "POST", {
      userId: staffId,
      gateId,
    });
  });
  it("Log bat bien; BTC doc duoc lich su su kien cua minh", async () => {
    const history = await request(
      `/api/v1/organizer/events/${eventId}/checkins`,
    );
    assert.equal(history.status, 200);
    assert.ok(history.body.data.length > 0);
    const log = history.body.data[0];
    await assert.rejects(
      db
        .update(gateCheckinLogs)
        .set({ reason: "tamper" })
        .where(eq(gateCheckinLogs.id, log.id)),
    );
    assert.equal(
      (
        await request(
          `/api/v1/organizer/events/${eventId}/checkins`,
          "GET",
          undefined,
          otherOrg,
        )
      ).status,
      404,
    );
  });
  it("Bao cao MV khong nhan doanh thu theo so ve/refund; chi doc MV khi Redis hong", async () => {
    const f = await makeTicket("50", "10", 2);
    const f2 = await makeTicket("100", "20", 2);
    await db.insert(refunds).values(
      [10, 20].map((n) => ({
        orderId: f.order.id,
        amount: String(n),
        reason: "Approved refund",
        status: "COMPLETED" as const,
        idempotencyKey: randomUUID(),
      })),
    );
    await refreshReportViews();
    const expected = await db.execute<{ total: string }>(
      sql`select sum(final_amount) as total from orders where event_id=${eventId} and status='PAID'`,
    );
    const result = await request(`/api/v1/organizer/events/${eventId}/reports`);
    assert.equal(result.status, 200);
    assert.equal(
      Number(result.body.data.summary.paid_revenue),
      Number(expected[0]!.total),
    );
    assert.equal(Number(result.body.data.summary.total_refunded_amount), 30);
    assert.equal(
      Number(result.body.data.summary.net_revenue),
      Number(expected[0]!.total) - 30,
    );
    await db
      .update(orders)
      .set({ finalAmount: "1" })
      .where(eq(orders.id, f2.order.id));
    const ended = new Promise<void>((resolve) => redis.once("end", resolve));
    redis.disconnect();
    await ended;
    try {
      const cached = await request(
        `/api/v1/organizer/events/${eventId}/reports`,
      );
      assert.equal(
        cached.body.data.summary.paid_revenue,
        result.body.data.summary.paid_revenue,
      );
    } finally {
      await redis.connect();
    }
    assert.equal(
      (
        await request(
          `/api/v1/organizer/events/${eventId}/reports`,
          "GET",
          undefined,
          otherOrg,
        )
      ).status,
      404,
    );
  });
  it("Export CSV va Excel chay nen, tai file dung quyen va chan formula injection", async () => {
    await db
      .update(events)
      .set({ title: "=DANGEROUS()" })
      .where(eq(events.id, eventId));
    await refreshReportViews();
    for (const format of ["csv", "xlsx"]) {
      const created = await request(
        `/api/v1/organizer/events/${eventId}/reports/exports`,
        "POST",
        { format },
      );
      assert.equal(created.status, 202, JSON.stringify(created.body));
      const id = created.body.data.id;
      assert.equal(
        (
          await request(
            `/api/v1/organizer/events/${eventId}/reports/exports/${id}/download`,
          )
        ).status,
        409,
      );
      await Promise.all([processReportExport(id), processReportExport(id)]);
      const status = await request(
        `/api/v1/organizer/events/${eventId}/reports/exports/${id}`,
      );
      assert.equal(
        status.body.data.status,
        "COMPLETED",
        JSON.stringify(status.body),
      );
      assert.equal(
        (
          await request(
            `/api/v1/organizer/events/${eventId}/reports/exports/${id}`,
            "GET",
            undefined,
            otherOrg,
          )
        ).status,
        404,
      );
      const response = await fetch(base + status.body.data.downloadUrl, {
        headers: {
          authorization: `Bearer ${await jwt.signAsync({ sub: orgId, role: "ORGANIZER" })}`,
        },
      });
      assert.equal(response.status, 200);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (format === "csv") assert.match(buffer.toString(), /'=DANGEROUS/);
      else {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        assert.equal(
          workbook.worksheets[0]!.getCell("B2").value,
          "=DANGEROUS()",
        );
        assert.equal(
          workbook.worksheets[0]!.getCell("B2").type,
          ExcelJS.ValueType.String,
        );
      }
      await db
        .update(reportExports)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(reportExports.id, id));
      assert.equal(
        (
          await request(
            `/api/v1/organizer/events/${eventId}/reports/exports/${id}/download`,
          )
        ).status,
        410,
      );
      await cleanupReportExports();
    }
  });

  it("Loi ghi log rollback checkin, khong de ve CHECKED_IN thieu lich su", async () => {
    const f = await makeTicket();
    const t = f.tickets[0]!;
    await db.execute(
      sql.raw(
        `CREATE FUNCTION w05_fail_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.ticket_id='${t.id}' AND NEW.outcome='SUCCESS' THEN RAISE EXCEPTION 'test log failure'; END IF; RETURN NEW; END $$`,
      ),
    );
    await db.execute(
      sql`CREATE TRIGGER w05_fail_log BEFORE INSERT ON gate_checkin_logs FOR EACH ROW EXECUTE FUNCTION w05_fail_log()`,
    );
    try {
      const result = await request(
        "/api/v1/gate/lookup",
        "POST",
        {
          eventId,
          ticketCode: t.ticketCode,
          phoneOrEmailLast4: "4567",
          reason: "Device failure",
        },
        staffId,
        "GATE_STAFF",
      );
      assert.equal(result.status, 500);
      assert.equal(
        (await db.query.tickets.findFirst({ where: eq(tickets.id, t.id) }))
          ?.status,
        "SOLD",
      );
      const logs = await db
        .select()
        .from(gateCheckinLogs)
        .where(eq(gateCheckinLogs.ticketId, t.id));
      assert.equal(logs.filter((l) => l.outcome === "SUCCESS").length, 0);
    } finally {
      await db.execute(sql`DROP TRIGGER w05_fail_log ON gate_checkin_logs`);
      await db.execute(sql`DROP FUNCTION w05_fail_log()`);
    }
  });
  it("QR da ky nhung sai order/user khong duoc dung de checkin", async () => {
    const f = await makeTicket();
    const t = f.tickets[0]!;
    const qr = crypto.signDynamicQr({
      sub: t.id,
      eventId,
      orderId: randomUUID(),
      userId: buyer,
    }).token;
    assert.equal(
      (
        await request(
          "/api/v1/gate/scan",
          "POST",
          { qrToken: qr },
          staffId,
          "GATE_STAFF",
        )
      ).status,
      400,
    );
    assert.equal(
      (await db.query.tickets.findFirst({ where: eq(tickets.id, t.id) }))
        ?.status,
      "SOLD",
    );
  });
  it("Worker lay lai job PROCESSING qua han lease va xuat bao cao cho su kien moi", async () => {
    const fresh = await makeEvent(orgProfile, "New event");
    const created = await request(
      `/api/v1/organizer/events/${fresh}/reports/exports`,
      "POST",
      { format: "csv" },
    );
    assert.equal(created.status, 202);
    const id = created.body.data.id;
    const stale = randomUUID();
    await db
      .update(reportExports)
      .set({
        status: "PROCESSING",
        attemptId: stale,
        updatedAt: new Date(Date.now() - 360000),
      })
      .where(eq(reportExports.id, id));
    await processReportExport(id);
    const saved = await db.query.reportExports.findFirst({
      where: eq(reportExports.id, id),
    });
    assert.equal(saved?.status, "COMPLETED");
    assert.notEqual(saved.attemptId, stale);
  });
  it("Worker kiem tra lai quyen BTC truoc khi tao file", async () => {
    const created = await request(
      `/api/v1/organizer/events/${eventId}/reports/exports`,
      "POST",
      { format: "csv" },
    );
    assert.equal(created.status, 202);
    const id = created.body.data.id;
    await db
      .update(organizerProfiles)
      .set({ status: "REJECTED" })
      .where(eq(organizerProfiles.id, orgProfile));
    try {
      await processReportExport(id);
      const job = await db.query.reportExports.findFirst({
        where: eq(reportExports.id, id),
      });
      assert.equal(job?.status, "PENDING");
      assert.equal(job.fileName, null);
      assert.equal(
        (
          await request(
            `/api/v1/organizer/events/${eventId}/reports/exports/${id}`,
          )
        ).status,
        403,
      );
    } finally {
      await db
        .update(organizerProfiles)
        .set({ status: "VERIFIED" })
        .where(eq(organizerProfiles.id, orgProfile));
    }
    await db
      .update(reportExports)
      .set({ status: "FAILED" })
      .where(eq(reportExports.id, id));
  });
  it("Gioi han job dang cho va khong nhan dinh dang/duong dan tuy y", async () => {
    for (let i = 0; i < 3; i++)
      assert.equal(
        (
          await request(
            `/api/v1/organizer/events/${eventId}/reports/exports`,
            "POST",
            { format: "csv" },
          )
        ).status,
        202,
      );
    assert.equal(
      (
        await request(
          `/api/v1/organizer/events/${eventId}/reports/exports`,
          "POST",
          { format: "csv" },
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          `/api/v1/organizer/events/${eventId}/reports/exports`,
          "POST",
          { format: "../../secret" },
        )
      ).status,
      400,
    );
  });
});
