import type { IpnDecision } from "../domain/ipn-decision";
import {
  areSettlementItemsValid,
  evaluateIpn,
  isFinalCallback,
} from "../domain/ipn-rules";
import { eventAllowsRestoration } from "../domain/late-payment-rules";
import type {
  PaymentOrder,
  PaymentTransaction,
  VnpayParams,
} from "../domain/payment.models";
import type { PaymentGateway } from "../domain/payment-gateway";
import type {
  IpnTransaction,
  IpnUnitOfWork,
  PaymentQueryPort,
  SettlementNotifier,
} from "../domain/payment.ports";

/**
 * Xu ly webhook IPN cua VNPay: xac minh chu ky, doi chieu so tien ba nguon
 * (callback, giao dich, don hang) roi cap nhat ton kho, giao dich, don hang va
 * cap ve trong mot DB transaction. Callback lap lai khong cap ve them.
 */
export class ProcessVnpayIpnUseCase {
  constructor(
    private readonly gateway: PaymentGateway,
    private readonly query: PaymentQueryPort,
    private readonly unitOfWork: IpnUnitOfWork,
    private readonly notifier?: SettlementNotifier,
  ) {}

  async process(params: VnpayParams): Promise<IpnDecision> {
    const verified = this.gateway.verifyCallback(params);
    if (!verified.verified || !verified.transactionRef) {
      return "INVALID_SIGNATURE";
    }

    if (!isFinalCallback(params)) return "MANUAL_REVIEW";
    return this.settleVerified(
      params,
      verified.transactionRef,
      verified.success,
    );
  }

  async settleVerified(
    params: VnpayParams,
    transactionRef: string,
    success: boolean,
  ): Promise<IpnDecision> {
    // Giao dich do Backend tao truoc khi thanh toan
    const existing = await this.query.findVnpayTransactionByRef(transactionRef);
    if (!existing) return "ORDER_NOT_FOUND";

    const decision = await this.unitOfWork.run((tx) =>
      this.settle(tx, existing.id, existing.orderId, params, {
        success,
        providerTransactionId: params.vnp_TransactionNo ?? null,
      }),
    );

    // Chi xoa cache / phat SSE sau khi DB commit thanh cong
    if (
      decision === "APPLY_SUCCESS" ||
      decision === "RECORD_FAILURE" ||
      decision === "LATE_RESTORED"
    ) {
      const impact = await this.query.findSettlementImpact(existing.orderId);
      if (impact) {
        await this.notifier?.orderSettled(
          impact,
          decision !== "RECORD_FAILURE",
        );
      }
    }

    return decision;
  }

  private async settle(
    tx: IpnTransaction,
    transactionId: string,
    orderId: string,
    params: VnpayParams,
    callback: { success: boolean; providerTransactionId: string | null },
  ): Promise<IpnDecision> {
    const order = await tx.lockOrder(orderId);
    if (!order) return "ORDER_NOT_FOUND";

    const transaction = await tx.lockTransaction(transactionId);
    if (!transaction || transaction.orderId !== order.id) {
      return "MANUAL_REVIEW";
    }

    const now = new Date();
    const { decision, amountMatches } = evaluateIpn({
      params,
      paymentSuccessful: callback.success,
      transaction,
      order,
      now,
    });

    if (decision === "LATE_PAYMENT") {
      return this.settleLatePayment(tx, order, transaction, params, {
        providerTransactionId: callback.providerTransactionId,
        now,
      });
    }

    if (decision !== "APPLY_SUCCESS" && decision !== "RECORD_FAILURE") {
      // Thanh toan thanh cong nhung khong the xac nhan don: luu bang chung doi soat mot lan
      if (
        decision === "MANUAL_REVIEW" &&
        callback.success &&
        amountMatches &&
        !(await tx.hasManualReviewAudit(transaction.id))
      ) {
        await tx.recordManualReview({
          transaction,
          order,
          params,
          providerTxNumber: callback.providerTransactionId,
        });
      }
      return decision;
    }

    const items = await tx.findOrderItems(order.id);
    if (!areSettlementItemsValid(items)) return "MANUAL_REVIEW";

    const sold = decision === "APPLY_SUCCESS";
    for (const item of items) {
      if (item.seatId !== null) {
        if (!(await tx.settleSeat(order, item, sold, now))) {
          throw new Error(
            "VNPAY_SEAT_CONFLICT: seat reservation is no longer valid",
          );
        }
        continue;
      }
      // Rollback toan bo neu du lieu kho ve bat nhat
      if (!(await tx.settleStanding(order, item, sold, now))) {
        throw new Error(
          "VNPAY_INVENTORY_CONFLICT: manual reconciliation required",
        );
      }
    }

    await tx.completeTransaction({
      transactionId: transaction.id,
      success: sold,
      params,
      providerTxNumber: callback.providerTransactionId,
      now,
    });
    await tx.completeOrder(order.id, sold, now);

    if (sold) {
      await tx.issueTicketsWithOutbox({ order, transaction, items, now });
    }
    return decision;
  }

  /**
   * Thanh toan thanh cong den sau khi don het han hoac bi huy. Trong cung mot transaction:
   * neu su kien con mo ban va ghe / hang ve van dung duoc thi khoi phuc va cap ve; nguoc lai
   * chuyen don sang PAYMENT_EXPIRED_REFUND_PENDING va yeu cau hoan tien 100% qua outbox.
   * Khach khong bao gio bi tru tien ma khong co ve va khong duoc hoan tien.
   */
  private async settleLatePayment(
    tx: IpnTransaction,
    order: PaymentOrder,
    transaction: PaymentTransaction,
    params: VnpayParams,
    ctx: { providerTransactionId: string | null; now: Date },
  ): Promise<IpnDecision> {
    const { now } = ctx;
    const items = await tx.findOrderItems(order.id);
    const eventStatus = await tx.findEventStatus(order.eventId);

    const restorable =
      areSettlementItemsValid(items) &&
      eventAllowsRestoration(eventStatus) &&
      (await tx.tryRestoreOrder(order, items, now));

    // Tien da ve tai khoan merchant: giao dich luon ghi nhan la SUCCESS
    await tx.completeTransaction({
      transactionId: transaction.id,
      success: true,
      params,
      providerTxNumber: ctx.providerTransactionId,
      now,
    });

    if (restorable) {
      await tx.completeOrder(order.id, true, now);
      await tx.issueTicketsWithOutbox({ order, transaction, items, now });
      await tx.recordLateRestored({ order, transaction, now });
      return "LATE_RESTORED";
    }

    await tx.requestLateRefund({ order, transaction, now });
    return "LATE_REFUND_PENDING";
  }
}
