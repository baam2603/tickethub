import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { env } from "../../../config/env.config";
import { formatVnpayDate } from "../domain/vnpay-date";

export function parseVnpayDate(value: string | undefined): Date | null {
  if (!value || !/^\d{14}$/.test(value)) return null;
  const date = new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+07:00`,
  );
  return Number.isFinite(date.getTime()) && formatVnpayDate(date) === value
    ? date
    : null;
}

export const VNPAY_RESPONSE_FIELDS = [
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
] as const;

export interface QueryPayment {
  transactionRef: string;
  transactionDate: string;
  ipAddress: string;
}
export class VnpayQueryGateway {
  private sign(data: string) {
    return createHmac("sha512", env.VNPAY_HASH_SECRET)
      .update(data, "utf8")
      .digest("hex");
  }

  private async post(params: Record<string, string>, fields: string[]) {
    if (
      !env.VNPAY_TMN_CODE.trim() ||
      !env.VNPAY_HASH_SECRET.trim() ||
      env.VNPAY_TMN_CODE === "TEST_TMN_CODE" ||
      env.VNPAY_HASH_SECRET === "TEST_HASH_SECRET"
    ) {
      throw new Error("VNPay credentials not configured");
    }
    const url = new URL(env.VNPAY_API_URL);
    const localTest =
      env.NODE_ENV === "test" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !localTest)
      throw new Error("VNPay API requires HTTPS");
    if (
      !parseVnpayDate(params.vnp_TransactionDate) ||
      isIP(params.vnp_IpAddr ?? "") === 0
    )
      throw new Error("Invalid VNPay request metadata");
    params.vnp_SecureHash = this.sign(
      fields.map((key) => params[key] ?? "").join("|"),
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`VNPay HTTP ${response.status}`);
    }
    const raw: unknown = await response.json();
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid VNPay response");
    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === null) data[key] = "";
      else if (typeof value === "string") data[key] = value;
      else if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
      )
        data[key] = String(value);
      else throw new Error("Invalid VNPay response field");
    }
    const received = data.vnp_SecureHash ?? "";
    const expected = this.sign(
      [
        ...VNPAY_RESPONSE_FIELDS,
        ...(params.vnp_Command === "querydr"
          ? ["vnp_PromotionCode", "vnp_PromotionAmount"]
          : []),
      ]
        .map((key) => data[key] ?? "")
        .join("|"),
    );
    if (
      !/^[a-f\d]{128}$/i.test(received) ||
      !timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(received, "hex"),
      ) ||
      data.vnp_TmnCode !== env.VNPAY_TMN_CODE ||
      data.vnp_TxnRef !== params.vnp_TxnRef ||
      data.vnp_Command !== params.vnp_Command
    ) {
      throw new Error("VNPay response signature or identity mismatch");
    }
    for (const key of [
      "vnp_ResponseCode",
      "vnp_TransactionType",
      "vnp_TransactionStatus",
    ]) {
      if (/^\d$/.test(data[key] ?? "")) data[key] = data[key]!.padStart(2, "0");
    }
    return data;
  }

  queryTransaction(input: QueryPayment) {
    const params = {
      vnp_RequestId: randomBytes(16).toString("hex"),
      vnp_Version: "2.1.0",
      vnp_Command: "querydr",
      vnp_TmnCode: env.VNPAY_TMN_CODE,
      vnp_TxnRef: input.transactionRef,
      vnp_OrderInfo: `Query TicketHub ${input.transactionRef}`,
      vnp_TransactionDate: input.transactionDate,
      vnp_CreateDate: formatVnpayDate(new Date()),
      vnp_IpAddr: input.ipAddress,
    };
    return this.post(params, [
      "vnp_RequestId",
      "vnp_Version",
      "vnp_Command",
      "vnp_TmnCode",
      "vnp_TxnRef",
      "vnp_TransactionDate",
      "vnp_CreateDate",
      "vnp_IpAddr",
      "vnp_OrderInfo",
    ]);
  }
}
