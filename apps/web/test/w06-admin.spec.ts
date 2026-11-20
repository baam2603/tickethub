import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";

const api = "http://localhost:4000/api/v1";
const password = "Password123!";

async function readData<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()).data as T;
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

  await payout.getByRole("button", { name: "Phê duyệt chi trả" }).click();
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(payout.getByText("Đã chi trả", { exact: true })).toBeVisible();
  await expect(payout.getByRole("button", { name: "Tính lại" })).toHaveCount(0);
});
