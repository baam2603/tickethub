export interface PayoutCalculationResult {
  grossRevenue: number;
  refundDeduction: number;
  retainedRevenue: number;
  platformFee: number;
  gatewayFee: number;
  netPayout: number;
}

/**
 * Tinh toan phan bo tai chinh quyet toan cho Ban to chuc
 * @param grossRevenue Tong doanh thu cac don hang thanh cong (bao gom ca cac don sau nay bi hoan tien toan bo)
 * @param refundDeduction Tong so tien hoan ve da tra cho khach
 * @param platformFeeRate Ty le phi nen tang TicketHub (mac dinh 5%)
 * @param gatewayFeeRate Ty le phi cong thanh toan VNPay (mac dinh 1.5%)
 */
export function calculatePayout(
  grossRevenue: number,
  refundDeduction: number,
  platformFeeRate = 0.05,
  gatewayFeeRate = 0.015,
): PayoutCalculationResult {
  const safeGrossRevenue = Math.max(0, Math.round(grossRevenue));
  const safeRefundDeduction = Math.max(0, Math.round(refundDeduction));

  // Doanh thu thuc giu lai cua su kien sau khi tru tien hoan
  const retainedRevenue = Math.max(
    0,
    safeGrossRevenue - safeRefundDeduction,
  );

  // Phi san tinh tren doanh thu thuc giu
  const platformFee = Math.round(retainedRevenue * platformFeeRate);

  // Phi cong thanh toan tinh tren tong so tien giao dich xu ly ban dau
  const gatewayFee = Math.round(safeGrossRevenue * gatewayFeeRate);

  // Thuc nhan ban to chuc (khong bao gio am)
  const netPayout = Math.max(
    0,
    retainedRevenue - platformFee - gatewayFee,
  );

  return {
    grossRevenue: safeGrossRevenue,
    refundDeduction: safeRefundDeduction,
    retainedRevenue,
    platformFee,
    gatewayFee,
    netPayout,
  };
}
