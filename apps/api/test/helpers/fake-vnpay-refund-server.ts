import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  refundRequestSignData,
  refundResponseSignData,
} from "../../src/contexts/payment/infrastructure/vnpay-refund.gateway";

export const FAKE_TMN_CODE = "FAKETMN01";
export const FAKE_HASH_SECRET = "fake-refund-secret-for-tests-only";

export interface FakeBehavior {
  /** Ma vnp_ResponseCode tra ve (mac dinh 00). */
  responseCode?: string;
  transactionStatus?: string;
  amount?: string;
  /** Ky sai phan hoi. */
  badSignature?: boolean;
  /** Tra ve noi dung khong phai JSON. */
  garbage?: boolean;
  /** Ngat ket noi sau khi nhan yeu cau (mo phong timeout/dut mang). */
  dropConnection?: boolean;
}

export interface FakeVnpayServer {
  url: string;
  requests: Array<Record<string, string>>;
  behavior: FakeBehavior;
  close(): Promise<void>;
}

export function sign(data: string): string {
  return createHmac("sha512", FAKE_HASH_SECRET)
    .update(data, "utf8")
    .digest("hex");
}

/** Kiem tra chu ky yeu cau hoan tien nhu VNPay se lam. */
export function requestSignatureIsValid(body: Record<string, string>): boolean {
  const data = refundRequestSignData({
    requestId: body.vnp_RequestId ?? "",
    version: body.vnp_Version ?? "",
    command: body.vnp_Command ?? "",
    tmnCode: body.vnp_TmnCode ?? "",
    transactionType: body.vnp_TransactionType ?? "",
    txnRef: body.vnp_TxnRef ?? "",
    amount: body.vnp_Amount ?? "",
    transactionNo: body.vnp_TransactionNo ?? "",
    transactionDate: body.vnp_TransactionDate ?? "",
    createBy: body.vnp_CreateBy ?? "",
    createDate: body.vnp_CreateDate ?? "",
    ipAddr: body.vnp_IpAddr ?? "",
    orderInfo: body.vnp_OrderInfo ?? "",
  });
  return sign(data) === body.vnp_SecureHash;
}

export async function startFakeVnpayServer(
  behavior: FakeBehavior = {},
): Promise<FakeVnpayServer> {
  const requests: Array<Record<string, string>> = [];
  const state: FakeBehavior = behavior;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        string
      >;
      requests.push(body);

      if (state.dropConnection) {
        req.socket.destroy();
        return;
      }
      if (state.garbage) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html>maintenance</html>");
        return;
      }

      const response: Record<string, string> = {
        vnp_ResponseId: "resp-" + requests.length,
        vnp_Command: "refund",
        vnp_ResponseCode: state.responseCode ?? "00",
        vnp_Message: "Fake message",
        vnp_TmnCode: body.vnp_TmnCode ?? "",
        vnp_TxnRef: body.vnp_TxnRef ?? "",
        vnp_Amount: state.amount ?? body.vnp_Amount ?? "",
        vnp_BankCode: "NCB",
        vnp_PayDate: "20260101000000",
        vnp_TransactionNo: "99" + String(requests.length).padStart(6, "0"),
        vnp_TransactionType: body.vnp_TransactionType ?? "",
        vnp_TransactionStatus: state.transactionStatus ?? "00",
        vnp_OrderInfo: body.vnp_OrderInfo ?? "",
      };
      const hash = sign(refundResponseSignData(response));
      response.vnp_SecureHash = state.badSignature ? "0".repeat(128) : hash;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/merchant_webapi/api/transaction`,
    requests,
    behavior: state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
