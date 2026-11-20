"use client";

import { Lock, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { CheckoutScreen } from "./use-checkout-screen";

/** Thong tin nguoi nhan ve, ma giam gia va phuong thuc thanh toan VNPay. */
export function PaymentModal({ vm }: { vm: CheckoutScreen }) {
  const {
    canPay,
    setShowPaymentModal,
    email,
    isSubmittingPayment,
    paymentError,
    handlePaymentSubmit,
    finalTotal,
  } = vm;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-xl max-w-lg w-full p-6 text-foreground space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150 my-8">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">
            Thông tin nhận vé & Thanh toán
          </h2>
          <button
            type="button"
            onClick={() => setShowPaymentModal(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {email && (
          <p className="text-sm text-muted-foreground">
            Email nhận vé của tài khoản: {email}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Chọn phương thức thanh toán trên cổng VNPay.
        </p>

        {paymentError && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-xs font-medium">
            {paymentError}
          </div>
        )}

        {/* Final Action Button */}
        <div className="pt-2">
          <Button
            type="button"
            disabled={!canPay || isSubmittingPayment}
            onClick={handlePaymentSubmit}
            className="w-full h-12 text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 rounded-md shadow-xs cursor-pointer"
          >
            <Lock className="h-4 w-4 mr-1.5" />
            <span>
              {isSubmittingPayment
                ? "Đang kết nối cổng thanh toán..."
                : `Thanh toán ngay: ${finalTotal.toLocaleString("vi-VN")} ₫`}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
