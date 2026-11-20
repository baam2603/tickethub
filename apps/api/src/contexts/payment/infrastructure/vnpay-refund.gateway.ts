import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  RefundGateway,
  RefundGatewayRequest,
  RefundGatewayResult,
} from "../domain/refund-gateway";
import { formatVnpayDate } from "../domain/vnpay-date";

const VNPAY_VERSION = "2.1.0";
const REQUEST_TIMEOUT_MS = 30_000;

/** Ma loi VNPay duoc coi la tu choi ro rang (khong hoan tien). Ma khac (94, 99, ...) la khong chac chan. */
const DEFINITIVE_REJECTION_CODES = new Set([
  "02",
  "03",
  "91",
  "93",
  "95",
  "97",
]);

/** Loi mang xay ra truoc khi yeu cau toi duoc VNPay nen an toan de thu lai. */
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

export interface VnpayRefundConfig {
  apiUrl: string;
  tmnCode: string;
  hashSecret: string;
}

function hmac(data: string, secret: string): string {
  return createHmac("sha512", secret).update(data, "utf8").digest("hex");
}

/** Chuoi ky yeu cau hoan tien theo tai lieu VNPay 2.1.0, noi bang dau gach dung. */
export function refundRequestSignData(fields: {
  requestId: string;
  version: string;
  command: string;
  tmnCode: string;
  transactionType: string;
  txnRef: string;
  amount: string;
  transactionNo: string;
  transactionDate: string;
  createBy: string;
  createDate: string;
  ipAddr: string;
  orderInfo: string;
}): string {
  return [
    fields.requestId,
    fields.version,
    fields.command,
    fields.tmnCode,
    fields.transactionType,
    fields.txnRef,
    fields.amount,
    fields.transactionNo,
    fields.transactionDate,
    fields.createBy,
    fields.createDate,
    fields.ipAddr,
    fields.orderInfo,
  ].join("|");
}

/** Chuoi ky phan hoi hoan tien; truong thieu duoc coi la chuoi rong. */
export function refundResponseSignData(r: Record<string, unknown>): string {
  const keys = [
    "vnp_ResponseId",
    "vnp_Command",
    "vnp_ResponseCode",
    "vnp_Message",
    "vnp_TmnCode",
    "vnp_TxnRef",
    "vnp_Amount",
    "vnp_BankCode",
    "vnp_PayDate",
    "vnp_TransactionNo",
    "vnp_TransactionType",
    "vnp_TransactionStatus",
    "vnp_OrderInfo",
    "vnp_PromotionCode",
    "vnp_PromotionAmount",
  ];
  return keys
    .map((k) => (r[k] === undefined || r[k] === null ? "" : String(r[k])))
    .join("|");
}

export class VnpayRefundGateway implements RefundGateway {
  constructor(
    private readonly config: VnpayRefundConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async refund(request: RefundGatewayRequest): Promise<RefundGatewayResult> {
    const createDate = formatVnpayDate(new Date());
    const amount = String(request.amountVnd * 100);

    const body: Record<string, string> = {
      vnp_RequestId: request.requestId,
      vnp_Version: VNPAY_VERSION,
      vnp_Command: "refund",
      vnp_TmnCode: this.config.tmnCode,
      vnp_TransactionType: request.transactionType,
      vnp_TxnRef: request.transactionRef,
      vnp_Amount: amount,
      vnp_OrderInfo: request.orderInfo,
      vnp_TransactionNo: request.transactionNo,
      vnp_TransactionDate: request.transactionDate,
      vnp_CreateBy: request.createBy,
      vnp_CreateDate: createDate,
      vnp_IpAddr: request.ipAddress,
    };
    body.vnp_SecureHash = hmac(
      refundRequestSignData({
        requestId: body.vnp_RequestId!,
        version: body.vnp_Version!,
        command: body.vnp_Command!,
        tmnCode: body.vnp_TmnCode!,
        transactionType: body.vnp_TransactionType!,
        txnRef: body.vnp_TxnRef!,
        amount,
        transactionNo: body.vnp_TransactionNo!,
        transactionDate: body.vnp_TransactionDate!,
        createBy: body.vnp_CreateBy!,
        createDate,
        ipAddr: body.vnp_IpAddr!,
        orderInfo: body.vnp_OrderInfo!,
      }),
      this.config.hashSecret,
    );

    let response: Response;
    try {
      response = await this.fetchImpl(this.config.apiUrl, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const code =
        (error as { cause?: { code?: string } }).cause?.code ??
        (error as { code?: string }).code;
      if (code && CONNECTION_ERROR_CODES.has(code)) {
        return { kind: "UNREACHABLE", reason: code };
      }
      // Timeout hoac dut ket noi sau khi gui: khong biet VNPay da xu ly hay chua
      return {
        kind: "UNKNOWN",
        reason: error instanceof Error ? error.message : "request failed",
      };
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      return {
        kind: "UNKNOWN",
        reason: `HTTP ${response.status} without JSON body`,
      };
    }

    if (!this.hasValidSignature(payload)) {
      return {
        kind: "UNKNOWN",
        reason: "Response signature is missing or invalid",
      };
    }
    if (
      payload.vnp_TxnRef !== request.transactionRef ||
      payload.vnp_TmnCode !== this.config.tmnCode ||
      payload.vnp_Command !== "refund"
    ) {
      return {
        kind: "UNKNOWN",
        reason: "Response does not match the requested transaction",
      };
    }

    const code = String(payload.vnp_ResponseCode ?? "").padStart(2, "0");
    if (code === "00") {
      const ref = String(payload.vnp_TransactionNo ?? "");
      if (
        String(payload.vnp_TransactionStatus).padStart(2, "0") !== "00" ||
        String(payload.vnp_TransactionType).padStart(2, "0") !==
          request.transactionType ||
        String(payload.vnp_Amount) !== amount ||
        !/^\d{1,15}$/.test(ref) ||
        (request.transactionType === "03" &&
          payload.vnp_OrderInfo !== request.orderInfo)
      )
        return {
          kind: "UNKNOWN",
          reason: "Refund confirmation is incomplete or inconsistent",
        };
      return { kind: "SUCCESS", providerRefundRef: ref };
    }
    if (DEFINITIVE_REJECTION_CODES.has(code)) {
      return {
        kind: "REJECTED",
        code,
        message: String(payload.vnp_Message ?? ""),
      };
    }
    return {
      kind: "UNKNOWN",
      reason: `VNPay response code ${code}: ${String(payload.vnp_Message ?? "")}`,
    };
  }

  private hasValidSignature(payload: Record<string, unknown>): boolean {
    const received = String(payload.vnp_SecureHash ?? "");
    if (!/^[0-9a-fA-F]{128}$/.test(received)) return false;
    const expected = hmac(
      refundResponseSignData(payload),
      this.config.hashSecret,
    );
    const a = Buffer.from(received, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
