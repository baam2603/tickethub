import { RefundPolicyType } from "@tickethub/shared";

export interface TicketToRefund {
  ticketId: string;
  unitPrice: number;
  ticketCode?: string;
  seatLabel?: string;
}

export interface CalculateRefundOptions {
  tickets: TicketToRefund[];
  totalAmount: number;
  finalAmount: number;
  refundPercentage: number;
  totalPreviouslyRefunded?: number;
}

export interface RefundItemBreakdown {
  ticketId: string;
  ticketCode: string;
  seatLabel: string;
  originalPrice: number;
  effectivePaidPrice: number;
  refundAmount: number;
  feeDeducted: number;
}

export interface RefundBreakdownResult {
  items: RefundItemBreakdown[];
  totalRefundAmount: number;
  totalFeeDeducted: number;
}

/**
 * Tính phần trăm hoàn tiền dựa vào chính sách và thời gian trước sự kiện
 */
export function computeRefundPercentage(
  policyType: RefundPolicyType,
  startTime: Date,
  now: Date = new Date(),
): number {
  if (policyType === RefundPolicyType.NO_REFUND) {
    return 0;
  }

  const diffMs = startTime.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (policyType === RefundPolicyType.FLEXIBLE) {
    if (diffDays >= 7) return 100;
    if (diffDays >= 3) return 50;
    return 0;
  }

  if (policyType === RefundPolicyType.STRICT) {
    if (diffDays >= 14) return 50;
    return 0;
  }

  // CUSTOM hoặc fallback
  return 0;
}

/**
 * Tính số ngày còn lại đến sự kiện
 */
export function computeDaysUntilEvent(
  startTime: Date,
  now: Date = new Date(),
): number {
  const diffMs = startTime.getTime() - now.getTime();
  const days = diffMs / (1000 * 60 * 60 * 24);
  return Number(days.toFixed(1));
}

/**
 * Phân bổ giá trị hoàn tiền cho từng vé, khấu trừ tỷ lệ voucher và ép trần an toàn (Safety Cap)
 */
export function calculateTicketRefundBreakdown(
  options: CalculateRefundOptions,
): RefundBreakdownResult {
  const {
    tickets,
    totalAmount,
    finalAmount,
    refundPercentage,
    totalPreviouslyRefunded = 0,
  } = options;

  const paidRatio = totalAmount > 0 ? finalAmount / totalAmount : 1;
  let remainingAllowedRefund = Math.max(
    0,
    finalAmount - totalPreviouslyRefunded,
  );

  const items: RefundItemBreakdown[] = [];
  let totalRefundAmount = 0;
  let totalFeeDeducted = 0;

  for (const t of tickets) {
    const originalPrice = t.unitPrice;
    const effectivePaidPrice = Math.round(originalPrice * paidRatio);
    const calculatedRefund = Math.round(
      effectivePaidPrice * (refundPercentage / 100),
    );

    // Ép trần an toàn không vượt quá số tiền thực thu còn lại của đơn hàng
    const refundAmount = Math.min(calculatedRefund, remainingAllowedRefund);
    remainingAllowedRefund = Math.max(0, remainingAllowedRefund - refundAmount);

    const feeDeducted = effectivePaidPrice - refundAmount;

    totalRefundAmount += refundAmount;
    totalFeeDeducted += feeDeducted;

    items.push({
      ticketId: t.ticketId,
      ticketCode: t.ticketCode ?? "",
      seatLabel: t.seatLabel ?? "GA",
      originalPrice,
      effectivePaidPrice,
      refundAmount,
      feeDeducted,
    });
  }

  return {
    items,
    totalRefundAmount,
    totalFeeDeducted,
  };
}
