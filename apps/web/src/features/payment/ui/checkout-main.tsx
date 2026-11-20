"use client";

import Image from "next/image";
import {
  ShieldCheck,
  Lock,
  QrCode,
  ChevronLeft,
  ChevronRight,
  Info,
  Sparkles,
  Flame,
  Award,
  Eye,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { CheckoutScreen } from "./use-checkout-screen";

/** Bo cuc 2 cot: tom tat su kien va ve (60%), chi phi va hanh dong (40%). */
export function CheckoutMain({ vm }: { vm: CheckoutScreen }) {
  const {
    isExpired,
    setShowPaymentModal,
    carouselImages,
    currentSlide,
    setCurrentSlide,
    voucherDiscount,
    voucherAppliedCode,
    subtotal,
    platformFee,
    finalTotal,
    ticketItem,
  } = vm;

  return (
    <main className="max-w-[1200px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 flex-1 pb-24 lg:pb-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
        {/* LEFT COLUMN (~60% inside 12-col grid: col-span-7) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Hero Image Carousel */}
          <div className="relative rounded-2xl overflow-hidden aspect-[16/10] bg-muted border border-border shadow-xs group">
            <Image
              src={carouselImages[currentSlide].src}
              alt={carouselImages[currentSlide].alt}
              fill
              sizes="(max-width: 1024px) 100vw, 700px"
              className="object-cover"
              priority
            />

            {/* Tag overlay */}
            <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-xs text-white text-xs font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm">
              <Eye className="h-3.5 w-3.5 text-white" />
              <span>{carouselImages[currentSlide].label}</span>
            </div>

            {/* Prev / Next buttons */}
            <button
              type="button"
              onClick={() =>
                setCurrentSlide((prev) =>
                  prev === 0 ? carouselImages.length - 1 : prev - 1,
                )
              }
              aria-label="Ảnh trước"
              className="absolute left-3 top-1/2 -translate-y-1/2 h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-background/90 hover:bg-background text-foreground shadow-md flex items-center justify-center transition-transform hover:scale-105 border border-border/50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                setCurrentSlide((prev) =>
                  prev === carouselImages.length - 1 ? 0 : prev + 1,
                )
              }
              aria-label="Ảnh kế tiếp"
              className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-background/90 hover:bg-background text-foreground shadow-md flex items-center justify-center transition-transform hover:scale-105 border border-border/50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Dots */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
              {carouselImages.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCurrentSlide(idx)}
                  aria-label={`Chuyển tới ảnh ${idx + 1}`}
                  className={`h-2 rounded-full transition-all ${
                    currentSlide === idx
                      ? "w-5 bg-white"
                      : "w-2 bg-white/60 hover:bg-white/80"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Ticket Class & Auto-Allocated Seats Heading */}
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {ticketItem.ticketTypeName || ticketItem.zoneName || "Khu VIP A"}
            </h1>

            <div className="text-sm sm:text-base text-muted-foreground flex items-center gap-2 flex-wrap pt-0.5">
              <span>{ticketItem.quantity} vé · Ngồi liền kề</span>
              <span>•</span>
              {ticketItem.isStanding ? (
                <span className="font-semibold text-foreground">
                  Khu vực: GA (Vé đứng)
                </span>
              ) : (
                <span className="font-semibold text-foreground">
                  {ticketItem.seats && ticketItem.seats.length > 0
                    ? ticketItem.seats.join(", ")
                    : "Hàng A - Ghế 01, Hàng A - Ghế 02"}
                </span>
              )}
            </div>
          </div>

          {/* Chips Row */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {/* High demand */}
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-destructive/10 text-destructive border border-destructive/20">
              <Flame className="h-3.5 w-3.5 text-destructive" />
              <span>Nhu cầu cao</span>
            </span>

            {/* Rating badge */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-primary text-primary-foreground shadow-2xs">
              <span>8.3 Tuyệt vời</span>
              <Info className="h-3 w-3 opacity-80" />
            </span>

            {/* Neutral: E-ticket */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-muted text-foreground border border-border">
              <QrCode className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Vé điện tử (QR động)</span>
            </span>

            {/* Neutral: Artist / Award */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground border border-border">
              <Award className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Nghệ sĩ đoạt giải</span>
            </span>
          </div>

          {/* Divider */}
          <div className="border-t border-border my-6" />

          {/* Feature List (5 Icons in Rounded Muted Squares) */}
          <div className="space-y-4 pt-1">
            {/* Feature 1 */}
            <div className="flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-xl bg-muted border border-border flex items-center justify-center text-primary shrink-0 shadow-2xs">
                <Zap className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  Giá vé niêm yết tối ưu
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Mức giá niêm yết chính thức từ Ban tổ chức, đảm bảo minh bạch
                  và không phát sinh phí ẩn.
                </p>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-xl bg-muted border border-border flex items-center justify-center text-primary shrink-0 shadow-2xs">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  Lựa chọn được ưa chuộng nhất
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Hạng vé sở hữu vị trí đắc địa và được đông đảo khán giả quan
                  tâm đặt trước.
                </p>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-xl bg-muted border border-border flex items-center justify-center text-primary shrink-0 shadow-2xs">
                <Eye className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  Tầm nhìn rõ nét không bị che khuất
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Vị trí khán đài trực diện sân khấu, âm thanh tiêu chuẩn quốc
                  tế chân thực và sống động.
                </p>
              </div>
            </div>

            {/* Feature 4 */}
            <div className="flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-xl bg-muted border border-border flex items-center justify-center text-primary shrink-0 shadow-2xs">
                <Users className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  Ghế ngồi phân bổ liền kề nhau
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Hệ thống tự động phân bổ và giữ các vị trí ghế nằm cạnh nhau
                  trong cùng một hàng ghế.
                </p>
              </div>
            </div>

            {/* Feature 5 */}
            <div className="flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-xl bg-muted border border-border flex items-center justify-center text-primary shrink-0 shadow-2xs">
                <QrCode className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  Xuất vé điện tử QR tức thì
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Mã QR động chữ ký số Ed25519 tự động hiển thị trong mục Vé của
                  tôi ngay sau khi thanh toán.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (~40% inside 12-col grid: col-span-5, Sticky) */}
        <div className="lg:col-span-5 space-y-5 lg:sticky lg:top-24">
          {/* ONE SMALL WHITE CARD */}
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
            {/* Accent Banner: "Những vé này sắp thuộc về bạn!" */}
            <div className="bg-accent text-accent-foreground px-4 py-2.5 text-xs sm:text-sm font-semibold flex items-center gap-2 border-b border-border/40">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <span>Những vé này sắp thuộc về bạn!</span>
            </div>

            {/* Card Body */}
            <div className="p-5 sm:p-6 space-y-4">
              <h2 className="text-base sm:text-lg font-bold text-foreground">
                Tóm tắt đơn hàng
              </h2>

              {/* Ticket Count x Price Row */}
              <div className="flex justify-between items-start text-xs sm:text-sm text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">
                    {ticketItem.quantity} x{" "}
                    {ticketItem.ticketTypeName || "Vé VIP A"}
                  </span>
                  <div className="text-[11px] text-muted-foreground">
                    {ticketItem.unitPrice
                      ? `${ticketItem.unitPrice.toLocaleString("vi-VN")} ₫ mỗi vé`
                      : "2.500.000 ₫ mỗi vé"}
                  </div>
                </div>
                <span className="font-semibold text-foreground">
                  {subtotal.toLocaleString("vi-VN")} ₫
                </span>
              </div>

              {/* Service fee row */}
              <div className="flex justify-between text-xs sm:text-sm text-muted-foreground">
                <span>Phí dịch vụ nền tảng</span>
                <span className="font-medium text-foreground">
                  {platformFee.toLocaleString("vi-VN")} ₫
                </span>
              </div>

              {/* Voucher Discount if applied */}
              {voucherDiscount > 0 && (
                <div className="flex justify-between text-xs sm:text-sm text-primary font-semibold">
                  <span>Mã giảm giá ({voucherAppliedCode})</span>
                  <span>- {voucherDiscount.toLocaleString("vi-VN")} ₫</span>
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-border pt-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-sm sm:text-base font-bold text-foreground">
                    Tổng cộng
                  </span>
                  <div className="text-right">
                    <span className="text-xl sm:text-2xl font-black text-foreground">
                      {finalTotal.toLocaleString("vi-VN")} ₫
                    </span>
                    <div className="text-[11px] text-muted-foreground">
                      Đã bao gồm thuế GTGT (VAT)
                    </div>
                  </div>
                </div>
              </div>

              {/* Full-width Primary "Tiếp tục" Button */}
              <Button
                type="button"
                onClick={() => setShowPaymentModal(true)}
                disabled={isExpired}
                className="w-full h-11 sm:h-12 text-sm sm:text-base font-bold bg-primary text-primary-foreground hover:bg-primary/90 rounded-md shadow-xs flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                <span>Tiếp tục</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* BELOW THE CARD (No Box, Two Trust Rows) */}
          <div className="space-y-4 pt-1 px-1">
            {/* Row 1 */}
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="text-xs sm:text-sm font-bold text-foreground">
                  100% Cam kết từ tickethub
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  Mọi đơn hàng đều được đảm bảo vé chính hãng hợp lệ tại cổng
                  soát vé sự kiện.
                </div>
              </div>
            </div>

            {/* Row 2 */}
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="text-xs sm:text-sm font-bold text-foreground">
                  Bảo vệ giao dịch an toàn
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  Tự động hoàn tiền 100% nếu phiên giữ chỗ quá hạn hoặc xảy ra
                  sự cố.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
