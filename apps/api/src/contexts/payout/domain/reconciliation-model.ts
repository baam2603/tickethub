export interface VnpayReportRow {
  kind: "PAYMENT" | "REFUND";
  ref: string;
  number: string;
  amount: number;
  transactionType: "01" | "02" | "03";
}

export interface ReconciliationLedger {
  eventOrders: { id: string; code: string; status: string; amount: string }[];
  payments: {
    orderId: string;
    ref: string;
    number: string | null;
    amount: string;
    status: string;
    bankCode: string | null;
    payDate: Date | null;
    providerSuccessEvidence: boolean;
  }[];
  eventRefunds: {
    id: string;
    orderId: string;
    amount: string;
    number: string | null;
    status: string;
    processedAt: Date | null;
  }[];
}
