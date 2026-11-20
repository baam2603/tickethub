"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError, apiClient } from "@/shared/api/client";
import { Button } from "@/shared/ui/button";

type PaymentStatus = {
  orderId: string;
  orderCode: string;
  orderStatus: string;
  transactionStatus: string;
};

const messages: Record<string, string> = {
  PAID: "Thanh toán thành công. Vé đã có trong mục Vé của tôi.",
  FAILED: "Thanh toán không thành công.",
  PAYMENT_EXPIRED_REFUND_PENDING:
    "Thanh toán đến sau khi hết giữ vé. Khoản hoàn đang được xử lý.",
  REFUNDED:
    "Đơn hàng đã được ghi nhận hoàn vé. Xem chi tiết để kiểm tra trạng thái hoàn tiền.",
};

function ReturnContent() {
  const ref = useSearchParams().get("vnp_TxnRef") ?? "";
  const validRef = /^[a-z0-9]{1,100}$/i.test(ref);
  const payment = useQuery({
    queryKey: ["vnpay-return", ref],
    queryFn: ({ signal }) =>
      apiClient<PaymentStatus>(`/payments/vnpay/status/${ref}`, {
        cache: "no-store",
        signal,
      }),
    enabled: validRef,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.transactionStatus === "PENDING" &&
      query.state.dataUpdateCount < 12
        ? 5_000
        : false,
  });
  const reconcile = useMutation({
    mutationFn: async (orderId: string) => {
      await apiClient(`/payments/orders/${orderId}/vnpay/query`, {
        method: "POST",
      });
    },
    onSettled: async () => {
      await payment.refetch();
    },
  });
  const data = payment.data;
  const loginRequired =
    payment.error instanceof ApiError && payment.error.status === 401;
  const confirmedStatus =
    data?.orderStatus === "PAID" && data.transactionStatus !== "SUCCESS"
      ? null
      : data?.orderStatus;
  const message = !validRef
    ? "Thiếu mã tham chiếu thanh toán."
    : loginRequired
      ? "Hãy đăng nhập lại bằng tài khoản đặt vé để kiểm tra giao dịch."
      : payment.isError
        ? "Chưa thể đọc giao dịch của tài khoản này. Vui lòng thử lại."
        : !data
          ? "Đang đọc trạng thái giao dịch..."
          : (messages[confirmedStatus ?? ""] ??
            "TicketHub đang chờ xác nhận từ VNPay. Vui lòng kiểm tra lại trước khi thanh toán lần nữa.");

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-semibold">Kết quả thanh toán VNPay</h1>
      {data && (
        <p className="mt-4 text-sm text-muted-foreground">
          Đơn hàng {data.orderCode}
        </p>
      )}
      <p role="status" className="mt-3">
        {message}
      </p>
      {reconcile.isError && (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          VNPay chưa phản hồi hoặc chưa xác nhận giao dịch.
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        {data?.transactionStatus === "PENDING" && (
          <Button
            disabled={reconcile.isPending}
            onClick={() => reconcile.mutate(data.orderId)}
          >
            {reconcile.isPending ? "Đang đối chiếu..." : "Kiểm tra với VNPay"}
          </Button>
        )}
        {validRef && payment.isError && !loginRequired && (
          <Button onClick={() => void payment.refetch()}>Thử lại</Button>
        )}
        {loginRequired && (
          <Button asChild>
            <Link href="/login">Đăng nhập</Link>
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href="/my-tickets">Vé của tôi</Link>
        </Button>
      </div>
    </main>
  );
}

export function VnpayReturnPage() {
  return (
    <Suspense
      fallback={
        <p className="p-6" role="status">
          Đang tải kết quả thanh toán...
        </p>
      }
    >
      <ReturnContent />
    </Suspense>
  );
}
