"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  Heart,
  Flame,
  SlidersHorizontal,
  ChevronDown,
  X,
  CheckCircle2,
  Timer,
  Eye,
  ShieldCheck,
  User,
  Users,
  Search,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import {
  EVENTS,
  getEventById,
  getEventVenueMapKey,
  getEventListings,
  formatVnd,
  type EventItem,
  type TicketListing,
} from "@/lib/events-catalog";
import { SeatMap } from "@/components/events/seat-map";
import {
  computeRemainingSeconds,
  getHoldErrorInfo,
  nowMs,
} from "@/components/events/seat-map.utils";
import { useSession } from "@/providers/session-provider";
import { getAccessToken } from "@/lib/api/client";

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const eventId = typeof params?.id === "string" ? params.id : "";

  const event = useMemo(() => {
    return getEventById(eventId) ?? EVENTS[0];
  }, [eventId]);

  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center text-[13px] text-[#606970]">
          Đang tải sơ đồ sự kiện...
        </div>
      }
    >
      <EventSplitView key={event.id} event={event} />
    </Suspense>
  );
}

function EventSplitView({ event }: { event: EventItem }) {
  const { user } = useSession();
  const isAdmin = user?.role === "ADMIN";
  const isOrganizer = user?.role === "ORGANIZER";
  const cannotBuyTickets = isAdmin || isOrganizer;

  const mapKey = useMemo(() => getEventVenueMapKey(event), [event]);
  const allListings = useMemo(() => getEventListings(event), [event]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Selected filters & state
  const [ticketQuantity, setTicketQuantity] = useState<number>(2);
  // Modal automatically pops up on initial load unless disabled via query param
  const [showQtyModal, setShowQtyModal] = useState<boolean>(
    searchParams.get("modal") !== "false",
  );
  const [activeZoneId, setActiveZoneId] = useState<string | null>(
    searchParams.get("zone") || null,
  );
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<TicketListing | null>(
    null,
  );
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [showSubtotalModal, setShowSubtotalModal] = useState<boolean>(false);

  // 5-minute Hold countdown & server state (UC04)
  const [holdOrderId, setHoldOrderId] = useState<string | null>(null);
  const [holdExpiresAtMs, setHoldExpiresAtMs] = useState<number | null>(null);
  const [holdTotalAmount, setHoldTotalAmount] = useState<number | null>(null);
  const [holdSecondsLeft, setHoldSecondsLeft] = useState<number | null>(null);
  const [holdOrderCode, setHoldOrderCode] = useState<string | null>(null);
  const [allocatedSeats, setAllocatedSeats] = useState<
    Array<{
      id: string;
      zoneName: string;
      rowLabel: string;
      seatNumber: string;
    }>
  >([]);
  const [isHoldingTicket, setIsHoldingTicket] = useState<boolean>(false);
  const [holdErrorMessage, setHoldErrorMessage] = useState<string | null>(null);

  // Countdown bám theo holdExpiresAt của server (không tự đếm lùi theo client).
  // Hết hạn: đóng drawer + popup tạm tính, vô hiệu thanh toán (UC04-E2).
  useEffect(() => {
    if (holdExpiresAtMs === null) return;
    const timer = setInterval(() => {
      const left = computeRemainingSeconds(holdExpiresAtMs, Date.now());
      if (left > 0) {
        setHoldSecondsLeft(left);
        return;
      }
      clearInterval(timer);
      setShowSubtotalModal(false);
      setSelectedListing(null);
      setHoldSecondsLeft(null);
      setHoldExpiresAtMs(null);
      setHoldTotalAmount(null);
      setHoldOrderCode(null);
      setHoldOrderId(null);
      setAllocatedSeats([]);
      setHoldErrorMessage(
        "Hết thời gian giữ chỗ 5 phút. Vé đã được trả lại hệ thống, vui lòng chọn lại.",
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [holdExpiresAtMs]);

  // Rời trang/đóng tab khi đang giữ chỗ: cố gắng nhả ghế ngay (UC04-E3).
  // Nếu không gửi kịp, job quét 30 giây/lần sẽ trả ghế sau khi hết hạn (UC04-E2).
  useEffect(() => {
    if (!holdOrderId) return;
    const releaseOnLeave = () => {
      const token = getAccessToken();
      void fetch("/api/v1/booking/release", {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ orderId: holdOrderId }),
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", releaseOnLeave);
    return () => window.removeEventListener("pagehide", releaseOnLeave);
  }, [holdOrderId]);

  // Filter listings based on activeZoneId
  const filteredListings = useMemo(() => {
    return allListings.filter((l) => {
      if (activeZoneId && l.zoneId !== activeZoneId) {
        return false;
      }
      return true;
    });
  }, [allListings, activeZoneId]);

  // Map of zone information for map tooltips (accumulates all tickets per zone)
  const zoneInfoMap = useMemo(() => {
    const map: Record<
      string,
      { name: string; minPrice: number; count: number }
    > = {};
    for (const listing of allListings) {
      const zone = map[listing.zoneId];
      if (zone) {
        zone.minPrice = Math.min(zone.minPrice, listing.price);
        zone.count += listing.availableTickets;
      } else {
        map[listing.zoneId] = {
          name: listing.zoneName,
          minPrice: listing.price,
          count: listing.availableTickets,
        };
      }
    }
    return map;
  }, [allListings]);

  const resetHoldState = () => {
    setShowSubtotalModal(false);
    setSelectedListing(null);
    setHoldSecondsLeft(null);
    setHoldExpiresAtMs(null);
    setHoldTotalAmount(null);
    setHoldOrderCode(null);
    setHoldOrderId(null);
    setAllocatedSeats([]);
  };

  const handleStartHold = async (listing: TicketListing) => {
    // 1 phiên giữ chỗ / tài khoản / sự kiện: chặn bấm lặp hoặc giữ thêm khi đang giữ
    if (isHoldingTicket || holdOrderId) return;

    if (listing.availableTickets < ticketQuantity) {
      setHoldErrorMessage(
        `Hạng vé ${listing.section} chỉ còn ${listing.availableTickets} vé, không đủ cho yêu cầu ${ticketQuantity} vé của bạn. Vui lòng giảm số lượng vé hoặc chọn hạng vé khác.`,
      );
      return;
    }

    if (cannotBuyTickets) {
      setSelectedListing(listing);
      return;
    }

    setIsHoldingTicket(true);
    setHoldErrorMessage(null);

    try {
      const token = getAccessToken();
      const response = await fetch("/api/v1/booking/hold", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          eventId: event.id,
          items: [
            {
              ticketTypeId: listing.id,
              quantity: ticketQuantity,
            },
          ],
        }),
      });

      if (!response.ok) {
        let serverCode: string | undefined;
        let serverMessage: string | undefined;
        try {
          const errData = await response.json();
          serverCode = errData?.error?.code;
          serverMessage = errData?.error?.message;
        } catch {
          // Body không phải JSON: dùng thông điệp theo mã HTTP
        }
        const info = getHoldErrorInfo(
          response.status,
          serverCode,
          serverMessage,
        );

        // Tuyệt đối không mở checkout drawer khi API thất bại
        resetHoldState();
        setHoldErrorMessage(info.message);
        if (info.action === "LOGIN") {
          router.push(`/auth?redirect=${encodeURIComponent(pathname)}`);
        }
        return;
      }

      const json = await response.json();
      const data = json?.success ? json.data : null;
      if (!data?.orderId || !data?.orderCode) {
        throw new Error(
          json?.error?.message || "Không thể khởi tạo phiên giữ chỗ vé.",
        );
      }

      const expiresMs = data.holdExpiresAt
        ? Date.parse(data.holdExpiresAt)
        : Number.NaN;
      const remaining = Number.isFinite(expiresMs)
        ? computeRemainingSeconds(expiresMs, nowMs())
        : Number(data.remainingSeconds) || 0;
      if (remaining <= 0) {
        throw new Error("Phiên giữ chỗ đã hết hạn ngay khi khởi tạo.");
      }

      setHoldOrderId(data.orderId);
      setHoldOrderCode(data.orderCode);
      setHoldExpiresAtMs(
        Number.isFinite(expiresMs) ? expiresMs : nowMs() + remaining * 1000,
      );
      setHoldSecondsLeft(remaining);
      setHoldTotalAmount(
        typeof data.totalAmount === "number" ? data.totalAmount : null,
      );
      setAllocatedSeats(data.allocatedSeats || []);
      setSelectedListing(listing);
      setHoldErrorMessage(null);
    } catch (err: unknown) {
      resetHoldState();
      setHoldErrorMessage(
        err instanceof Error
          ? err.message
          : "Đã xảy ra lỗi khi kết nối tới máy chủ giữ chỗ.",
      );
    } finally {
      setIsHoldingTicket(false);
    }
  };

  const handleCancelHold = async () => {
    const currentOrderId = holdOrderId;

    // Đóng drawer ngay để người dùng không thao tác tiếp trên phiên đã hủy
    resetHoldState();
    setHoldErrorMessage(null);

    // Gọi API release hold để giải phóng ghế; báo lỗi thật nếu không nhả được
    if (currentOrderId) {
      try {
        const token = getAccessToken();
        const res = await fetch("/api/v1/booking/release", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ orderId: currentOrderId }),
        });
        if (!res.ok) {
          setHoldErrorMessage(
            "Chưa hủy được giữ chỗ trên máy chủ. Ghế sẽ tự được trả lại sau tối đa 5 phút.",
          );
        }
      } catch {
        setHoldErrorMessage(
          "Mất kết nối khi hủy giữ chỗ. Ghế sẽ tự được trả lại sau tối đa 5 phút.",
        );
      }
    }
  };

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-32px)] bg-white overflow-hidden text-[#141d23]">
      {/* 1. Clean Top Header Bar */}
      <header className="h-[64px] border-b border-[#dfe3e5] bg-white px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 z-30">
        {/* Left: Event thumbnail + Title + Date & Venue */}
        <div className="flex items-center gap-3.5 min-w-0">
          <Link
            href="/"
            className="size-11 rounded-[8px] overflow-hidden bg-[#eff1f2] shrink-0 border border-[#dfe3e5] hover:opacity-90 transition-opacity"
            title="Về trang chủ"
          >
            <Image
              src={event.image}
              alt={event.title}
              width={44}
              height={44}
              unoptimized
              className="w-full h-full object-cover"
            />
          </Link>

          <div className="min-w-0">
            <h1 className="text-[15px] sm:text-[16px] font-bold text-[#141d23] truncate leading-tight">
              {event.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-[#606970] truncate pt-0.5">
              <span>{event.fullDateTime}</span>
              <span className="hidden sm:inline text-[#cbd5e1]">•</span>
              <span className="hidden sm:inline truncate text-[#868f97]">
                {event.venue}, {event.city}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsSaved(!isSaved)}
            aria-label={isSaved ? "Bỏ lưu sự kiện" : "Lưu vào yêu thích"}
            className="size-8 rounded-full border border-[#dfe3e5] hover:bg-[#f5f7f8] flex items-center justify-center text-[#141d23] transition-colors ml-1 shrink-0"
          >
            <Heart
              className={`size-4 ${
                isSaved ? "fill-primary text-primary" : "text-[#606970]"
              }`}
            />
          </button>
        </div>

        {/* Center: Global Search Bar */}
        <div className="hidden md:flex flex-1 max-w-md mx-4">
          <div className="w-full h-10 px-4 rounded-full bg-[#f5f7f8] border border-[#dfe3e5] text-[13px] text-[#606970] flex items-center gap-2.5 focus-within:border-primary focus-within:bg-white transition-all">
            <Search className="size-4 text-[#868f97] shrink-0" />
            <input
              type="text"
              placeholder="Tìm kiếm sự kiện, nghệ sĩ, địa điểm..."
              className="w-full bg-transparent border-none outline-none text-[#141d23] placeholder:text-[#868f97]"
            />
          </div>
        </div>

        {/* Right: Region + Links + User Profile */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-[13px] font-medium text-[#141d23]">
          <div className="hidden lg:flex items-center gap-1 text-[#606970] hover:text-[#141d23] cursor-pointer">
            <span>VND | VI</span>
            <ChevronDown className="size-3.5" />
          </div>

          {isAdmin && (
            <Link
              href="/admin"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 border border-rose-200 text-rose-700 font-semibold text-xs hover:bg-rose-100 transition-colors"
            >
              <ShieldCheck className="size-3.5" />
              <span>Cổng Quản trị</span>
            </Link>
          )}

          {isOrganizer && (
            <>
              <Link
                href="/organizer/events"
                className="hidden sm:inline-block hover:text-primary transition-colors text-[13px]"
              >
                Quản lý sự kiện
              </Link>
              <Link
                href="/organizer/events/new"
                className="hidden sm:inline-flex items-center gap-1 text-emerald-600 font-semibold hover:text-emerald-700 transition-colors text-[13px]"
              >
                <span>Tạo sự kiện</span>
              </Link>
            </>
          )}

          {(!user || user.role === "BUYER") && (
            <>
              <Link
                href="/register?role=ORGANIZER"
                className="hidden sm:inline-block hover:text-primary transition-colors text-[13px]"
              >
                Bán vé
              </Link>
              <Link
                href="/my-tickets"
                className="hover:text-primary transition-colors text-[13px]"
              >
                Vé của tôi
              </Link>
            </>
          )}

          {/* Auth State */}
          {!user ? (
            <>
              <Link
                href="/auth"
                className="hidden sm:inline-block hover:text-primary transition-colors text-[13px]"
              >
                Đăng nhập
              </Link>
              <Link
                href="/auth"
                aria-label="Đăng nhập"
                className="size-8 rounded-full bg-[#eff1f2] hover:bg-emerald-50 hover:text-primary flex items-center justify-center text-[#141d23] transition-colors shrink-0"
              >
                <User className="size-4 fill-current" />
              </Link>
            </>
          ) : (
            <Link
              href={
                isAdmin
                  ? "/admin"
                  : isOrganizer
                    ? "/organizer/events"
                    : "/my-tickets"
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-[#141d23] transition-colors"
            >
              <div className="size-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center">
                {user.fullName ? user.fullName.charAt(0).toUpperCase() : "U"}
              </div>
              <span className="max-w-[100px] truncate">
                {user.fullName || user.email}
              </span>
            </Link>
          )}
        </div>
      </header>

      {/* 2. Slim Urgency Strip */}
      <div className="h-[32px] bg-[#fdf2f4] border-b border-[#fee2e2] px-4 sm:px-6 flex items-center justify-center text-center gap-2 text-[12px] text-[#991b1b] font-medium shrink-0">
        <Flame className="size-3.5 text-[#e11d48] shrink-0" />
        <span>
          Sắp hết vé! Hơn 70 người đang xem sự kiện này trong 1 giờ qua
        </span>
      </div>

      {/* 3. Full-Height Split Screen Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* LEFT PANE: Interactive Architectural Stadium/Arena SVG Map */}
        <div className="w-full lg:w-[58%] xl:w-[62%] h-[42vh] lg:h-full relative border-b lg:border-b-0 lg:border-r border-[#dfe3e5] bg-[#f8fafc] flex flex-col">
          {/* Active section filter badge if selected */}
          {activeZoneId && (
            <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-white px-3 py-1.5 rounded-[8px] border border-[#dfe3e5] shadow-xs text-[12px]">
              <span className="text-[#606970]">Đang lọc:</span>
              <strong className="text-primary font-bold">
                {zoneInfoMap[activeZoneId]?.name || `Khu ${activeZoneId}`}
              </strong>
              <button
                type="button"
                onClick={() => setActiveZoneId(null)}
                aria-label="Xóa bộ lọc khu vực"
                className="size-5 rounded-full hover:bg-[#eff1f2] flex items-center justify-center text-[#606970]"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {/* SeatMap Canvas */}
          <div className="flex-1 w-full h-full">
            <SeatMap
              mapKey={mapKey}
              activeZoneId={activeZoneId}
              hoveredZoneId={hoveredZoneId}
              zoneInfoMap={zoneInfoMap}
              onSelectZone={(zid) => setActiveZoneId(zid)}
              onHoverZone={(zid) => setHoveredZoneId(zid)}
            />
          </div>
        </div>

        {/* RIGHT PANE: Filter Bar + Scrollable Ticket Listings */}
        <div className="w-full lg:w-[42%] xl:w-[38%] h-[58vh] lg:h-full flex flex-col bg-white overflow-hidden">
          {/* Top Filter Bar inside right pane */}
          <div className="px-4 py-3 border-b border-[#dfe3e5] bg-white flex items-center justify-between gap-3 shrink-0">
            <div className="text-[12.5px] text-[#606970] font-medium">
              {activeZoneId ? (
                <span>
                  Đang xem:{" "}
                  <strong className="text-[#141d23]">
                    {zoneInfoMap[activeZoneId]?.name || `Khu ${activeZoneId}`}
                  </strong>
                </span>
              ) : (
                <span>Tất cả các khu vực</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="size-9 rounded-[8px] border border-[#dfe3e5] hover:border-[#868f97] flex items-center justify-center text-[#141d23] transition-colors"
                aria-label="Bộ lọc tìm kiếm vé"
              >
                <SlidersHorizontal className="size-4" />
              </button>

              {/* Ticket Quantity Dropdown Button */}
              <button
                type="button"
                onClick={() => setShowQtyModal(true)}
                className="h-9 px-3.5 rounded-[8px] border border-[#dfe3e5] hover:border-primary hover:bg-emerald-50/40 text-[13px] font-bold text-[#141d23] flex items-center gap-2 transition-colors"
              >
                <Users className="size-4 text-primary" />
                <span>{ticketQuantity} vé</span>
                <ChevronDown className="size-3.5 text-[#606970]" />
              </button>
            </div>
          </div>

          {/* Error Message Banner */}
          {holdErrorMessage && (
            <div className="m-3 sm:m-4 p-3 rounded-[8px] bg-destructive/10 border border-destructive/30 text-destructive text-[12.5px] flex items-start justify-between gap-2.5 animate-in fade-in duration-150 shrink-0">
              <div className="flex items-start gap-2">
                <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-destructive">
                    Không thể giữ chỗ
                  </div>
                  <div className="text-[12px] text-destructive leading-snug">
                    {holdErrorMessage}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHoldErrorMessage(null)}
                aria-label="Đóng thông báo lỗi"
                className="text-destructive/70 hover:text-destructive shrink-0 p-0.5"
              >
                <X className="size-4" />
              </button>
            </div>
          )}

          {/* Scrollable Ticket Listings */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#dfe3e5]">
            {filteredListings.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <h3 className="text-[15px] font-bold text-[#141d23]">
                  Khu vực đã chọn hiện chưa có vé phù hợp
                </h3>
                <p className="text-[13px] text-[#606970] max-w-xs mx-auto">
                  Khu vực này hiện đã bán hết hoặc không đủ số lượng vé bạn
                  chọn. Quý khách vui lòng chọn các khu vực khác.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveZoneId(null)}
                  className="px-4 py-2 rounded-[8px] bg-primary text-white text-[13px] font-bold hover:bg-emerald-700 transition-colors"
                >
                  Xem tất cả các khu vực
                </button>
              </div>
            ) : (
              filteredListings.map((listing) => {
                const isHovered = hoveredZoneId === listing.zoneId;
                const isSelected = selectedListing?.id === listing.id;
                const isAvailable = listing.availableTickets >= ticketQuantity;

                return (
                  <div
                    key={listing.id}
                    onMouseEnter={() => setHoveredZoneId(listing.zoneId)}
                    onMouseLeave={() => setHoveredZoneId(null)}
                    onClick={() => {
                      if (!isAvailable) {
                        setHoldErrorMessage(
                          `Hạng vé ${listing.section} chỉ còn ${listing.availableTickets} vé, không đủ cho yêu cầu ${ticketQuantity} vé của bạn. Vui lòng giảm số lượng vé hoặc chọn hạng vé khác.`,
                        );
                        return;
                      }
                      handleStartHold(listing);
                    }}
                    className={`p-3.5 sm:p-4 transition-colors flex gap-3.5 sm:gap-4 items-start ${
                      !isAvailable
                        ? "bg-muted opacity-60 cursor-not-allowed border-l-4 border-l-border"
                        : isSelected
                          ? "bg-emerald-50/70 border-l-4 border-l-primary cursor-pointer"
                          : isHovered
                            ? "bg-muted cursor-pointer"
                            : "hover:bg-muted cursor-pointer"
                    }`}
                  >
                    {/* Left: Clean Thumbnail Stage Photo */}
                    <div className="w-[110px] sm:w-[124px] aspect-[16/10] rounded-[8px] overflow-hidden bg-[#eff1f2] shrink-0 border border-[#dfe3e5]">
                      <Image
                        src={listing.viewFromSeatUrl}
                        alt={listing.section}
                        width={124}
                        height={78}
                        unoptimized
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Middle: Clean details with small metadata icons */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-[14px] sm:text-[15px] font-bold text-foreground leading-snug">
                          {listing.section}
                        </h2>
                        {!isAvailable && (
                          <span className="px-2 py-0.5 rounded-[4px] bg-destructive/10 text-destructive text-[10.5px] font-bold">
                            Chỉ còn {listing.availableTickets} vé
                          </span>
                        )}
                      </div>

                      {listing.row && (
                        <div className="text-[12px] text-[#606970]">
                          {listing.row}
                        </div>
                      )}

                      <div className="space-y-0.5 pt-0.5 text-[11.5px] text-[#606970]">
                        <div className="flex items-center gap-1.5">
                          <Users className="size-3.5 text-[#606970] shrink-0" />
                          <span>
                            {listing.isStanding
                              ? `${ticketQuantity} vé đứng tự do`
                              : `${ticketQuantity} vé ngồi cạnh nhau`}
                          </span>
                        </div>

                        {listing.section.toLowerCase().includes("vip") && (
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="size-3.5 text-amber-600 shrink-0" />
                            <span>Gói quyền lợi VIP &amp; Lối vào ưu tiên</span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5">
                          <Eye className="size-3.5 text-[#606970] shrink-0" />
                          <span>Tầm nhìn trực diện</span>
                        </div>

                        {listing.isLastTickets && isAvailable && (
                          <div className="pt-0.5">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] border border-[#fecaca] text-[10.5px] font-bold">
                              <Flame className="size-3 text-[#dc2626]" />
                              Sắp hết vé
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Price & Deal Score Badge */}
                    <div className="text-right shrink-0 flex flex-col items-end">
                      <div className="text-[16px] sm:text-[17px] font-extrabold text-foreground leading-tight">
                        {formatVnd(listing.price)}
                      </div>
                      {!isAvailable && (
                        <div className="text-[11px] text-destructive font-semibold pt-0.5">
                          Không đủ {ticketQuantity} vé
                        </div>
                      )}
                      {listing.originalPrice &&
                        listing.originalPrice > listing.price && (
                          <div className="text-[11px] text-[#606970] line-through">
                            {formatVnd(listing.originalPrice)}
                          </div>
                        )}

                      {/* Clean Deal Score: solid green square + green text, unboxed */}
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="size-5 rounded-[4px] bg-[#059669] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                          {listing.dealScore}
                        </span>
                        <span className="text-[12px] font-bold text-[#059669]">
                          {listing.dealLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 4. "Bạn cần bao nhiêu vé?" Minimalist Popup Modal */}
      {showQtyModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="w-full max-w-[360px] bg-background rounded-[20px] shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-150 relative">
            {/* Close button */}
            <button
              type="button"
              onClick={() => setShowQtyModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full text-[#606970] hover:text-[#141d23] hover:bg-[#f5f7f8] transition-colors"
            >
              <X className="size-5" />
            </button>

            <div className="text-center space-y-1 pt-1">
              <h2 className="text-[20px] font-extrabold text-[#141d23]">
                Bạn cần bao nhiêu vé?
              </h2>
              <p className="text-[13px] text-[#606970]">
                Các ghế ngồi sẽ được xếp cạnh nhau
              </p>
            </div>

            {/* Ticket Quantity Grid: 1 to 6 (UC04 limit) */}
            <div className="grid grid-cols-3 gap-3 pt-1">
              {[1, 2, 3, 4, 5, 6].map((qty) => {
                const isSelected = ticketQuantity === qty;
                return (
                  <button
                    key={qty}
                    type="button"
                    onClick={() => setTicketQuantity(qty)}
                    className={`h-14 rounded-[12px] border text-[20px] font-extrabold transition-all flex items-center justify-center ${
                      isSelected
                        ? "border-primary bg-primary text-white shadow-xs"
                        : "border-[#dfe3e5] bg-white text-[#141d23] hover:border-primary hover:bg-[#f8fafc]"
                    }`}
                  >
                    {qty}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setShowQtyModal(false)}
              className="w-full h-11 rounded-[10px] bg-primary hover:bg-emerald-700 text-white font-bold text-[14px] transition-colors shadow-xs"
            >
              Tiếp tục
            </button>
          </div>
        </div>
      )}

      {/* 5. Selected Ticket & 5-Minute Hold Checkout Drawer */}
      {selectedListing && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg bg-white rounded-t-[20px] sm:rounded-[16px] shadow-2xl p-5 sm:p-6 space-y-5 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-[#dfe3e5] pb-3.5">
              <div>
                <span className="text-[11px] font-bold text-primary uppercase tracking-wider">
                  Xác nhận đặt vé
                </span>
                <h2 className="text-[18px] font-extrabold text-[#141d23]">
                  {selectedListing.section}
                </h2>
              </div>
              <button
                type="button"
                onClick={handleCancelHold}
                aria-label="Đóng cửa sổ đặt vé"
                className="size-8 rounded-full hover:bg-[#eff1f2] flex items-center justify-center text-[#606970]"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* 5-Minute Hold Notice Banner */}
            {holdSecondsLeft !== null && holdSecondsLeft > 0 && (
              <div className="rounded-[10px] bg-emerald-50 border border-emerald-200 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-primary font-bold text-[13px]">
                    <Timer className="size-4.5" />
                    <span>Đang giữ chỗ • Mã {holdOrderCode}</span>
                  </div>
                  <span className="font-mono text-[16px] font-extrabold text-primary">
                    {formatCountdown(holdSecondsLeft)}
                  </span>
                </div>
                {allocatedSeats.length > 0 && (
                  <div className="text-[12px] font-medium text-emerald-800 border-t border-emerald-200/60 pt-1.5 flex items-center justify-between">
                    <span>Vị trí ghế đã cấp tự động:</span>
                    <span className="font-mono font-bold">
                      Hàng {allocatedSeats[0]?.rowLabel} - Ghế{" "}
                      {allocatedSeats.map((s) => s.seatNumber).join(", ")}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* View From Seat preview */}
            <div className="rounded-[10px] overflow-hidden border border-[#dfe3e5] bg-[#141d23] aspect-[16/9] relative">
              <Image
                src={selectedListing.viewFromSeatUrl}
                alt="Góc nhìn thực tế từ chỗ ngồi"
                fill
                unoptimized
                className="object-cover"
              />
              <span className="absolute bottom-2 left-2 px-2 py-1 rounded-[6px] bg-black/75 text-white text-[11px] font-semibold">
                Góc nhìn thực tế sân khấu từ {selectedListing.section}
              </span>
            </div>

            {/* Seated Together Reassurance Note */}
            <div className="flex items-center gap-2 p-2.5 rounded-[8px] bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12px] font-semibold">
              <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
              <span>
                {selectedListing.isStanding
                  ? "Vé đứng tự do khu vực fanzone / sân khấu"
                  : "Các ghế ngồi sẽ được xếp cạnh nhau"}
              </span>
            </div>

            {/* Ticket details summary */}
            <div className="bg-[#f8fafc] rounded-[10px] border border-[#dfe3e5] p-3.5 space-y-2 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-[#606970]">Khu vực &amp; Vị trí:</span>
                <span className="font-bold text-[#141d23]">
                  {selectedListing.zoneName}{" "}
                  {selectedListing.row ? `• ${selectedListing.row}` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#606970]">Số lượng vé:</span>
                <span className="font-bold text-[#141d23]">
                  {ticketQuantity} vé
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#606970]">Đơn giá:</span>
                <span className="font-semibold text-foreground">
                  {formatVnd(selectedListing.price)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-[#dfe3e5] pt-2">
                <span className="font-bold text-[#141d23]">Tổng cộng:</span>
                <span className="text-[18px] font-extrabold text-primary">
                  {formatVnd(
                    holdTotalAmount ?? selectedListing.price * ticketQuantity,
                  )}
                </span>
              </div>
            </div>

            {/* Buyer Protection Guarantee */}
            <div className="flex items-center gap-2 text-[12px] text-[#606970]">
              <ShieldCheck className="size-4 text-primary shrink-0" />
              <span>Cam kết vé chính thức 100% • Quét mã QR vào cổng</span>
            </div>

            {/* Action Buttons */}
            {cannotBuyTickets ? (
              <div className="rounded-[10px] bg-amber-50 border border-amber-200 p-3.5 space-y-2 mt-2">
                <div className="flex items-center gap-2 text-amber-800 font-bold text-[13px]">
                  <ShieldCheck className="size-4.5 text-amber-600 shrink-0" />
                  <span>
                    {isAdmin
                      ? "Tài khoản Quản trị viên không thể mua vé sự kiện."
                      : "Tài khoản Ban tổ chức không thể mua vé sự kiện."}
                  </span>
                </div>
                <p className="text-[12px] text-amber-700 leading-relaxed">
                  {isAdmin
                    ? "Nhằm ngăn ngừa xung đột lợi ích, tài khoản Admin không tham gia luồng thanh toán mua vé."
                    : "Nhằm tuân thủ quy chuẩn chống găm vé nội bộ và gian lận thanh toán, vui lòng sử dụng tài khoản Người mua (Buyer) để đặt vé."}
                </p>
                <div className="space-y-1.5 pt-1">
                  <Link
                    href={isAdmin ? "/admin" : "/organizer/events"}
                    className="inline-flex items-center justify-center w-full h-10 rounded-[8px] bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-bold transition-colors"
                  >
                    {isAdmin ? "Về Cổng Quản trị" : "Về Quản lý sự kiện"}
                  </Link>
                  <button
                    type="button"
                    onClick={handleCancelHold}
                    className="w-full h-8 rounded-[8px] border border-amber-200 bg-white hover:bg-amber-100/50 text-[12px] font-semibold text-amber-800 transition-colors cursor-pointer"
                  >
                    Hủy xem chỗ này
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowSubtotalModal(true)}
                  className="w-full h-11 rounded-[10px] bg-primary hover:bg-emerald-700 text-white text-[14px] font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="size-4.5" />
                  Thanh toán qua VNPay &amp; Nhận vé QR
                </button>
                <button
                  type="button"
                  onClick={handleCancelHold}
                  className="w-full h-9 rounded-[8px] border border-border bg-background hover:bg-muted text-[12px] font-semibold text-muted-foreground transition-colors cursor-pointer"
                >
                  Hủy giữ chỗ &amp; chọn khu vực khác
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. Subtotal Confirmation Modal before Checkout */}
      {showSubtotalModal && selectedListing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="subtotal-dialog-title"
          className="fixed inset-0 z-50 bg-foreground/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setShowSubtotalModal(false)}
        >
          <div
            className="w-full max-w-[460px] bg-background rounded-[16px] shadow-2xl border border-border p-5 sm:p-6 space-y-5 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-border pb-3.5">
              <div>
                <h3
                  id="subtotal-dialog-title"
                  className="text-[17px] sm:text-[18px] font-extrabold text-foreground"
                >
                  Xác nhận tạm tính đơn hàng
                </h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Vui lòng kiểm tra lại thông tin vé trước khi chuyển sang cổng
                  thanh toán
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubtotalModal(false)}
                className="size-8 rounded-[8px] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                aria-label="Đóng hộp thoại"
              >
                <X className="size-4.5" />
              </button>
            </div>

            {/* Event & Ticket Details */}
            <div className="rounded-[10px] bg-muted border border-border p-3.5 space-y-2.5 text-[13px]">
              <div className="font-bold text-foreground text-[14px] line-clamp-1">
                {event.title}
              </div>
              <div className="flex items-center justify-between text-muted-foreground text-[12.5px]">
                <span>Khu vực khán đài:</span>
                <span className="font-semibold text-foreground">
                  {selectedListing.zoneName}
                  {selectedListing.row ? ` • ${selectedListing.row}` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground text-[12.5px]">
                <span>Số lượng đặt:</span>
                <span className="font-semibold text-foreground">
                  {ticketQuantity} vé
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground text-[12.5px]">
                <span>Đơn giá mỗi vé:</span>
                <span className="font-semibold text-foreground">
                  {formatVnd(selectedListing.price)}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground text-[12.5px]">
                <span>Phí dịch vụ &amp; nền tảng:</span>
                <span className="font-semibold text-emerald-600">
                  Miễn phí (0đ)
                </span>
              </div>
              <div className="border-t border-border pt-2 flex items-center justify-between">
                <span className="font-extrabold text-foreground text-[14px]">
                  Tạm tính tổng cộng:
                </span>
                <span className="text-[20px] font-black text-primary">
                  {formatVnd(
                    holdTotalAmount ?? selectedListing.price * ticketQuantity,
                  )}
                </span>
              </div>
            </div>

            {/* Trust badge */}
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground bg-emerald-50/70 border border-emerald-100 rounded-[8px] p-2.5">
              <ShieldCheck className="size-4 text-primary shrink-0" />
              <span>
                Thanh toán VNPay sẽ được bổ sung ở giai đoạn sau (UC05).
              </span>
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled
                className="w-full h-11 rounded-[10px] bg-primary/40 text-white text-[14px] font-bold flex items-center justify-center gap-2 cursor-not-allowed"
              >
                <CheckCircle2 className="size-4.5" />
                Thanh toán VNPay (sắp ra mắt)
              </button>
              <button
                type="button"
                onClick={() => setShowSubtotalModal(false)}
                className="w-full h-9 rounded-[8px] border border-border bg-background hover:bg-muted text-[12.5px] font-semibold text-muted-foreground transition-colors cursor-pointer"
              >
                Quay lại xem lại
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
