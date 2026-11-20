import { OrderStatus } from "@tickethub/shared";
import type { RefundTransactionType } from "./refund-gateway";
import { formatVnpayDate } from "./vnpay-date";

export const MAX_REFUND_ATTEMPTS = 3;
export const REFUND_RETRY_BASE_MS = 30_000;

/** Hoan toan phan (02) khi hoan het mot lan; hoan mot phan (03) cac truong hop con lai. */
export function refundTransactionType(
  isPartial: boolean,
): RefundTransactionType {
  return isPartial ? "03" : "02";
}

/** Tong tien hoan (VND nguyen) tu cac ban ghi hoan tien. */
export function sumRefundVnd(amounts: Array<string | number>): number {
  return amounts.reduce<number>((sum, a) => sum + Math.round(Number(a)), 0);
}

/** Khoang lui tang dan: 30 giay, 60 giay, 120 giay, ... */
export function refundRetryDelayMs(attempt: number): number {
  return REFUND_RETRY_BASE_MS * 2 ** Math.max(0, attempt);
}

export function shouldRetryRefund(attempt: number): boolean {
  return attempt < MAX_REFUND_ATTEMPTS;
}

/** Thoi diem giao dich goc cho API hoan tien: uu tien thoi diem tao thanh toan da luu. */
export function resolveOriginalTransactionDate(
  rawCallback: unknown,
  createdAt: Date,
): string {
  const stored = (rawCallback as { vnp_CreateDate?: unknown } | null)
    ?.vnp_CreateDate;
  return typeof stored === "string" && /^\d{14}$/.test(stored)
    ? stored
    : formatVnpayDate(createdAt);
}

/** Noi dung hoan tien chi gom ky tu ASCII in duoc. */
export function refundOrderInfo(orderCode: string): string {
  return `Hoan tien don ${orderCode}`
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 255);
}

/** Don cho hoan tien do thanh toan muon: hoan xong chuyen sang REFUNDED. */
export function orderBecomesRefunded(orderStatus: string): boolean {
  return orderStatus === OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING;
}

export interface RefundRequestedPayload {
  orderId: string;
  refundIds: string[];
  isPartial: boolean;
}

/** Doc payload cua su kien REFUND_REQUESTED; tra ve null neu thieu truong bat buoc. */
export function parseRefundRequestedPayload(
  payload: unknown,
): RefundRequestedPayload | null {
  const p = payload as Partial<RefundRequestedPayload> | null;
  if (
    !p ||
    typeof p.orderId !== "string" ||
    !Array.isArray(p.refundIds) ||
    p.refundIds.length === 0 ||
    p.refundIds.some((id) => typeof id !== "string") ||
    typeof p.isPartial !== "boolean"
  ) {
    return null;
  }
  return { orderId: p.orderId, refundIds: p.refundIds, isPartial: p.isPartial };
}
