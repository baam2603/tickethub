"use client";

import { Suspense, useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import {
  Calendar,
  MapPin,
  QrCode,
  CheckCircle2,
  Ticket,
  X,
  ShieldCheck,
  Download,
  Clock,
} from "lucide-react";
import { EVENTS, getEventById } from "@/lib/events-catalog";

function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(amount);
}

function MyTicketsContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("event") ?? "";
  const orderCode = searchParams.get("order") ?? "ORD-88412";
  const zoneName = searchParams.get("zone") ?? "VIP BẠC";
  const rowLabel = searchParams.get("row") ?? "Hàng 12";
  const quantity = Math.max(
    1,
    parseInt(searchParams.get("qty") ?? "2", 10) || 2,
  );
  const unitPrice =
    parseInt(searchParams.get("price") ?? "1800000", 10) || 1800000;
  const totalPrice = unitPrice * quantity;

  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  const activeEvent = getEventById(eventId) ?? EVENTS[0];

  // Derive seat numbers based on order number and quantity
  const seatNumbers = Array.from({ length: quantity }, (_, i) => {
    const baseNum = (unitPrice % 40) + 1 + i;
    return `${rowLabel ? rowLabel.replace(/[^0-9A-Za-z]/g, "").slice(0, 3) : "S"}-${String(baseNum).padStart(2, "0")}`;
  }).join(", ");

  // Secure ticket payload for gate check
  const qrPayload = JSON.stringify({
    v: 1,
    order: orderCode,
    event: activeEvent.id,
    zone: zoneName,
    seats: seatNumbers,
    issuedAt: new Date().toISOString(),
  });

  useEffect(() => {
    QRCode.toDataURL(qrPayload, {
      width: 400,
      margin: 1,
      color: {
        dark: "#141d23",
        light: "#ffffff",
      },
      errorCorrectionLevel: "M",
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error("QR Code generation error:", err));
  }, [qrPayload]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-foreground">
            Vé của tôi
          </h1>
          <p className="text-[14px] text-muted-foreground">
            Quản lý các vé sự kiện điện tử bạn đã đặt trên TicketHub
          </p>
        </div>
        <div className="flex items-center gap-2.5 self-start">
          <Link
            href={`/events/${activeEvent.id}`}
            className="inline-flex items-center gap-1.5 justify-center h-10 px-4 rounded-full border border-border bg-background text-foreground text-[13px] font-semibold hover:border-primary hover:text-primary transition-colors"
          >
            <Ticket className="size-4 text-primary" />
            Xem sơ đồ ghế
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-10 px-5 rounded-full bg-primary text-primary-foreground text-[13px] font-bold hover:bg-emerald-700 transition-colors"
          >
            Đăng nhập để đồng bộ vé
          </Link>
        </div>
      </div>

      {/* Boarding-Pass Style Event Ticket */}
      <div className="rounded-[16px] border border-border bg-background shadow-xs overflow-hidden max-w-3xl">
        <div className="p-6 sm:p-7 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-primary text-[12px] font-bold">
              <CheckCircle2 className="size-3.5" /> Vé hợp lệ • Đã thanh toán
              qua VNPay
            </span>
            <span className="text-[12px] font-mono font-bold text-muted-foreground">
              MÃ ĐƠN #{orderCode}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
            <Image
              src={activeEvent.image}
              alt={activeEvent.title}
              width={128}
              height={80}
              unoptimized
              className="w-full sm:w-32 aspect-[16/10] object-cover rounded-[10px] bg-secondary shrink-0"
            />
            <div className="space-y-1.5">
              <h2 className="text-[19px] sm:text-[21px] font-extrabold text-foreground">
                {activeEvent.title}
              </h2>
              <div className="flex flex-wrap items-center gap-4 text-[13px] text-muted-foreground pt-0.5">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-4 text-primary" />{" "}
                  {activeEvent.fullDateTime}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4 text-primary" /> {activeEvent.venue}
                  , {activeEvent.city}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 rounded-[12px] bg-muted border border-border p-4">
            <div>
              <span className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Khu vực
              </span>
              <span className="font-bold text-[15px] text-foreground">
                {zoneName}
              </span>
            </div>
            <div>
              <span className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Hàng ghế
              </span>
              <span className="font-mono font-bold text-[15px] text-foreground">
                {rowLabel || "Tự do"}
              </span>
            </div>
            <div>
              <span className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Số ghế ({quantity} vé)
              </span>
              <span className="font-mono font-bold text-[15px] text-primary">
                {seatNumbers}
              </span>
            </div>
            <div>
              <span className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Tổng thanh toán
              </span>
              <span className="font-extrabold text-[15px] text-foreground">
                {formatVnd(totalPrice)}
              </span>
            </div>
          </div>
        </div>

        {/* Perforated Boarding-Pass Divider */}
        <div className="ticket-notch-horizontal border-t border-dashed border-border" />

        {/* Bottom QR Pass Bar */}
        <div className="px-6 sm:px-7 py-4 bg-muted/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-[10px] bg-background border border-border flex items-center justify-center text-foreground shrink-0 overflow-hidden">
              {qrDataUrl ? (
                <Image
                  src={qrDataUrl}
                  alt="Mã QR"
                  width={40}
                  height={40}
                  unoptimized
                  className="size-10 object-contain"
                />
              ) : (
                <QrCode className="size-6 text-foreground" />
              )}
            </div>
            <div>
              <p className="text-[13px] font-bold text-foreground">
                Vé điện tử vào cổng chính thức
              </p>
              <p className="text-[12px] text-muted-foreground">
                Xuất trình mã QR bảo mật tại cổng soát vé {activeEvent.venue}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsQrModalOpen(true)}
            className="inline-flex items-center justify-center h-9 px-4 rounded-full bg-primary hover:bg-emerald-700 text-primary-foreground text-[12px] font-bold transition-colors shrink-0 shadow-xs"
          >
            Mở mã QR
          </button>
        </div>
      </div>

      {/* QR Code Modal for Gate Check */}
      {isQrModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white text-slate-900 rounded-[20px] max-w-sm w-full p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            <button
              type="button"
              onClick={() => setIsQrModalOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="size-5" />
            </button>

            <div className="text-center space-y-1 mb-4">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-primary text-[11px] font-bold">
                <ShieldCheck className="size-3.5" /> Vé điện tử chính hãng • Đã
                xác thực
              </span>
              <h3 className="text-[17px] font-extrabold text-slate-900 pt-1">
                {activeEvent.title}
              </h3>
              <p className="text-[12px] text-slate-500 font-mono">
                MÃ ĐƠN #{orderCode}
              </p>
            </div>

            {/* QR Code Container */}
            <div className="bg-[#f8fafc] border border-slate-200 rounded-[14px] p-4 flex flex-col items-center justify-center">
              {qrDataUrl && (
                <Image
                  src={qrDataUrl}
                  alt={`QR Code ${orderCode}`}
                  width={224}
                  height={224}
                  unoptimized
                  className="w-56 h-56 object-contain"
                />
              )}
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
                <Clock className="size-3 text-primary animate-spin" />
                <span>Mã xác thực tự động làm mới sau mỗi 60 giây</span>
              </div>
            </div>

            {/* Seating Details */}
            <div className="mt-4 p-3 bg-slate-50 rounded-[10px] border border-slate-100 text-[12px] space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Khu vực:</span>
                <span className="font-bold text-slate-900">{zoneName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Hàng ghế &amp; Ghế:</span>
                <span className="font-bold text-primary">{seatNumbers}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Địa điểm:</span>
                <span className="font-medium text-slate-700">
                  {activeEvent.venue}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-5 space-y-2">
              {qrDataUrl && (
                <a
                  href={qrDataUrl}
                  download={`tickethub-${orderCode}.png`}
                  className="w-full h-10 rounded-[10px] bg-primary hover:bg-emerald-700 text-white text-[13px] font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <Download className="size-4" />
                  Lưu ảnh mã QR về máy
                </a>
              )}
              <button
                type="button"
                onClick={() => setIsQrModalOpen(false)}
                className="w-full h-9 rounded-[8px] border border-slate-200 bg-white hover:bg-slate-50 text-[12px] font-semibold text-slate-600 transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyTicketsPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 text-sm text-muted-foreground">
          Đang tải vé...
        </div>
      }
    >
      <MyTicketsContent />
    </Suspense>
  );
}
