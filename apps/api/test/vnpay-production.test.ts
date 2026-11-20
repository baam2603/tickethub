import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { env, EnvSchema } from "../src/config/env.config";
import { isAllowedIp, parseIpAllowlist } from "../src/config/ip-allowlist";
import { VnpayIpnController } from "../src/payments/vnpay-ipn.controller";
import { VnpayIpnService } from "../src/payments/vnpay-ipn.service";

@Module({ controllers: [VnpayIpnController], providers: [VnpayIpnService] })
class IpPolicyTestModule {}

describe("VNPay production policy", () => {
  it("requires explicit HTTPS merchant settings and a valid non-universal IP allowlist", () => {
    const production = {
      NODE_ENV: "production",
      JWT_SECRET: "integration-test-only-development-jwt",
      ENABLE_VNPAY_IPN_PROCESSING: "true",
    };
    const missing = EnvSchema.safeParse(production);
    assert.equal(missing.success, false);
    assert.ok(
      missing.error.issues.some(
        ({ path }) => path[0] === "VNPAY_IPN_ALLOWED_CIDRS",
      ),
    );
    assert.ok(missing.error.issues.some(({ path }) => path[0] === "VNPAY_URL"));

    const configured = {
      ...production,
      VNPAY_TMN_CODE: "MERCHANT1",
      VNPAY_HASH_SECRET: "non-production-test-value",
      VNPAY_URL: "https://checkout.example.com/pay",
      VNPAY_API_URL: "https://merchant.example.com/api",
      VNPAY_RETURN_URL: "https://tickets.example.com/return",
      VNPAY_IPN_ALLOWED_CIDRS: "192.0.2.0/24, 2001:db8::/48",
      TRUSTED_PROXY_CIDRS: "198.51.100.10",
    };
    assert.equal(EnvSchema.safeParse(configured).success, true);
    assert.equal(
      EnvSchema.safeParse({
        ...configured,
        VNPAY_IPN_ALLOWED_CIDRS: "0.0.0.0/0",
      }).success,
      false,
    );
    assert.equal(
      EnvSchema.safeParse({
        ...configured,
        VNPAY_RETURN_URL: "http://tickets.example.com",
      }).success,
      false,
    );
    assert.equal(
      EnvSchema.safeParse({
        ...configured,
        SENTRY_DSN: "https://sentry.example.com/1",
      }).success,
      false,
    );
    assert.equal(
      EnvSchema.safeParse({
        ...configured,
        SENTRY_DSN: "https://testkey@sentry.example.com/1",
      }).success,
      true,
    );
    const list = parseIpAllowlist(configured.VNPAY_IPN_ALLOWED_CIDRS);
    assert.equal(isAllowedIp(list, "::ffff:192.0.2.9"), true);
    assert.equal(isAllowedIp(list, "2001:db8::1"), true);
    assert.equal(isAllowedIp(list, "198.51.100.9"), false);
  });

  it("checks Fastify client IP and ignores forwarded headers from an untrusted peer", async () => {
    const previousEnv = env.NODE_ENV;
    const previousList = env.VNPAY_IPN_ALLOWED_CIDRS;
    const previousFlag = process.env.ENABLE_VNPAY_IPN_PROCESSING;
    env.NODE_ENV = "production";
    env.VNPAY_IPN_ALLOWED_CIDRS = "192.0.2.0/24";
    process.env.ENABLE_VNPAY_IPN_PROCESSING = "true";
    const route = "/api/v1/payments/vnpay/ipn";
    async function mount(proxyCidrs: string) {
      const trusted = parseIpAllowlist(proxyCidrs);
      const app = await NestFactory.create<NestFastifyApplication>(
        IpPolicyTestModule,
        new FastifyAdapter({ trustProxy: (ip) => isAllowedIp(trusted, ip) }),
        { logger: false },
      );
      await app.listen(0, "127.0.0.1");
      return app;
    }

    let direct: NestFastifyApplication | undefined;
    let proxied: NestFastifyApplication | undefined;
    try {
      direct = await mount("");
      const spoof = await fetch((await direct.getUrl()) + route, {
        headers: { "x-forwarded-for": "192.0.2.77" },
      });
      assert.equal(spoof.status, 404);

      proxied = await mount("127.0.0.1");
      const denied = await fetch((await proxied.getUrl()) + route, {
        headers: { "x-forwarded-for": "198.51.100.20" },
      });
      assert.equal(denied.status, 404);
      const acceptedSource = await fetch((await proxied.getUrl()) + route, {
        headers: { "x-forwarded-for": "192.0.2.77" },
      });
      assert.equal(acceptedSource.status, 200);
      assert.equal((await acceptedSource.json()).RspCode, "97");
    } finally {
      await direct?.close();
      await proxied?.close();
      env.NODE_ENV = previousEnv;
      env.VNPAY_IPN_ALLOWED_CIDRS = previousList;
      if (previousFlag === undefined)
        delete process.env.ENABLE_VNPAY_IPN_PROCESSING;
      else process.env.ENABLE_VNPAY_IPN_PROCESSING = previousFlag;
    }
  });
});
