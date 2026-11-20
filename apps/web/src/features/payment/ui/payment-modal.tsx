"use client";

import { Lock, CheckCircle2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { CheckoutScreen } from "./use-checkout-screen";

/** Thong tin nguoi nhan ve, ma giam gia va phuong thuc thanh toan VNPay. */
export function PaymentModal({ vm }: { vm: CheckoutScreen }) {
  const {
    isExpired,
    setShowPaymentModal,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    email,
    setEmail,
    phone,
    setPhone,
    paymentMethod,
    setPaymentMethod,
    voucherCode,
    setVoucherCode,
    voucherDiscount,
    voucherAppliedCode,
    voucherError,
    isSubmittingPayment,
    paymentError,
    handleApplyVoucher,
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

        {/* Recipient details form */}
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Họ và tên lót <span className="text-destructive">*</span>
              </label>
              <Input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Nguyễn Văn"
                className="h-10 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Tên <span className="text-destructive">*</span>
              </label>
              <Input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="An"
                className="h-10 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Email nhận vé điện tử <span className="text-destructive">*</span>
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="h-10 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Số điện thoại liên hệ <span className="text-destructive">*</span>
            </label>
            <Input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09xxxxxxxx"
              className="h-10 text-sm"
            />
          </div>
        </div>

        {/* Payment Method Selector */}
        <div className="space-y-2 pt-1">
          <label className="block text-xs font-semibold text-foreground">
            Chọn phương thức thanh toán VNPay
          </label>

          <div className="space-y-2">
            <label
              onClick={() => setPaymentMethod("vnpay_qr")}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                paymentMethod === "vnpay_qr"
                  ? "border-primary bg-accent/60"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <input
                type="radio"
                name="modalPaymentMethod"
                checked={paymentMethod === "vnpay_qr"}
                onChange={() => setPaymentMethod("vnpay_qr")}
                className="text-primary accent-primary"
              />
              <div className="flex-1 text-xs">
                <div className="font-bold text-foreground flex items-center gap-2">
                  <span>Cổng VNPay - Quét mã VNPay-QR</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary text-primary-foreground">
                    Khuyên dùng
                  </span>
                </div>
                <div className="text-muted-foreground mt-0.5">
                  Ứng dụng Mobile Banking hoặc ví điện tử VNPay
                </div>
              </div>
            </label>

            <label
              onClick={() => setPaymentMethod("vnpay_atm")}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                paymentMethod === "vnpay_atm"
                  ? "border-primary bg-accent/60"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <input
                type="radio"
                name="modalPaymentMethod"
                checked={paymentMethod === "vnpay_atm"}
                onChange={() => setPaymentMethod("vnpay_atm")}
                className="text-primary accent-primary"
              />
              <div className="flex-1 text-xs">
                <div className="font-bold text-foreground">
                  Thẻ ATM / Tài khoản ngân hàng nội địa
                </div>
                <div className="text-muted-foreground mt-0.5">
                  Liên minh cổng thanh toán Napas hơn 40 ngân hàng
                </div>
              </div>
            </label>

            <label
              onClick={() => setPaymentMethod("vnpay_intl")}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                paymentMethod === "vnpay_intl"
                  ? "border-primary bg-accent/60"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <input
                type="radio"
                name="modalPaymentMethod"
                checked={paymentMethod === "vnpay_intl"}
                onChange={() => setPaymentMethod("vnpay_intl")}
                className="text-primary accent-primary"
              />
              <div className="flex-1 text-xs">
                <div className="font-bold text-foreground">
                  Thẻ thanh toán quốc tế (Visa, MasterCard, JCB)
                </div>
                <div className="text-muted-foreground mt-0.5">
                  Thẻ tín dụng / ghi nợ quốc tế phát hành toàn cầu
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Voucher input row */}
        <div className="pt-1">
          <label className="block text-xs font-semibold text-foreground mb-1.5">
            Mã giảm giá (Voucher)
          </label>
          <div className="flex gap-2">
            <Input
              type="text"
              value={voucherCode}
              onChange={(e) => setVoucherCode(e.target.value)}
              placeholder="Ví dụ: TICKET50K"
              className="uppercase h-10 text-xs font-mono"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleApplyVoucher}
              className="h-10 text-xs font-bold px-4 shrink-0"
            >
              Áp dụng
            </Button>
          </div>
          {voucherAppliedCode && (
            <p className="text-xs text-primary font-medium mt-1.5 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Đã áp dụng mã {voucherAppliedCode}: Giảm{" "}
              {voucherDiscount.toLocaleString("vi-VN")} ₫
            </p>
          )}
          {voucherError && (
            <p className="text-xs text-destructive font-medium mt-1.5">
              {voucherError}
            </p>
          )}
        </div>

        {paymentError && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-xs font-medium">
            {paymentError}
          </div>
        )}

        {/* Final Action Button */}
        <div className="pt-2">
          <Button
            type="button"
            disabled={isExpired || isSubmittingPayment}
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
