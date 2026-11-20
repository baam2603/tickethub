import type { ReconciliationStatus } from "@tickethub/shared";

export interface ReconciliationItem {
  orderId: string | null;
  orderCode: string | null;
  eventId: string;
  eventTitle: string;
  orderAmount: number;
  paidAmount: number;
  refundedAmount: number;
  transactionRef: string | null;
  providerTxNumber: string | null;
  bankCode: string | null;
  payDate: string | null;
  reconciliationStatus: ReconciliationStatus;
  kind: "PAYMENT" | "REFUND";
  gatewayAmount: number | null;
  issue: string | null;
}
