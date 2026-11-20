import { paymentErrors, PaymentDomainError } from "../domain/payment.errors";
import type { VnpayParams } from "../domain/payment.models";
import type { ProcessVnpayIpnUseCase } from "./process-vnpay-ipn.use-case";

type OwnedFilter = { orderId: string } | { transactionRef: string };
interface OwnedPaymentReader {
  findOwnedPayment(
    userId: string,
    filter: OwnedFilter,
  ): Promise<{
    orderId: string;
    orderCode: string;
    orderStatus: string;
    transactionStatus: string;
    transactionRef: string;
    createDate: string | null;
  } | null>;
}
interface QueryGateway {
  queryTransaction(input: {
    transactionRef: string;
    transactionDate: string;
    ipAddress: string;
  }): Promise<VnpayParams>;
}
export class QueryVnpayPaymentUseCase {
  constructor(
    private readonly reader: OwnedPaymentReader,
    private readonly gateway: QueryGateway,
    private readonly ipn: ProcessVnpayIpnUseCase,
    private readonly merchantIp: () => string,
    private readonly takeQuerySlot: (userId: string) => Promise<boolean>,
  ) {}

  async status(userId: string, transactionRef: string) {
    if (!/^[A-Za-z0-9]{1,100}$/.test(transactionRef))
      throw paymentErrors.orderNotFound();
    const row = await this.reader.findOwnedPayment(userId, { transactionRef });
    if (!row) throw paymentErrors.orderNotFound();
    const { orderId, orderCode, orderStatus, transactionStatus } = row;
    return { orderId, orderCode, orderStatus, transactionStatus };
  }

  async reconcile(userId: string, orderId: string) {
    const row = await this.reader.findOwnedPayment(userId, { orderId });
    if (!row) throw paymentErrors.orderNotFound();
    if (!row.createDate)
      throw new PaymentDomainError(
        "CONFLICT",
        "Original VNPay transaction date is missing",
      );
    let allowed: boolean;
    let ipAddress: string;
    try {
      ipAddress = this.merchantIp();
      allowed = await this.takeQuerySlot(userId);
    } catch {
      throw new PaymentDomainError("UNAVAILABLE", "VNPay query unavailable");
    }
    if (!allowed)
      throw new PaymentDomainError(
        "RATE_LIMITED",
        "VNPay query limit exceeded",
      );

    let params: VnpayParams;
    try {
      params = await this.gateway.queryTransaction({
        transactionRef: row.transactionRef,
        transactionDate: row.createDate,
        ipAddress,
      });
    } catch {
      throw new PaymentDomainError(
        "UNAVAILABLE",
        "VNPay query unavailable or unverified",
      );
    }
    const status = params.vnp_TransactionStatus;
    const responseCode = params.vnp_ResponseCode;
    if (
      responseCode !== "00" ||
      params.vnp_TransactionType !== "01" ||
      (status !== "00" && status !== "02")
    )
      return { decision: "MANUAL_REVIEW", responseCode };
    return {
      decision: await this.ipn.settleVerified(
        params,
        row.transactionRef,
        status === "00",
      ),
      responseCode,
    };
  }
}
