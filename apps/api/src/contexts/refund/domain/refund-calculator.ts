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

  let cumulativePrice = 0;
  let allocatedPaid = 0;
  // Phân bổ phần lẻ trên tổng lũy kế để hoàn toàn đơn đúng số tiền đã thu.
  for (const t of [...tickets].sort((first, second) =>
    first.ticketId.localeCompare(second.ticketId),
  )) {
    const originalPrice = t.unitPrice;
    cumulativePrice += originalPrice;
    const cumulativePaid = Math.round(cumulativePrice * paidRatio);
    const effectivePaidPrice = cumulativePaid - allocatedPaid;
    allocatedPaid = cumulativePaid;
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
