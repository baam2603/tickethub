import { z } from "zod";
import dotenv from "dotenv";
import path from "path";
import { parseIpAllowlist } from "./ip-allowlist";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const DEV_JWT_SECRET =
  "tickethub-super-secret-development-jwt-key-2026-min-32-chars";

export const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z
      .string()
      .url()
      .default(
        "postgresql://tickethub:tickethub_secret@localhost:5432/tickethub_dev",
      ),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
    VNPAY_TMN_CODE: z.string().default("TEST_TMN_CODE"),
    VNPAY_HASH_SECRET: z.string().default("TEST_HASH_SECRET"),
    VNPAY_URL: z
      .string()
      .url()
      .default("https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"),
    VNPAY_API_URL: z
      .string()
      .url()
      .default("https://sandbox.vnpayment.vn/merchant_webapi/api/transaction"),
    VNPAY_API_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(30000)
      .default(5000),
    VNPAY_IPN_ALLOWED_CIDRS: z.string().default(""),
    TRUSTED_PROXY_CIDRS: z.string().default(""),
    SENTRY_DSN: z
      .union([z.literal(""), z.url({ protocol: /^https$/ })])
      .optional(),
    ENABLE_VNPAY_IPN_PROCESSING: z.enum(["true", "false"]).default("false"),
    ENABLE_VNPAY_REFUNDS: z.enum(["true", "false"]).default("false"),
    VNPAY_REFUND_IP: z.string().default("127.0.0.1"),
    VNPAY_RETURN_URL: z
      .string()
      .url()
      .default("http://localhost:3000/checkout/vnpay-return"),
    ED25519_PRIVATE_KEY: z
      .string()
      .default(
        "MC4CAQAwBQYDK2VwBCIEIFXdummyed25519privatekeydevelopmentonly2026=",
      ),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default("onboarding@resend.dev"),
    S3_REGION: z.string().default("ap-southeast-1"),
    S3_BUCKET: z.string().default("tickethub-media"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_PUBLIC_BASE_URL: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    const issue = (key: keyof typeof config, message: string) =>
      ctx.addIssue({ code: "custom", path: [key], message });
    for (const key of [
      "VNPAY_IPN_ALLOWED_CIDRS",
      "TRUSTED_PROXY_CIDRS",
    ] as const) {
      try {
        parseIpAllowlist(config[key]);
      } catch {
        issue(key, "Expected a comma-separated list of IP addresses or CIDRs");
      }
    }
    if (config.NODE_ENV === "production") {
      const merchantConfigured =
        config.VNPAY_TMN_CODE !== "TEST_TMN_CODE" ||
        config.VNPAY_HASH_SECRET !== "TEST_HASH_SECRET";
      const ipnEnabled = config.ENABLE_VNPAY_IPN_PROCESSING === "true";
      if (
        merchantConfigured ||
        ipnEnabled ||
        config.ENABLE_VNPAY_REFUNDS === "true"
      ) {
        if (
          !/^[A-Za-z0-9]{1,20}$/.test(config.VNPAY_TMN_CODE) ||
          config.VNPAY_TMN_CODE === "TEST_TMN_CODE"
        ) {
          issue("VNPAY_TMN_CODE", "A production merchant code is required");
        }
        if (
          config.VNPAY_HASH_SECRET.trim().length < 16 ||
          config.VNPAY_HASH_SECRET === "TEST_HASH_SECRET"
        ) {
          issue(
            "VNPAY_HASH_SECRET",
            "A production merchant secret is required",
          );
        }
        for (const key of [
          "VNPAY_URL",
          "VNPAY_API_URL",
          "VNPAY_RETURN_URL",
        ] as const) {
          try {
            const url = new URL(config[key]);
            if (
              url.protocol !== "https:" ||
              url.username ||
              url.password ||
              /(^|\.)(sandbox|localhost)(\.|$)/i.test(url.hostname) ||
              url.hostname === "127.0.0.1" ||
              url.hostname === "[::1]"
            ) {
              issue(key, "Use the approved production HTTPS endpoint");
            }
          } catch {
            // Kiểu URL đã được kiểm tra trong schema.
          }
        }
      }
      if (ipnEnabled && !config.VNPAY_IPN_ALLOWED_CIDRS.trim()) {
        issue(
          "VNPAY_IPN_ALLOWED_CIDRS",
          "Production IPN requires a non-empty VNPay source allowlist",
        );
      }
    }
    if (
      config.NODE_ENV === "production" &&
      config.JWT_SECRET === DEV_JWT_SECRET
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message:
          "Production requires a unique JWT_SECRET. Development default is forbidden.",
      });
    }
  });

export type EnvConfig = z.infer<typeof EnvSchema>;

export function loadEnvConfig(): EnvConfig {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(
      `Environment validation failed: ${JSON.stringify(formatted, null, 2)}`,
    );
  }
  return result.data;
}

export const env = loadEnvConfig();
