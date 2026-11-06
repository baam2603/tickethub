import { env } from "../config/env.config";

// Cấu hình mẫu không được dùng để ký hoặc gửi giao dịch thật.
export function hasVnpayCredentials(): boolean {
  return [env.VNPAY_TMN_CODE, env.VNPAY_HASH_SECRET].every((value) => {
    const trimmed = value.trim();
    return (
      trimmed.length > 0 &&
      !/^(TEST_TMN_CODE|TEST_HASH_SECRET|YOUR_.+|CHANGE[_-]?ME.*|REPLACE[_-]?ME.*|<.*>)$/i.test(
        trimmed,
      )
    );
  });
}
