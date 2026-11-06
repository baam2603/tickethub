import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RefundPolicyType } from "@tickethub/shared";
import {
  computeRefundPercentage,
  calculateTicketRefundBreakdown,
} from "../src/refunds/refund-calculator";

describe("RefundCalculator", () => {
  const eventStart = new Date("2026-11-20T20:00:00.000Z");

  it("returns 100% for FLEXIBLE policy 8 days before event", () => {
    const now = new Date("2026-11-12T20:00:00.000Z");
    const pct = computeRefundPercentage(
      RefundPolicyType.FLEXIBLE,
      eventStart,
      now,
    );
    assert.equal(pct, 100);
  });

  it("returns 50% for FLEXIBLE policy 4 days before event", () => {
    const now = new Date("2026-11-16T20:00:00.000Z");
    const pct = computeRefundPercentage(
      RefundPolicyType.FLEXIBLE,
      eventStart,
      now,
    );
    assert.equal(pct, 50);
  });

  it("returns 0% for FLEXIBLE policy 2 days before event", () => {
    const now = new Date("2026-11-18T20:00:00.000Z");
    const pct = computeRefundPercentage(
      RefundPolicyType.FLEXIBLE,
      eventStart,
      now,
    );
    assert.equal(pct, 0);
  });

  it("returns 50% for STRICT policy 15 days before event", () => {
    const now = new Date("2026-11-05T20:00:00.000Z");
    const pct = computeRefundPercentage(
      RefundPolicyType.STRICT,
      eventStart,
      now,
    );
    assert.equal(pct, 50);
  });

  it("returns 0% for NO_REFUND policy regardless of time", () => {
    const now = new Date("2026-10-01T20:00:00.000Z");
    const pct = computeRefundPercentage(
      RefundPolicyType.NO_REFUND,
      eventStart,
      now,
    );
    assert.equal(pct, 0);
  });

  it("calculates pro-rata voucher correctly and clamps safely", () => {
    // Đơn 2 vé: 2 x 2.500.000 = 5.000.000, voucher 500.000 -> finalAmount = 4.500.000
    const ticketsToRefund = [
      { ticketId: "tkt-1", unitPrice: 2500000 },
      { ticketId: "tkt-2", unitPrice: 2500000 },
    ];
    const breakdown = calculateTicketRefundBreakdown({
      tickets: ticketsToRefund,
      totalAmount: 5000000,
      finalAmount: 4500000,
      refundPercentage: 100,
      totalPreviouslyRefunded: 0,
    });

    assert.equal(breakdown.totalRefundAmount, 4500000);
    assert.equal(breakdown.items[0].effectivePaidPrice, 2250000);
    assert.equal(breakdown.items[0].refundAmount, 2250000);
    assert.equal(breakdown.items[1].effectivePaidPrice, 2250000);
    assert.equal(breakdown.items[1].refundAmount, 2250000);
  });

  it("safely clamps remaining amount when 1 ticket was already refunded", () => {
    // Đã hoàn vé 1 được 2.250.000, bây giờ hoàn tiếp vé 2
    const ticketsToRefund = [{ ticketId: "tkt-2", unitPrice: 2500000 }];
    const breakdown = calculateTicketRefundBreakdown({
      tickets: ticketsToRefund,
      totalAmount: 5000000,
      finalAmount: 4500000,
      refundPercentage: 100,
      totalPreviouslyRefunded: 2250000,
    });

    assert.equal(breakdown.totalRefundAmount, 2250000);
  });
});
