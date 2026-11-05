import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatTicketSeatInfo,
  calculateEffectivePaidPrice,
} from "../src/booking/buyer-order.service";

describe("BuyerOrderService Helper Functions", () => {
  it("formats seated ticket seatInfo correctly", () => {
    const seatInfo = formatTicketSeatInfo(true, "VIP", {
      zoneName: "VIP",
      rowLabel: "A",
      seatNumber: "05",
    });
    assert.deepEqual(seatInfo, {
      zoneName: "VIP",
      rowLabel: "A",
      seatNumber: "05",
      formattedLabel: "Khu VIP - Hàng A - Ghế 05",
    });
  });

  it("formats standing GA ticket seatInfo correctly without N/A", () => {
    const seatInfo = formatTicketSeatInfo(false, "GA - Fanzone", null);
    assert.deepEqual(seatInfo, {
      zoneName: "GA - Fanzone",
      rowLabel: null,
      seatNumber: null,
      formattedLabel: "Khu vực: GA - Fanzone (Vé đứng)",
    });
  });

  it("calculates effectivePaidPrice with pro-rata voucher deduction", () => {
    // Total: 1,000,000; Final: 800,000; Unit price: 500,000 -> 400,000
    const price = calculateEffectivePaidPrice(500000, 1000000, 800000);
    assert.equal(price, 400000);
  });

  it("calculates effectivePaidPrice without discount when finalAmount == totalAmount", () => {
    const price = calculateEffectivePaidPrice(500000, 500000, 500000);
    assert.equal(price, 500000);
  });
});
