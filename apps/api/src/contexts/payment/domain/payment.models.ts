import type { OrderStatus, TransactionStatus } from "@tickethub/shared";

/** Don hang nhin tu context Payment (chi cac cot can cho thanh toan). */
export interface PaymentOrder {
  id: string;
  orderCode: string;
  userId: string;
  eventId: string;
  status: OrderStatus;
  /** So tien PostgreSQL dang chuoi, vi du "150000.00". */
  finalAmount: string;
  expiresAt: Date;
}

export interface PaymentTransaction {
  id: string;
  orderId: string;
  transactionRef: string;
  status: TransactionStatus;
  amount: string;
  provider: string;
}

export interface PendingVnpayTransaction {
  id: string;
  transactionRef: string;
  status: TransactionStatus;
  amount: string;
  paymentUrl: string | null;
}

export interface SettlementItem {
  seatId: string | null;
  ticketTypeId: string;
  quantity: number;
}

export interface CreatedPayment {
  orderId: string;
  orderCode: string;
  transactionRef: string;
  paymentUrl: string;
  amountVnd: number;
  expiresAt: string;
}

export interface SettlementImpact {
  eventId: string;
  seatIds: string[];
}

export type VnpayParams = Record<string, string>;
