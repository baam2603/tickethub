import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAQ_ITEMS,
  LEGAL_TABS,
  PRIVACY_BLOCKS,
  REFUND_NOTES,
  REFUND_POLICIES,
  TERMS_SECTIONS,
  parseLegalTab,
} from "../src/features/support/data/faq-content.ts";
import {
  GUIDE_BY_ROLE,
  GUIDE_ROLES,
  GUIDE_TIP,
  parseGuideRole,
} from "../src/features/support/data/guide-content.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");

describe("W06-FE2: Toi uu Offline PWA, Trang phap ly/FAQ va Huong dan su dung", () => {
  describe("1. Cau hinh Web App Manifest, Service Worker & Dang ky PWA", () => {
    it("manifest.webmanifest hop le, che do standalone va dung route chuan /gate/scanner", () => {
      const manifestPath = path.join(webRoot, "public", "manifest.webmanifest");
      assert.equal(fs.existsSync(manifestPath), true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        name: string;
        short_name: string;
        display: string;
        start_url: string;
        shortcuts: Array<{ url: string }>;
      };

      assert.equal(manifest.short_name, "TicketHub");
      assert.equal(manifest.display, "standalone");
      assert.equal(manifest.start_url, "/my-tickets");
      assert.equal(
        manifest.shortcuts.some((s) => s.url === "/my-tickets"),
        true,
      );
      assert.equal(
        manifest.shortcuts.some((s) => s.url === "/gate/scanner"),
        true,
      );
      assert.equal(
        manifest.shortcuts.some((s) => s.url === "/gate-scanner"),
        false,
      );
    });

    it("Service Worker chi luu /faq, /guide va tep tinh, khong luu trang rieng tu hay luong SSE", () => {
      const swPath = path.join(webRoot, "public", "sw.js");
      assert.equal(fs.existsSync(swPath), true);

      const swContent = fs.readFileSync(swPath, "utf8");
      assert.equal(
        swContent.includes('PRECACHE_PAGES = ["/faq", "/guide"]'),
        true,
      );
      assert.equal(swContent.includes("/_next/static/"), true);
      for (const privatePath of [
        "/my-tickets",
        "/checkout",
        "/admin",
        "/organizer",
        "/buyer",
        "/images/",
      ]) {
        const quoted = [
          `"${privatePath}`,
          `'${privatePath}`,
          "`" + privatePath,
        ];
        assert.equal(
          quoted.some((q) => swContent.includes(q)),
          false,
          `sw.js khong duoc cache ${privatePath}`,
        );
      }
    });

    it("Root layout khai bao manifest va gan PwaRegistrar goi navigator.serviceWorker.register", () => {
      const layoutPath = path.join(webRoot, "src", "app", "layout.tsx");
      const registrarPath = path.join(
        webRoot,
        "src",
        "shared",
        "ui",
        "pwa-registrar.tsx",
      );
      assert.equal(fs.existsSync(layoutPath), true);
      assert.equal(fs.existsSync(registrarPath), true);

      const layoutContent = fs.readFileSync(layoutPath, "utf8");
      const registrarContent = fs.readFileSync(registrarPath, "utf8");
      assert.equal(layoutContent.includes("/manifest.webmanifest"), true);
      assert.equal(layoutContent.includes("PwaRegistrar"), true);
      assert.equal(
        registrarContent.includes("navigator.serviceWorker.register"),
        true,
      );
    });
  });

  describe("2. Trang Phap ly / FAQ (/faq) va Huong dan su dung (/guide) dung docs va ngon ngu doi thuong", () => {
    const allText = () =>
      JSON.stringify([
        FAQ_ITEMS,
        TERMS_SECTIONS,
        PRIVACY_BLOCKS,
        REFUND_POLICIES,
        REFUND_NOTES,
        LEGAL_TABS,
        GUIDE_BY_ROLE,
        GUIDE_ROLES,
        GUIDE_TIP,
      ]);

    it("Noi dung khong dung thuat ngu ky thuat, ma UC hay noi dung da bi loai bo", () => {
      const text = allText();
      for (const banned of [
        "Redis",
        "IPN",
        "HMAC",
        "SSE",
        "JWT",
        "bcrypt",
        "Service Worker",
        "PWA",
        "Offline",
        "SVG",
        "TTL",
        "UC0",
        "UC1",
        "AVAILABLE",
        "SOLD",
        "FLEXIBLE",
        "hàng chờ ảo",
        "Virtual Waiting Room",
        "10 phút",
        "600 giây",
        "70%",
      ]) {
        assert.equal(text.includes(banned), false, `con thuat ngu: ${banned}`);
      }
    });

    it("Giu cho 5 phut, toi da 6 ve va muc hoan dung hien chuong", () => {
      const text = allText();
      assert.equal(text.includes("5 phút"), true);
      assert.equal(text.includes("tối đa 6 vé"), true);

      const flexible = REFUND_POLICIES.find((p) => p.name === "Linh hoạt");
      assert.deepEqual(
        flexible?.rows.map((r) => r.result),
        ["Hoàn 100%", "Hoàn 50%", "Không hoàn"],
      );
      const strict = REFUND_POLICIES.find((p) => p.name === "Nghiêm ngặt");
      assert.deepEqual(
        strict?.rows.map((r) => r.result),
        ["Hoàn 50%", "Không hoàn"],
      );
      assert.equal(
        REFUND_POLICIES.some((p) => p.name === "Không hoàn vé"),
        true,
      );
    });

    it("Cac tab co du noi dung va tham so khong hop le quay ve tab mac dinh", () => {
      assert.equal(LEGAL_TABS.length, 4);
      assert.equal(parseLegalTab("refund"), "refund");
      assert.equal(parseLegalTab("khong-ton-tai"), "faq");
      assert.equal(parseLegalTab(undefined), "faq");
      assert.equal(GUIDE_ROLES.length, 3);
      assert.equal(parseGuideRole("staff"), "staff");
      assert.equal(parseGuideRole("x"), "buyer");
      assert.equal(GUIDE_BY_ROLE.staff.ctaHref, "/gate/scanner");
    });

    it("Khong con lien ket den cac trang chinh sach khong ton tai (/terms, /privacy, /help, /guarantee, /support)", () => {
      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) return walk(full);
          return /\.tsx?$/.test(entry.name) ? [full] : [];
        });
      const dead = /href="\/(terms|privacy|help|guarantee|support)"/;
      const offenders = walk(path.join(webRoot, "src")).filter((file) =>
        dead.test(fs.readFileSync(file, "utf8")),
      );
      assert.deepEqual(offenders, []);
    });

    it("Trang /faq va /guide khong dung next/image, khong dung anh su kien trang tri", () => {
      for (const file of [
        "guide-page.tsx",
        "faq-page.tsx",
        "faq-explorer.tsx",
        "support-hero.tsx",
        "legal-sections.tsx",
      ]) {
        const content = fs.readFileSync(
          path.join(webRoot, "src", "features", "support", "ui", file),
          "utf8",
        );
        assert.equal(content.includes('from "next/image"'), false, file);
        assert.equal(content.includes("/images/events/"), false, file);
      }
    });
  });
});
