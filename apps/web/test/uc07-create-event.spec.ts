import { test, expect } from "@playwright/test";

test.describe("UC07: Tạo sự kiện, Sơ đồ ghế & Hạng vé (Organizer)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth");
    await page.fill("input#identifier", "organizer@tickethub.vn");
    await page.click('button[type="submit"]:has-text("Tiếp tục")');
    await page.waitForSelector("input#password");
    await page.fill("input#password", "Password123!");
    await page.click('button[type="submit"]:has-text("Đăng nhập")');
    await page.waitForURL(/\/organizer/);
  });

  test("TC01 - Hiển thị giao diện tạo sự kiện (Wizard)", async ({ page }) => {
    await page.goto("/organizer/events/new");
    await expect(page).toHaveURL("/organizer/events/new");
    await expect(
      page.getByRole("heading", { level: 1, name: "Tạo sự kiện", exact: true }),
    ).toBeVisible();
  });

  test("TC02 - Cấu hình Sơ đồ ghế & Thêm Hạng vé", async () => {
    test.skip(
      true,
      "Tính năng cấu hình sơ đồ ghế tương tác đang thuộc gói W03 FE2",
    );
  });

  test("TC03 - Gửi kiểm duyệt sự kiện (Submit for Approval)", async () => {
    test.skip(
      true,
      "Tính năng gửi kiểm duyệt sự kiện đang chờ tích hợp hoàn tất ở W03",
    );
  });
});
