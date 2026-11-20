import type { PayoutStatus, ReconciliationStatus } from "@tickethub/shared";

export interface SettlementPage<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface ReconciliationRow {
  orderId: string | null;
  orderCode: string | null;
  eventId: string | null;
  eventTitle: string | null;
  orderAmount: number;
  paidAmount: number;
  refundedAmount: number;
  transactionRef: string | null;
  providerTxNumber: string | null;
  bankCode: string | null;
  payDate: string | null;
  reconciliationStatus: ReconciliationStatus;
}

export interface ReconciliationReport extends SettlementPage<ReconciliationRow> {
  summary: {
    totalTransactions: number;
    totalOrderAmount: number;
    totalPaidAmount: number;
    totalRefundedAmount: number;
    matchedCount: number;
    mismatchedCount: number;
  };
}

export interface PayoutRow {
  id: string;
  eventId: string;
  eventTitle: string;
  organizationName: string;
  totalRevenue: number;
  refundDeduction: number;
  platformFee: number;
  gatewayFee: number;
  netPayout: number;
  status: PayoutStatus;
  holdReason: string | null;
  paidOutAt: string | null;
}
