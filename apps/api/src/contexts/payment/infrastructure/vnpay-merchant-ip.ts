import { BlockList, isIP } from "node:net";
import { env } from "../../../config/env.config";

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

export function readVnpayMerchantIp(): string {
  const ip = env.VNPAY_REFUND_IP?.trim();
  const version = ip ? isIP(ip) : 0;

  if (
    !ip ||
    !version ||
    (env.NODE_ENV === "production" &&
      loopback.check(ip, version === 4 ? "ipv4" : "ipv6"))
  ) {
    throw new Error("Set VNPAY_REFUND_IP to the merchant's configured IP");
  }

  return ip;
}
