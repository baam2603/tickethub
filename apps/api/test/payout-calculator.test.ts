import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculatePayout } from "../src/payouts/payout-calculator";

describe("PayoutCalculator", () => {
  it("calculates standard payout with 5% platform fee and 1.5% gateway fee", () => {
    // grossRevenue: 100.000.000, refundDeduction: 2.000.000
    // retainedRevenue: 98.000.000
    // platformFee: 98.000.000 * 0.05 = 4.900.000
    // gatewayFee: 100.000.000 * 0.015 = 1.500.000
    // netPayout: 98.000.000 - 4.900.000 - 1.500.000 = 91.600.000
    const result = calculatePayout(100000000, 2000000);

    assert.equal(result.grossRevenue, 100000000);
    assert.equal(result.refundDeduction, 2000000);
    assert.equal(result.retainedRevenue, 98000000);
    assert.equal(result.platformFee, 4900000);
    assert.equal(result.gatewayFee, 1500000);
    assert.equal(result.netPayout, 91600000);
  });

  it("handles zero revenue properly", () => {
    const result = calculatePayout(0, 0);

    assert.equal(result.grossRevenue, 0);
    assert.equal(result.refundDeduction, 0);
    assert.equal(result.retainedRevenue, 0);
    assert.equal(result.platformFee, 0);
    assert.equal(result.gatewayFee, 0);
    assert.equal(result.netPayout, 0);
  });

  it("handles 100% refunded revenue safely without negative net payout", () => {
    const result = calculatePayout(50000000, 50000000);

    assert.equal(result.grossRevenue, 50000000);
    assert.equal(result.refundDeduction, 50000000);
    assert.equal(result.retainedRevenue, 0);
    assert.equal(result.platformFee, 0);
    assert.equal(result.gatewayFee, 750000);
    assert.equal(result.netPayout, 0);
  });

  it("rounds money figures correctly to whole VND integers", () => {
    // 33.333.333 revenue, 1.111.111 refund
    const result = calculatePayout(33333333, 1111111);

    assert.equal(Number.isInteger(result.platformFee), true);
    assert.equal(Number.isInteger(result.gatewayFee), true);
    assert.equal(Number.isInteger(result.netPayout), true);
  });
});
