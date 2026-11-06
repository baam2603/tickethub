export const UserRole = {
  BUYER: "BUYER",
  ORGANIZER: "ORGANIZER",
  GATE_STAFF: "GATE_STAFF",
  ADMIN: "ADMIN",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  PENDING_EMAIL: "PENDING_EMAIL",
  ACTIVE: "ACTIVE",
  LOCKED: "LOCKED",
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const OrganizerStatus = {
  PENDING_VERIFICATION: "PENDING_VERIFICATION",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
} as const;
export type OrganizerStatus =
  (typeof OrganizerStatus)[keyof typeof OrganizerStatus];

export const EventStatus = {
  DRAFT: "DRAFT",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  PUBLISHED: "PUBLISHED",
  ENDED: "ENDED",
  CANCELLED: "CANCELLED",
  SUSPENDED: "SUSPENDED",
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

export const RefundPolicyType = {
  STRICT: "STRICT",
  FLEXIBLE: "FLEXIBLE",
  CUSTOM: "CUSTOM",
  NO_REFUND: "NO_REFUND",
} as const;
export type RefundPolicyType =
  (typeof RefundPolicyType)[keyof typeof RefundPolicyType];

export const SeatStatus = {
  AVAILABLE: "AVAILABLE",
  HELD: "HELD",
  SOLD: "SOLD",
  BLOCKED: "BLOCKED",
} as const;
export type SeatStatus = (typeof SeatStatus)[keyof typeof SeatStatus];

export const OrderStatus = {
  PENDING: "PENDING",
  PAID: "PAID",
  EXPIRED: "EXPIRED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
  PAYMENT_EXPIRED_REFUND_PENDING: "PAYMENT_EXPIRED_REFUND_PENDING",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const TicketStatus = {
  SOLD: "SOLD",
  CHECKED_IN: "CHECKED_IN",
  CANCELLED: "CANCELLED",
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TransactionStatus = {
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
} as const;
export type TransactionStatus =
  (typeof TransactionStatus)[keyof typeof TransactionStatus];

export const RefundStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const PayoutStatus = {
  PENDING: "PENDING",
  HOLD: "HOLD",
  PAID_OUT: "PAID_OUT",
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export const OutboxStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

export const PaymentProvider = {
  VNPAY: "VNPAY",
} as const;
export type PaymentProvider =
  (typeof PaymentProvider)[keyof typeof PaymentProvider];
