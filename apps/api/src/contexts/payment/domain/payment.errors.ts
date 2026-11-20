export type PaymentErrorKind =
  "RATE_LIMITED" | "UNAVAILABLE" | "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST";

/** Loi nghiep vu cua context Payment; than phan hoi cu la chuoi thuan. */
export class PaymentDomainError extends Error {
  constructor(
    readonly kind: PaymentErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "PaymentDomainError";
  }
}

export const paymentErrors = {
  orderNotFound: () => new PaymentDomainError("NOT_FOUND", "Order not found"),
  orderNotPending: () =>
    new PaymentDomainError("CONFLICT", "Order is not pending"),
  holdTooCloseToExpiry: () =>
    new PaymentDomainError(
      "CONFLICT",
      "Order hold is expired or too close to expiry",
    ),
  transactionNotPending: () =>
    new PaymentDomainError(
      "CONFLICT",
      "VNPay transaction is no longer pending",
    ),
  amountMismatch: () =>
    new PaymentDomainError("CONFLICT", "Payment amount mismatch"),
  invalidAmount: () =>
    new PaymentDomainError("BAD_REQUEST", "Invalid order amount for VNPay"),
};
