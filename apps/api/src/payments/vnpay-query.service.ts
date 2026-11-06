import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { PaymentProvider } from "@tickethub/shared";
import { env } from "../config/env.config";
import { db } from "../database/db";
import { orders, transactions } from "../database/schema";
import { VnpayApi } from "./vnpay-api";
import { VnpayIpnService } from "./vnpay-ipn.service";

@Injectable()
export class VnpayQueryService {
  constructor(
    @Inject(VnpayApi) private readonly api: VnpayApi,
    @Inject(VnpayIpnService) private readonly ipn: VnpayIpnService,
  ) {}

  async query(userId: string, orderId: string) {
    const [payment] = await db
      .select({ payment: transactions })
      .from(transactions)
      .innerJoin(orders, eq(orders.id, transactions.orderId))
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.userId, userId),
          eq(transactions.provider, PaymentProvider.VNPAY),
        ),
      )
      .limit(1);
    if (!payment) throw new NotFoundException("Payment not found");
    if (!payment.payment.vnpCreateDate)
      throw new BadRequestException(
        "Original VNPay transaction date is missing; manual reconciliation required",
      );
    let result: Record<string, string>;
    try {
      result = await this.api.queryTransaction({
        transactionRef: payment.payment.transactionRef,
        transactionDate: payment.payment.vnpCreateDate,
        ipAddress: env.VNPAY_REFUND_IP,
      });
    } catch {
      throw new ServiceUnavailableException(
        "VNPay query unavailable or unverified",
      );
    }
    // QueryDR co the tra giao dich hoan tien. Khong dung chung ket qua nay de cap ve.
    if (result.vnp_ResponseCode !== "00" || result.vnp_TransactionType !== "01")
      return {
        decision: "MANUAL_REVIEW",
        responseCode: result.vnp_ResponseCode,
      };
    const decision = await this.ipn.settleVerified(
      result,
      {
        verified: true,
        success: result.vnp_TransactionStatus === "00",
        transactionRef: result.vnp_TxnRef!,
        ...(result.vnp_TransactionNo
          ? { providerTransactionId: result.vnp_TransactionNo }
          : {}),
      },
      "QUERYDR",
    );
    return { decision, responseCode: result.vnp_ResponseCode };
  }
}
