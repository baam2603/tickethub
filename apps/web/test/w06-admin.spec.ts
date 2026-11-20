import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";

const api = "http://localhost:4000/api/v1";
const password = "Password123!";

async function readData<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()).data as T;
}

function prepareClosedEvent(eventId: string, slug: string) {
  const directory = mkdtempSync(join(tmpdir(), "w06-e2e-"));
  const csv = join(directory, "report.csv");
  const apiDirectory = resolve("../api");
  try {
    // Move only this test fixture's dates. The actual lifecycle transition uses the Admin API.
    execFileSync(
      process.execPath,
      [
        "-e",
        `const { env } = require("./dist/config/env.config.js");
      const database = new URL(env.DATABASE_URL);
      if (env.NODE_ENV !== "test" ||
          !["localhost", "127.0.0.1"].includes(database.hostname) ||
          !["/tickethub_dev"].includes(database.pathname) && !database.pathname.endsWith("_test"))
        throw new Error("Expected a local E2E database");
      const sql = require("postgres").default(env.DATABASE_URL);
      sql.unsafe("UPDATE events SET start_time = now() - interval '2 days', end_time = now() - interval '1 day', gate_opening_time = now() - interval '3 days' WHERE id = $1 AND slug = $2 AND status = 'PUBLISHED' RETURNING id", process.argv.slice(1))
        .then(rows => { if (rows.length !== 1) throw new Error("Missing W06 fixture"); })
        .catch(error => { console.error(error.message); process.exitCode = 1; })
        .finally(() => sql.end());`,
        eventId,
        slug,
      ],
      { cwd: apiDirectory, stdio: "pipe" },
    );
    writeFileSync(
      csv,
      "vnp_TxnRef,vnp_TransactionNo,vnp_Amount,vnp_TransactionType\n",
    );
    return {
      importReport() {
        execFileSync(
          process.execPath,
          ["dist/contexts/payout/vnpay-reconciliation.js", eventId, csv],
          {
            cwd: apiDirectory,
            stdio: "pipe",
          },
        );
      },
      cleanup() {
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

test("W06 FE1: kiểm duyệt, đình chỉ, khôi phục và quyết toán qua API thật", async ({
  page,
  request,
  baseURL,
}) => {
  const organizer = await readData<{ accessToken: string }>(
    await request.post(`${api}/auth/login`, {
      data: { email: "organizer@tickethub.vn", password },
    }),
  );
  const headers = { Authorization: `Bearer ${organizer.accessToken}` };
  const date = (days: number) =>
    new Date(Date.now() + days * 86400000).toISOString();
  const suffix = randomUUID();
  const title = `Sự kiện kiểm thử W06 ${suffix}`;
  const { id } = await readData<{ id: string }>(
    await request.post(`${api}/organizer/events`, {
      headers,
      data: {
        title,
        slug: `w06-${suffix}`,
        description: "Dữ liệu kiểm thử quy trình quản trị W06.",
        category: "CONCERT",
        bannerUrl: new URL("/images/events/vn/anh-trai.jpg", baseURL).href,
        venueName: "Địa điểm kiểm thử",
        venueAddress: "Địa chỉ kiểm thử",
        city: "Hà Nội",
        startTime: date(10),
        endTime: date(11),
        gateOpeningTime: date(9),
        ticketTypes: [
          {
            name: "GA",
            price: 100000,
            capacity: 10,
            isSeated: false,
            saleStartTime: date(-1),
            saleEndTime: date(10),
          },
        ],
      },
    }),
    201,
  );
  await readData(
    await request.post(`${api}/organizer/events/${id}/submit`, { headers }),
  );
  expect(
    (
      await request.get(`${api}/admin/events/control?eventId=${id}`, {
        headers,
      })
    ).status(),
  ).toBe(403);

  await page.goto("/auth");
  await page.locator("#identifier").fill("admin@tickethub.vn");
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL("**/admin");

  await page.getByRole("link", { name: "Sự kiện chờ duyệt" }).click();
  await page.getByRole("textbox", { name: "Tìm kiếm" }).fill(title);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const approved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/admin/events/${id}/review`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Duyệt mở bán/ }).click();
  await page.getByRole("button", { name: "Xác nhận duyệt" }).click();
  expect((await approved).ok()).toBe(true);

  await page.getByRole("link", { name: "Điều khiển sự kiện" }).click();
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(
    page.getByRole("article").getByText("Đã công bố", { exact: true }),
  ).toBeVisible();
  const poster = page.getByRole("img", { name: `Ảnh sự kiện ${title}` });
  await expect(poster).toBeVisible();
  await expect
    .poll(() =>
      poster.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("link", { name: "Quay lại danh sách sự kiện" }),
  ).toHaveAttribute("href", "/admin/events/control");

  const reason = "Diễn tập đình chỉ sự kiện trên dữ liệu kiểm thử";
  await page.getByRole("button", { name: "Tạm dừng bán vé" }).click();
  await page.getByLabel("Lý do đình chỉ").fill(reason);
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const confirm = page.getByRole("button", { name: "Xác nhận đình chỉ" });
  await expect(confirm).toBeDisabled();
  await page.getByRole("textbox", { name: /Nhập lại mã sự kiện/ }).fill(id);
  await confirm.click();
  await expect(page.getByText(/Đã đình chỉ sự kiện, hủy/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nhật ký kiểm toán" }),
  ).toBeVisible();
  await expect(page.locator("ol").getByText(reason)).toBeVisible();

  await page.getByRole("button", { name: "Khôi phục mở bán" }).click();
  await page.getByRole("button", { name: "Xác nhận khôi phục" }).click();
  await expect(page.getByText("Đã khôi phục mở bán.")).toBeVisible();

  await page.getByRole("link", { name: "Đối soát và chi trả" }).click();
  await page.getByRole("textbox", { name: "Mã sự kiện (UUID)" }).fill(id);
  await page.getByRole("button", { name: "Áp dụng" }).click();
  await expect(page.getByText("Không có giao dịch phù hợp.")).toBeVisible();
  const admin = await readData<{ accessToken: string }>(
    await request.post(`${api}/auth/login`, {
      data: { email: "admin@tickethub.vn", password },
    }),
  );
  const adminHeaders = { Authorization: `Bearer ${admin.accessToken}` };
  const fixture = prepareClosedEvent(id, `w06-${suffix}`);
  try {
    await readData(
      await request.post(`${api}/admin/events/${id}/end`, {
        headers: adminHeaders,
      }),
    );
    fixture.importReport();
  } finally {
    fixture.cleanup();
  }
  await page.getByRole("link", { name: "Chi trả", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Mã sự kiện cần quyết toán" })
    .fill(id);
  await page.getByRole("button", { name: "Tạo lệnh quyết toán" }).click();
  const payout = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title }) });
  await expect(payout.getByText("Chờ phê duyệt")).toBeVisible();

  await payout.getByRole("button", { name: "Tạm giữ" }).click();
  await page.getByLabel("Lý do tạm giữ").fill("Chờ xác minh số liệu");
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(payout.getByText("Đang tạm giữ")).toBeVisible();
  await payout.getByRole("button", { name: "Tính lại" }).click();
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(payout.getByText("Đang tạm giữ")).toBeVisible();

  const listing = await readData<{ items: { id: string }[] }>(
    await request.get(`${api}/admin/payouts?eventId=${id}`, {
      headers: adminHeaders,
    }),
  );
  expect(listing.items).toHaveLength(1);
  const payoutUrl = `${api}/admin/payouts/${listing.items[0]!.id}`;
  expect(
    (
      await request.post(`${payoutUrl}/approve`, { headers: adminHeaders })
    ).status(),
  ).toBe(409);
  await readData(
    await request.post(`${payoutUrl}/release`, {
      headers: adminHeaders,
      data: { reason: "Đã xác minh số liệu và đối soát sạch" },
    }),
  );
  await page.reload();
  await expect(payout.getByText("Chờ phê duyệt")).toBeVisible();

  await payout.getByRole("button", { name: "Phê duyệt chi trả" }).click();
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(payout.getByText("Đã chi trả", { exact: true })).toBeVisible();
  await expect(payout.getByRole("button", { name: "Tính lại" })).toHaveCount(0);
});
