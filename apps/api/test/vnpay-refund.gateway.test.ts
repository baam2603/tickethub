import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { VnpayRefundGateway } from "../src/contexts/payment/infrastructure/vnpay-refund.gateway";
import type { RefundGatewayRequest } from "../src/contexts/payment/domain/refund-gateway";
import {
  FAKE_HASH_SECRET,
  FAKE_TMN_CODE,
  requestSignatureIsValid,
  startFakeVnpayServer,
  type FakeVnpayServer,
} from "./helpers/fake-vnpay-refund-server";

const request: RefundGatewayRequest = {
  requestId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  transactionType: "02",
  transactionRef: "TXN123456789",
  amountVnd: 250000,
  transactionDate: "20260115103000",
  transactionNo: "14012345",
  createBy: "tickethub-system",
  orderInfo: "Hoan tien don TH123",
  ipAddress: "127.0.0.1",
};

describe("VnpayRefundGateway", () => {
  let server: FakeVnpayServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  const gatewayFor = (url: string) =>
    new VnpayRefundGateway({
      apiUrl: url,
      tmnCode: FAKE_TMN_CODE,
      hashSecret: FAKE_HASH_SECRET,
    });

  it("sends a correctly signed refund command with the amount multiplied by 100", async () => {
    server = await startFakeVnpayServer();
    const result = await gatewayFor(server.url).refund(request);

    assert.equal(result.kind, "SUCCESS");
    assert.equal(server.requests.length, 1);
    const body = server.requests[0]!;
    assert.equal(body.vnp_Command, "refund");
    assert.equal(body.vnp_Version, "2.1.0");
    assert.equal(body.vnp_TransactionType, "02");
    assert.equal(body.vnp_Amount, "25000000");
    assert.equal(body.vnp_TxnRef, "TXN123456789");
    assert.equal(body.vnp_TransactionDate, "20260115103000");
    assert.equal(body.vnp_RequestId, request.requestId);
    assert.match(body.vnp_CreateDate ?? "", /^\d{14}$/);
    assert.ok(requestSignatureIsValid(body));
  });

  it("returns the provider reference on success", async () => {
    server = await startFakeVnpayServer();
    const result = await gatewayFor(server.url).refund(request);
    assert.deepEqual(result, {
      kind: "SUCCESS",
      providerRefundRef: "99000001",
    });
  });

  it("classifies definitive rejection codes as REJECTED", async () => {
    for (const code of ["02", "03", "91", "93", "95", "97"]) {
      server = await startFakeVnpayServer({ responseCode: code });
      const result = await gatewayFor(server.url).refund(request);
      assert.equal(result.kind, "REJECTED", code);
      await server.close();
      server = null;
    }
  });

  it("treats timeout-like codes (94, 99) as UNKNOWN, never as a rejection", async () => {
    for (const code of ["94", "99", "12"]) {
      server = await startFakeVnpayServer({ responseCode: code });
      const result = await gatewayFor(server.url).refund(request);
      assert.equal(result.kind, "UNKNOWN", code);
      await server.close();
      server = null;
    }
  });

  it("keeps a correctly signed pending or wrong-amount refund unconfirmed", async () => {
    for (const behavior of [{ transactionStatus: "05" }, { amount: "100" }]) {
      server = await startFakeVnpayServer(behavior);
      assert.equal(
        (await gatewayFor(server.url).refund(request)).kind,
        "UNKNOWN",
      );
      await server.close();
      server = null;
    }
  });

  it("does not trust a response with an invalid signature, even with code 00", async () => {
    server = await startFakeVnpayServer({ badSignature: true });
    const result = await gatewayFor(server.url).refund(request);
    assert.equal(result.kind, "UNKNOWN");
  });

  it("does not trust a body that is not JSON", async () => {
    server = await startFakeVnpayServer({ garbage: true });
    const result = await gatewayFor(server.url).refund(request);
    assert.equal(result.kind, "UNKNOWN");
  });

  it("treats a connection dropped after sending as UNKNOWN (it may have been processed)", async () => {
    server = await startFakeVnpayServer({ dropConnection: true });
    const result = await gatewayFor(server.url).refund(request);
    assert.equal(result.kind, "UNKNOWN");
    assert.equal(server.requests.length, 1);
  });

  it("treats a refused connection as UNREACHABLE (the request never arrived)", async () => {
    server = await startFakeVnpayServer();
    const url = server.url;
    await server.close();
    server = null;
    const result = await gatewayFor(url).refund(request);
    assert.equal(result.kind, "UNREACHABLE");
  });
});
