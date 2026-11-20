import { EventStatus, OrderStatus, SeatStatus } from "@tickethub/shared";
import type { PaymentOrder, PaymentTransaction } from "./payment.models";

/** Ly do hoan tien tu dong khi thanh toan den muon va khong khoi phuc duoc ve. */
export const LATE_PAYMENT_REFUND_REASON = "PAYMENT_EXPIRED";

export interface RestorableSeat {
  status: string;
  holdOrderId: string | null;
}

export interface RestorableInventory {
  isSeated: boolean;
  capacity: number;
  heldCount: number;
  soldCount: number;
}

/** Ghe dung duoc khi con trong hoac van dang giu boi chinh don nay. */
export function canRestoreSeat(seat: RestorableSeat, orderId: string): boolean {
  return (
    seat.status === SeatStatus.AVAILABLE ||
    (seat.status === SeatStatus.HELD && seat.holdOrderId === orderId)
  );
}

/**
 * Ve dung: neu don con PENDING thi cho giu cua don chua bi tra (held_count con du);
 * neu don da EXPIRED thi cho da duoc tra, phai con du suc chua de giu lai.
 */
export function canRestoreStanding(
  inventory: RestorableInventory,
  quantity: number,
  orderStatus: string,
): boolean {
  if (inventory.isSeated) return false;
  if (orderStatus === OrderStatus.PENDING) {
    return inventory.heldCount >= quantity;
  }
  return (
    inventory.soldCount + inventory.heldCount + quantity <= inventory.capacity
  );
}

/** Chi khoi phuc ve khi su kien con mo ban; su kien bi dinh chi/ket thuc thi hoan tien. */
export function eventAllowsRestoration(eventStatus: string | null): boolean {
  return eventStatus === EventStatus.PUBLISHED;
}

export interface LateRefundPlan {
  amount: number;
  reason: string;
  idempotencyKey: string;
}

/** Hoan 100% so tien da thanh toan; khoa idempotency theo giao dich de IPN lap khong tao hai lan. */
export function planLateRefund(
  order: Pick<PaymentOrder, "finalAmount">,
  transaction: Pick<PaymentTransaction, "id">,
): LateRefundPlan {
  return {
    amount: Number(order.finalAmount),
    reason: LATE_PAYMENT_REFUND_REASON,
    idempotencyKey: `late-ipn:${transaction.id}`,
  };
}
