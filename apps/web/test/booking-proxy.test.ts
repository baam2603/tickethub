import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

let server: http.Server;
let received: { url?: string; headers: http.IncomingHttpHeaders; body: string };
let nextStatus = 201;
let nextBody: unknown = { success: true, data: { orderId: "o-1" } };
let proxyBooking: typeof import("../src/lib/api/booking-proxy.ts").proxyBooking;

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/v1/booking/hold", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ eventId: "e", items: [] }),
  });
}

describe("Booking proxy: khong bao gio tao phan hoi thanh cong gia", () => {
  before(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received = { url: req.url, headers: req.headers, body };
        res.writeHead(nextStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify(nextBody));
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    process.env.API_URL = `http://127.0.0.1:${port}/api/v1`;
    ({ proxyBooking } = await import("../src/lib/api/booking-proxy.ts"));
  });

  after(() => {
    server.close();
  });

  test("201 cua backend duoc chuyen nguyen body va status", async () => {
    nextStatus = 201;
    nextBody = { success: true, data: { orderId: "o-1" } };
    const res = await proxyBooking(makeRequest(), "hold");
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), nextBody);
    assert.equal(received.url, "/api/v1/booking/hold");
  });

  test("401 cua backend KHONG bi bien thanh thanh cong", async () => {
    nextStatus = 401;
    nextBody = { success: false, error: { code: "UNAUTHORIZED" } };
    const res = await proxyBooking(makeRequest(), "hold");
    assert.equal(res.status, 401);
    const json = (await res.json()) as { success: boolean };
    assert.equal(json.success, false);
  });

  test("409 cua backend (ghe da bi giu) duoc giu nguyen", async () => {
    nextStatus = 409;
    nextBody = { success: false, error: { code: "SEAT_UNAVAILABLE" } };
    const res = await proxyBooking(makeRequest(), "hold");
    assert.equal(res.status, 409);
  });

  test("chuyen tiep Authorization va Idempotency-Key", async () => {
    nextStatus = 201;
    nextBody = { success: true, data: {} };
    await proxyBooking(
      makeRequest({
        Authorization: "Bearer abc",
        "Idempotency-Key": "idem-1",
      }),
      "hold",
    );
    assert.equal(received.headers["authorization"], "Bearer abc");
    assert.equal(received.headers["idempotency-key"], "idem-1");
  });

  test("route release goi dung duong dan /booking/release", async () => {
    nextStatus = 200;
    nextBody = { success: true };
    await proxyBooking(makeRequest(), "release");
    assert.equal(received.url, "/api/v1/booking/release");
  });

  test("backend khong phan hoi -> 503, success=false (khong fallback)", async () => {
    server.close();
    await new Promise((r) => setTimeout(r, 50));
    const res = await proxyBooking(makeRequest(), "hold");
    assert.equal(res.status, 503);
    const json = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    assert.equal(json.success, false);
    assert.equal(json.error.code, "SERVICE_UNAVAILABLE");
  });
});
