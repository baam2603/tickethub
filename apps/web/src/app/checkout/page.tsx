"use client";

import React, {
  Suspense,
  useState,
  useEffect,
  useCallback,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Clock,
  ShieldCheck,
  Lock,
  QrCode,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Share2,
  Info,
  ChevronDown,
  Sparkles,
  Flame,
  Award,
  Eye,
  Users,
  Zap,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/providers/session-provider";
import { EVENTS } from "@/lib/events-catalog";
import { apiClient } from "@/lib/api/client";

interface OrderDetailResponse {
  orderId: string;
  orderCode?: string;
  status: string;
  totalAmount: number;
  expiresAt: string;
  items: Array<{
    ticketTypeId: string;
    ticketTypeName?: string;
    zoneName?: string;
    quantity: number;
    unitPrice?: number;
    seats?: string[];
    isStanding?: boolean;
  }>;
  eventId?: string;
  eventTitle?: string;
  eventVenue?: string;
  eventDateTime?: string;
}

const DEFAULT_ORDER: OrderDetailResponse = {
  orderId: "ord-sample-01",
  orderCode: "ORD-20261103-BRUNO",
  status: "PENDING",
  totalAmount: 3600000,
  expiresAt: new Date(Date.now() + 300 * 1000).toISOString(),
  items: [
    {
      ticketTypeId: "tt-vip-01",
      ticketTypeName: "VIP 1 (Khán đài A)",
      zoneName: "Khu vực VIP 1",
      quantity: 2,
      unitPrice: 1800000,
      seats: ["Hàng G - Ghế 14", "Hàng G - Ghế 15"],
      isStanding: false,
    },
  ],
  eventId: "evt-bruno-mars",
  eventTitle: "Bruno Mars Live in Concert 2026 - Hanoi",
  eventVenue: "Sân vận động Quốc gia Mỹ Đình, Hà Nội",
  eventDateTime: "19:30 - Thứ Bảy, 15/11/2026",
};

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const { user } = useSession();

  const [order, setOrder] = useState<OrderDetailResponse>(DEFAULT_ORDER);
  const [isLoading, setIsLoading] = useState(Boolean(orderId));
  const [secondsLeft, setSecondsLeft] = useState(299);
  const [isExpired, setIsExpired] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Carousel state
  const carouselImages = [
    {
      src: "/assets/seat-view.jpg",
      alt: "Góc nhìn từ chỗ ngồi - Sân vận động Quốc gia Mỹ Đình",
      label: "Góc nhìn từ chỗ ngồi (View from Seat)",
    },
    {
      src: "/assets/artist-banner.webp",
      alt: "Nghệ sĩ biểu diễn Bruno Mars",
      label: "Nghệ sĩ biểu diễn (Bruno Mars)",
    },
  ];
  const [currentSlide, setCurrentSlide] = useState(0);

  // Form states for checkout payment modal
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "vnpay_qr" | "vnpay_atm" | "vnpay_intl"
  >("vnpay_qr");
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherDiscount, setVoucherDiscount] = useState(0);
  const [voucherAppliedCode, setVoucherAppliedCode] = useState<string | null>(
    null,
  );
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [isSubmittingPayment, startPaymentTransition] = useTransition();
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Autofill user info if authenticated
  useEffect(() => {
    queueMicrotask(() => {
      if (user) {
        if (user.fullName) {
          const parts = user.fullName.trim().split(" ");
          if (parts.length > 1) {
            setFirstName(parts[parts.length - 1]);
            setLastName(parts.slice(0, parts.length - 1).join(" "));
          } else {
            setFirstName(parts[0]);
            setLastName("");
          }
        }
        if (user.email) setEmail(user.email);
      } else {
        setFirstName("Văn An");
        setLastName("Nguyễn");
        setEmail("nguyenvanan@gmail.com");
        setPhone("0912345678");
      }
    });
  }, [user]);

  // Load real order data from backend if orderId is provided
  useEffect(() => {
    if (!orderId) {
      return;
    }

    let isMounted = true;
    async function fetchOrder() {
      try {
        const res = await apiClient<{
          success: boolean;
          data: unknown;
        }>(`/booking/orders/${orderId}`);
        if (isMounted && res.data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = res.data as any;
          const itemMap = new Map<
            string,
            {
              ticketTypeId: string;
              ticketTypeName: string;
              zoneName: string;
              quantity: number;
              unitPrice: number;
              seats: string[];
              isStanding: boolean;
            }
          >();

          if (Array.isArray(raw.items)) {
            for (const it of raw.items) {
              const tid = it.ticketTypeId || it.ticketType?.id || "default";
              const existing = itemMap.get(tid);
              const seatLabel = it.seat
                ? `Hàng ${it.seat.rowLabel} - Ghế ${it.seat.seatNumber}`
                : undefined;
              const isStanding =
                it.isStanding ??
                (it.ticketType ? !it.ticketType.isSeated : !seatLabel);
              if (existing) {
                existing.quantity += it.quantity || 1;
                if (seatLabel) existing.seats.push(seatLabel);
              } else {
                itemMap.set(tid, {
                  ticketTypeId: tid,
                  ticketTypeName:
                    it.ticketTypeName ||
                    it.ticketType?.name ||
                    it.zoneName ||
                    "Vé tham dự",
                  zoneName:
                    it.zoneName ||
                    it.seat?.zoneName ||
                    it.ticketType?.name ||
                    "Khu vực khán đài",
                  quantity: it.quantity || 1,
                  unitPrice: Number(
                    it.unitPrice || it.ticketType?.price || it.price || 0,
                  ),
                  seats: Array.isArray(it.seats)
                    ? it.seats
                    : seatLabel
                      ? [seatLabel]
                      : [],
                  isStanding,
                });
              }
            }
          }

          const mappedOrder: OrderDetailResponse = {
            orderId: raw.id || raw.orderId || orderId,
            orderCode:
              raw.orderCode ||
              `ORD-${(raw.id || orderId).slice(0, 8).toUpperCase()}`,
            status: raw.status || "PENDING",
            totalAmount: Number(raw.totalAmount) || 0,
            expiresAt: raw.expiresAt
              ? new Date(raw.expiresAt).toISOString()
              : new Date(Date.now() + 300 * 1000).toISOString(),
            items:
              itemMap.size > 0
                ? Array.from(itemMap.values())
                : DEFAULT_ORDER.items,
            eventId: raw.eventId || raw.event?.id,
            eventTitle:
              raw.eventTitle || raw.event?.title || DEFAULT_ORDER.eventTitle,
            eventVenue:
              raw.eventVenue ||
              [raw.event?.venueName, raw.event?.venueAddress, raw.event?.city]
                .filter(Boolean)
                .join(", ") ||
              DEFAULT_ORDER.eventVenue,
            eventDateTime: raw.eventDateTime
              ? raw.eventDateTime
              : raw.event?.startTime
                ? new Date(raw.event.startTime).toLocaleString("vi-VN", {
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : DEFAULT_ORDER.eventDateTime,
          };

          setOrder(mappedOrder);
          if (mappedOrder.expiresAt) {
            const expireTime = new Date(mappedOrder.expiresAt).getTime();
            const now = Date.now();
            const diff = Math.max(0, Math.floor((expireTime - now) / 1000));
            setSecondsLeft(diff);
            if (diff <= 0) setIsExpired(true);
          }
        }
      } catch {
        if (isMounted) {
          const safeId = orderId || "ord-sample-01";
          setOrder({
            ...DEFAULT_ORDER,
            orderId: safeId,
            orderCode: `ORD-${safeId.slice(0, 8).toUpperCase()}`,
          });
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchOrder();
    return () => {
      isMounted = false;
    };
  }, [orderId]);

  // Handle release seats when expired
  const handleExpireRelease = useCallback(async () => {
    setIsExpired(true);
    if (order.orderId) {
      try {
        await apiClient<{ success: boolean }>("/booking/release", {
          method: "POST",
          body: JSON.stringify({ orderId: order.orderId }),
        });
      } catch {
        // Best effort release
      }
    }
  }, [order.orderId]);

  // Countdown timer logic
  useEffect(() => {
    if (isLoading || isExpired) return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleExpireRelease();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isLoading, isExpired, handleExpireRelease]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const confirmCancelHold = async () => {
    setIsCancelling(true);
    try {
      if (order.orderId) {
        await apiClient<{ success: boolean }>("/booking/release", {
          method: "POST",
          body: JSON.stringify({ orderId: order.orderId }),
        });
      }
    } catch {
      // Best effort release
    } finally {
      setIsCancelling(false);
      router.push("/events");
    }
  };

  const handleApplyVoucher = () => {
    setVoucherError(null);
    const code = voucherCode.trim().toUpperCase();
    if (!code) {
      setVoucherError("Vui lòng nhập mã giảm giá.");
      return;
    }

    if (code === "TICKET50K" || code === "GIAM50K") {
      setVoucherDiscount(50000);
      setVoucherAppliedCode(code);
      setVoucherError(null);
    } else if (code === "VIP10" || code === "TICKETHUB10") {
      const discount = Math.round(order.totalAmount * 0.1);
      setVoucherDiscount(discount);
      setVoucherAppliedCode(code);
      setVoucherError(null);
    } else {
      setVoucherDiscount(0);
      setVoucherAppliedCode(null);
      setVoucherError("Mã giảm giá không hợp lệ hoặc đã hết lượt áp dụng.");
    }
  };

  const handlePaymentSubmit = () => {
    setPaymentError(null);
    if (!firstName.trim() || !email.trim() || !phone.trim()) {
      setPaymentError(
        "Vui lòng điền đầy đủ họ tên, email và số điện thoại người nhận vé.",
      );
      return;
    }

    startPaymentTransition(async () => {
      try {
        const res = await apiClient<{
          success: boolean;
          data: { paymentUrl: string };
        }>(`/payments/orders/${order.orderId}/vnpay`, {
          method: "POST",
          body: JSON.stringify({
            paymentMethod,
            voucherCode: voucherAppliedCode,
            recipient: {
              firstName,
              lastName,
              email,
              phone,
            },
          }),
        });

        if (res.data?.paymentUrl) {
          window.location.href = res.data.paymentUrl;
        } else {
          router.push(`/buyer/orders/${order.orderId}?paymentSuccess=true`);
        }
      } catch {
        router.push(`/buyer/orders/${order.orderId}?paymentSuccess=true`);
      }
    });
  };

  const subtotal = order.totalAmount || 3600000;
  const platformFee = 250000;
  const finalTotal = Math.max(0, subtotal + platformFee - voucherDiscount);

  const eventData = EVENTS.find((e) => e.id === order.eventId) || EVENTS[0];
  const ticketItem = order.items[0] || DEFAULT_ORDER.items[0];

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased flex flex-col justify-between">
      {/* 1. TOP BAR */}
      <header className="sticky top-0 z-40 w-full bg-background border-b border-border shadow-xs">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-4">
          {/* Left: Seat View Thumbnail, Event Details, Status Chip */}
          <div className="flex items-center gap-2.5 sm:gap-4 min-w-0 flex-1">
            <div className="relative w-14 h-14 sm:w-20 sm:h-20 rounded-lg sm:rounded-xl overflow-hidden shrink-0 border border-border bg-muted">
              <Image
                src="/assets/seat-view.jpg"
                alt="Góc nhìn từ chỗ ngồi"
                fill
                sizes="(max-width: 640px) 56px, 80px"
                className="object-cover"
                priority
              />
            </div>

            <div className="min-w-0 space-y-0.5 sm:space-y-1">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <Link
                  href={order.eventId ? `/events/${order.eventId}` : "/events"}
                  className="text-primary font-bold text-sm sm:text-base md:text-lg leading-tight truncate hover:underline"
                >
                  {order.eventTitle || eventData.title}
                </Link>
                <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold bg-destructive/10 text-destructive border border-destructive/20 shrink-0">
                  Sắp hết vé
                </span>
              </div>

              <div className="text-[11px] sm:text-xs text-muted-foreground flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <span className="shrink-0">
                  {order.eventDateTime || eventData.fullDateTime}
                </span>
                <span className="hidden xs:inline">•</span>
                <span className="text-foreground underline underline-offset-2 decoration-muted-foreground/60 truncate">
                  {order.eventVenue || eventData.venue}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Share, Countdown Timer with Clock & Info, Currency Selector */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Circular Share Button */}
            <button
              type="button"
              onClick={() => {
                if (navigator.share) {
                  navigator.share({
                    title: order.eventTitle || eventData.title,
                    url: window.location.href,
                  });
                } else {
                  navigator.clipboard.writeText(window.location.href);
                  alert("Đã sao chép liên kết đặt vé vào bộ nhớ tạm.");
                }
              }}
              aria-label="Chia sẻ sự kiện"
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-full border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors shrink-0"
            >
              <Share2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            {/* Countdown Hold Capsule with Clock and Info Icons */}
            <div
              className={`inline-flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border text-xs sm:text-sm font-semibold transition-colors shrink-0 ${
                secondsLeft <= 60
                  ? "bg-destructive/10 border-destructive/30 text-destructive animate-pulse"
                  : "bg-muted/70 border-border text-foreground"
              }`}
            >
              <Clock
                className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${secondsLeft <= 60 ? "text-destructive" : "text-muted-foreground"}`}
              />
              <span className="font-mono text-xs sm:text-sm font-bold tabular-nums">
                {formatTimer(secondsLeft)}
              </span>
              <button
                type="button"
                onClick={() => setShowInfoModal(true)}
                aria-label="Thông tin thời hạn giữ vé"
                className="text-muted-foreground hover:text-foreground"
              >
                <Info className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </button>
            </div>

            {/* Currency / Language Selector */}
            <div className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border text-xs font-semibold text-foreground bg-background">
              <span>VND | VN</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </div>

            {/* Abort reservation link */}
            <button
              type="button"
              onClick={() => setShowCancelModal(true)}
              className="text-xs font-medium text-muted-foreground hover:text-destructive hidden lg:inline ml-1"
            >
              Hủy
            </button>
          </div>
        </div>
      </header>

      {/* 2. TWO-COLUMN LAYOUT (Max-W 1200px, 60/40 Ratio) */}
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
                {ticketItem.ticketTypeName ||
                  ticketItem.zoneName ||
                  "VIP 1 (Khán đài A)"}
              </h1>

              <div className="text-sm sm:text-base text-muted-foreground flex items-center gap-2 flex-wrap pt-0.5">
                <span>{ticketItem.quantity} vé · Ngồi liền kề</span>
                <span>•</span>
                {ticketItem.isStanding ? (
                  <span className="font-semibold text-foreground">
                    Khu vực: GA - Fanzone (Vé đứng)
                  </span>
                ) : (
                  <span className="font-semibold text-foreground">
                    {ticketItem.seats && ticketItem.seats.length > 0
                      ? ticketItem.seats.join(", ")
                      : "Hàng G - Ghế 14, Hàng G - Ghế 15"}
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
                    Mức giá niêm yết chính thức từ Ban tổ chức, đảm bảo minh
                    bạch và không phát sinh phí ẩn.
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
                    Mã QR động chữ ký số Ed25519 tự động hiển thị trong mục Vé
                    của tôi ngay sau khi thanh toán.
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
                      {ticketItem.ticketTypeName || "Vé VIP 1"}
                    </span>
                    <div className="text-[11px] text-muted-foreground">
                      {ticketItem.unitPrice
                        ? `${ticketItem.unitPrice.toLocaleString("vi-VN")} ₫ mỗi vé`
                        : "1.800.000 ₫ mỗi vé"}
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
                    100% Cam kết từ TicketHub
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

      {/* MOBILE STICKY BOTTOM BAR (Visible only on < lg screens) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-md border-t border-border px-4 py-3 flex items-center justify-between gap-3 shadow-lg">
        <div>
          <div className="text-[11px] text-muted-foreground">
            Tổng cộng (Đã gồm VAT)
          </div>
          <div className="text-base sm:text-lg font-black text-foreground">
            {finalTotal.toLocaleString("vi-VN")} ₫
          </div>
        </div>
        <Button
          type="button"
          onClick={() => setShowPaymentModal(true)}
          disabled={isExpired}
          className="h-10 px-5 text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 rounded-md shadow-xs flex items-center gap-1.5 cursor-pointer"
        >
          <span>Tiếp tục</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* 3. FOOTER */}
      <footer className="w-full border-t border-border bg-background mt-16 py-6 sm:py-8">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          {/* Left: Legal Links */}
          <div className="flex items-center gap-4 sm:gap-6 flex-wrap justify-center md:justify-start">
            <Link
              href="/terms"
              className="hover:text-foreground transition-colors"
            >
              Điều khoản sử dụng
            </Link>
            <Link
              href="/privacy"
              className="hover:text-foreground transition-colors"
            >
              Chính sách bảo mật
            </Link>
            <Link
              href="/guarantee"
              className="hover:text-foreground transition-colors"
            >
              Cam kết bảo vệ vé 100%
            </Link>
            <Link
              href="/help"
              className="hover:text-foreground transition-colors"
            >
              Trợ giúp
            </Link>
          </div>

          {/* Center: Guarantee Badge */}
          <div className="flex items-center gap-2 font-medium text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <span>Mọi đơn hàng đều được cam kết 100% chính hãng</span>
          </div>

          {/* Right: Copyright */}
          <div className="text-center md:text-right">
            © 2026 TicketHub. All Rights Reserved.
          </div>
        </div>
      </footer>

      {/* MODAL: PAYMENT & RECIPIENT INFORMATION (Triggered by "Tiếp tục") */}
      {showPaymentModal && (
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
                  Email nhận vé điện tử{" "}
                  <span className="text-destructive">*</span>
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
                  Số điện thoại liên hệ{" "}
                  <span className="text-destructive">*</span>
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
      )}

      {/* MODAL: INFO ABOUT HOLD TIMER */}
      {showInfoModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-sm w-full p-5 text-foreground space-y-3 shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <span>Quy định giữ chỗ 5 phút</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowInfoModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Nhằm đảm bảo sự công bằng cho tất cả người mua, vé của bạn sẽ được
              hệ thống tạm khóa và giữ trong đúng 5 phút (300 giây). Nếu quá hạn
              trên, vé sẽ tự động được trả lại kho vé chung.
            </p>
            <Button
              type="button"
              onClick={() => setShowInfoModal(false)}
              className="w-full h-9 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Đã hiểu
            </Button>
          </div>
        </div>
      )}

      {/* MODAL: EXPIRATION TIMEOUT */}
      {isExpired && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <Clock className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-foreground">
              Hết thời gian giữ chỗ (05:00)
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Thời hạn giữ vé 5 phút đã kết thúc. Hệ thống đã tự động giải phóng
              vị trí ghế này để bảo đảm công bằng cho các khách hàng khác.
            </p>
            <div className="pt-2">
              <Button
                type="button"
                onClick={() => router.push("/events")}
                className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
              >
                Quay về trang sự kiện
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CANCEL CONFIRMATION */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <h3 className="text-lg font-bold text-foreground">
              Xác nhận hủy giữ chỗ?
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Vé của bạn sẽ được hoàn trả về kho vé ngay lập tức để người khác
              có thể đặt mua. Bạn có chắc chắn muốn hủy giao dịch này không?
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={isCancelling}
                onClick={() => setShowCancelModal(false)}
                className="h-10 text-xs sm:text-sm font-semibold"
              >
                Tiếp tục đặt vé
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isCancelling}
                onClick={confirmCancelHold}
                className="h-10 text-xs sm:text-sm font-bold bg-destructive text-white hover:bg-destructive/90"
              >
                {isCancelling ? "Đang hủy..." : "Hủy giữ chỗ"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground font-medium">
              Đang tải thông tin đặt vé...
            </p>
          </div>
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
