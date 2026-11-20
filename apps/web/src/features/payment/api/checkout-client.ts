import { ApiError, apiClient } from "@/shared/api/client";
import type { RawOrder, Recipient } from "../domain/checkout-rules";

/** Tai don hang cua nguoi mua tu backend; nem loi neu that bai. */
export async function fetchOrder(orderId: string): Promise<RawOrder | null> {
  // apiClient da boc lop `data` cua phan hoi { success, data }
  const order = await apiClient<RawOrder | null>(`/booking/orders/${orderId}`);
  return order ?? null;
}

/** Tra ghe ve kho (best effort): bo qua loi vi ghe tu duoc tra sau khi het han giu. */
export async function releaseOrderBestEffort(orderId: string): Promise<void> {
  try {
    await apiClient<{ success: boolean }>("/booking/release", {
      method: "POST",
      body: JSON.stringify({ orderId }),
    });
  } catch {
    // Best effort release
  }
}

export interface PaymentRequest {
  orderId: string;
  paymentMethod: "vnpay_qr" | "vnpay_atm" | "vnpay_intl";
  voucherCode: string | null;
  recipient: Recipient;
}

/** Tao URL thanh toan VNPay; tra ve URL hoac null neu backend khong tra ve. */
export async function createVnpayPayment(
  req: PaymentRequest,
): Promise<string | null> {
  const payment = await apiClient<{ paymentUrl?: string } | null>(
    `/payments/orders/${req.orderId}/vnpay`,
    {
      method: "POST",
      body: JSON.stringify({
        paymentMethod: req.paymentMethod,
        voucherCode: req.voucherCode,
        recipient: req.recipient,
      }),
    },
  );
  return payment?.paymentUrl ?? null;
}

/** Ma trang thai HTTP cua loi tao thanh toan (0 neu mat ket noi, undefined neu khong phai loi API). */
export function paymentErrorStatus(err: unknown): number | undefined {
  return err instanceof ApiError ? err.status : undefined;
}
