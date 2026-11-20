import { PaymentDomainError } from "../domain/payment.errors";
import type { CreatedPayment } from "../domain/payment.models";
import type { PaymentGateway } from "../domain/payment-gateway";
import type { CheckoutUnitOfWork } from "../domain/payment.ports";
import {
  assertExistingTransactionReusable,
  assertOrderPayable,
  generateTransactionRef,
  resolveAmountVnd,
  resolveClientIp,
} from "../domain/payment-rules";

export interface VnpayCheckoutConfig {
  returnUrl: string;
}

/**
 * Tao URL thanh toan VNPay cho don PENDING cua chinh nguoi mua. Don hang duoc
 * khoa FOR UPDATE; giao dich PENDING cu duoc tai su dung, khong tao ban ghi moi.
 */
export class CreateVnpayPaymentUseCase {
  constructor(
    private readonly unitOfWork: CheckoutUnitOfWork,
    private readonly gateway: PaymentGateway,
    private readonly config: VnpayCheckoutConfig,
  ) {}

  execute(
    userId: string,
    orderId: string,
    clientIp: string,
    idempotencyKey?: string,
  ): Promise<CreatedPayment> {
    if (
      idempotencyKey !== undefined &&
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(idempotencyKey)
    )
      throw new PaymentDomainError(
        "BAD_REQUEST",
        "Idempotency-Key must be a UUID",
      );
    return this.unitOfWork.run(async (tx) => {
      const order = assertOrderPayable(
        await tx.lockOwnedOrder(userId, orderId),
        new Date(),
      );

      const key = idempotencyKey
        ? `vnpay:${userId}:${idempotencyKey.toLowerCase()}`
        : `vnpay:${order.id}`;
      await tx.claimIdempotencyKey(key, order.id);
      const existing = await tx.lockVnpayTransaction(order.id);
      assertExistingTransactionReusable(existing, order);

      const amountVnd = resolveAmountVnd(order);
      const transactionRef =
        existing?.transactionRef ?? generateTransactionRef();

      if (existing?.paymentUrl)
        return {
          orderId: order.id,
          orderCode: order.orderCode,
          transactionRef,
          paymentUrl: existing.paymentUrl,
          amountVnd,
          expiresAt: order.expiresAt.toISOString(),
        };

      // Han thanh toan khong vuot qua thoi gian giu ve cua Booking
      const payment = await this.gateway.createPaymentUrl({
        transactionRef,
        amountVnd,
        orderInfo: `TicketHub order ${order.orderCode}`,
        returnUrl: this.config.returnUrl,
        ipAddress: resolveClientIp(clientIp),
        expiresAt: order.expiresAt,
      });

      // Luu giao dich truoc khi tra URL; chi INSERT khi chua co giao dich
      if (!existing) {
        await tx.insertPendingTransaction({
          orderId: order.id,
          transactionRef,
          amount: order.finalAmount,
          idempotencyKey: key,
          createDate: payment.createDate,
          paymentUrl: payment.paymentUrl,
        });
      }

      return {
        orderId: order.id,
        orderCode: order.orderCode,
        transactionRef: payment.transactionRef,
        paymentUrl: payment.paymentUrl,
        amountVnd,
        expiresAt: order.expiresAt.toISOString(),
      };
    });
  }
}
