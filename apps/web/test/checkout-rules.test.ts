import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ORDER,
  computeTotals,
  evaluateVoucher,
  fallbackOrder,
  formatTimer,
  mapOrderResponse,
  paymentFailureMessage,
  secondsUntil,
  splitFullName,
  validateRecipient,
} from "../src/features/payment/domain/checkout-rules.ts";

const NOW = Date.parse("2026-11-11T10:00:00.000Z");

describe("Checkout domain: order mapping", () => {
  test("merges rows of the same ticket type and collects seat labels", () => {
    const order = mapOrderResponse(
      {
        id: "abcdef12-0000",
        status: "PENDING",
        totalAmount: "5000000",
        expiresAt: new Date(NOW + 300_000).toISOString(),
        items: [
          {
            ticketTypeId: "t1",
            ticketType: { name: "VIP", price: "2500000", isSeated: true },
            seat: { rowLabel: "A", seatNumber: "01", zoneName: "VIP" },
            quantity: 1,
            unitPrice: "2500000",
          },
          {
            ticketTypeId: "t1",
            ticketType: { name: "VIP", price: "2500000", isSeated: true },
            seat: { rowLabel: "A", seatNumber: "02", zoneName: "VIP" },
            quantity: 1,
          },
        ],
        event: { id: "e1", title: "Show", venueName: "Nha hat", city: "HN" },
      },
      "fallback-id",
      NOW,
    );
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0]?.quantity, 2);
    assert.deepEqual(order.items[0]?.seats, [
      "Hàng A - Ghế 01",
      "Hàng A - Ghế 02",
    ]);
    assert.equal(order.items[0]?.isStanding, false);
    assert.equal(order.items[0]?.unitPrice, 2500000);
    assert.equal(order.orderCode, "ORD-ABCDEF12");
    assert.equal(order.totalAmount, 5000000);
    assert.equal(order.eventTitle, "Show");
    assert.equal(order.eventVenue, "Nha hat, HN");
  });

  test("treats rows without a seat as standing and falls back to sample data", () => {
    const order = mapOrderResponse(
      { items: [{ ticketTypeId: "ga", quantity: 3, unitPrice: 100000 }] },
      "ord-1234567890",
      NOW,
    );
    assert.equal(order.items[0]?.isStanding, true);
    assert.equal(order.items[0]?.quantity, 3);
    assert.equal(order.orderId, "ord-1234567890");
    assert.equal(order.eventTitle, DEFAULT_ORDER.eventTitle);
    assert.equal(order.expiresAt, new Date(NOW + 300_000).toISOString());

    const empty = mapOrderResponse({}, "ord-1", NOW);
    assert.deepEqual(empty.items, DEFAULT_ORDER.items);
  });

  test("builds a sample order from an id when the real one cannot be loaded", () => {
    const o = fallbackOrder("abcdef1234");
    assert.equal(o.orderId, "abcdef1234");
    assert.equal(o.orderCode, "ORD-ABCDEF12");
    assert.equal(fallbackOrder(null).orderId, "ord-sample-01");
  });
});

describe("Checkout domain: hold timer", () => {
  test("never goes negative and follows the server expiry", () => {
    assert.equal(secondsUntil(new Date(NOW + 61_500).toISOString(), NOW), 61);
    assert.equal(secondsUntil(new Date(NOW - 5000).toISOString(), NOW), 0);
  });

  test("formats MM:SS", () => {
    assert.equal(formatTimer(299), "04:59");
    assert.equal(formatTimer(59), "00:59");
    assert.equal(formatTimer(0), "00:00");
  });
});

describe("Checkout domain: vouchers and totals", () => {
  test("accepts fixed and percentage vouchers case-insensitively", () => {
    assert.deepEqual(evaluateVoucher(" giam50k ", 1_000_000), {
      ok: true,
      code: "GIAM50K",
      discount: 50000,
    });
    assert.deepEqual(evaluateVoucher("vip10", 2_550_000), {
      ok: true,
      code: "VIP10",
      discount: 255000,
    });
  });

  test("rejects empty and unknown vouchers with a message", () => {
    const empty = evaluateVoucher("  ", 1);
    assert.equal(empty.ok, false);
    const bad = evaluateVoucher("NOPE", 1);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /không hợp lệ/);
  });

  test("adds the platform fee, subtracts the voucher and never goes below zero", () => {
    assert.deepEqual(computeTotals(1_000_000, 50_000), {
      subtotal: 1_000_000,
      platformFee: 250_000,
      finalTotal: 1_200_000,
    });
    assert.equal(computeTotals(0, 0).subtotal, 3_600_000);
    assert.equal(computeTotals(10_000, 9_999_999).finalTotal, 0);
  });
});

describe("Checkout domain: recipient", () => {
  test("splits a Vietnamese full name into given and family names", () => {
    assert.deepEqual(splitFullName("Nguyễn Văn An"), {
      firstName: "An",
      lastName: "Nguyễn Văn",
    });
    assert.deepEqual(splitFullName("An"), { firstName: "An", lastName: "" });
  });

  test("requires name, email and phone", () => {
    const ok = {
      firstName: "An",
      lastName: "",
      email: "a@b.vn",
      phone: "0912345678",
    };
    assert.equal(validateRecipient(ok), null);
    assert.match(validateRecipient({ ...ok, phone: " " }) ?? "", /đầy đủ/);
    assert.match(validateRecipient({ ...ok, email: "" }) ?? "", /đầy đủ/);
    assert.match(validateRecipient({ ...ok, firstName: "" }) ?? "", /đầy đủ/);
  });
});

describe("Checkout domain: payment failures", () => {
  test("never reports success and maps each status to a clear message", () => {
    assert.match(paymentFailureMessage(0), /kết nối/);
    assert.match(paymentFailureMessage(401), /đăng nhập/);
    assert.match(paymentFailureMessage(403), /quyền/);
    assert.match(paymentFailureMessage(404), /Không tìm thấy đơn hàng/);
    assert.match(paymentFailureMessage(409), /hết hạn giữ chỗ/);
    assert.match(paymentFailureMessage(429), /quá nhanh/);
    assert.match(paymentFailureMessage(500), /Không thể tạo thanh toán/);
    assert.match(paymentFailureMessage(undefined), /Không thể tạo thanh toán/);
    for (const status of [0, 401, 403, 404, 409, 429, 500, undefined]) {
      assert.doesNotMatch(paymentFailureMessage(status), /thành công/);
    }
  });
});
