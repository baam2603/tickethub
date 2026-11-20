export interface CheckoutOrderItem {
  ticketTypeId: string;
  ticketTypeName?: string;
  zoneName?: string;
  quantity: number;
  unitPrice?: number;
  seats?: string[];
  isStanding?: boolean;
}

export interface CheckoutOrder {
  orderId: string;
  orderCode?: string;
  status: string;
  totalAmount: number;
  finalAmount: number;
  discountAmount: number;
  voucherCode?: string | null;
  expiresAt: string;
  items: CheckoutOrderItem[];
  eventId?: string;
  eventTitle?: string;
  eventVenue?: string;
  eventDateTime?: string;
}

/** Don hang mau dung khi chua co orderId hoac khong tai duoc tu backend. */
export const DEFAULT_ORDER: CheckoutOrder = {
  orderId: "ord-sample-01",
  orderCode: "ORD-20261103-MUATHU",
  status: "PENDING",
  totalAmount: 5000000,
  finalAmount: 5000000,
  discountAmount: 0,
  expiresAt: new Date(Date.now() + 300 * 1000).toISOString(),
  items: [
    {
      ticketTypeId: "34e9dcbc-3184-4f12-9777-da70b8b6001f",
      ticketTypeName: "Khu VIP A",
      zoneName: "Khu VIP A",
      quantity: 2,
      unitPrice: 2500000,
      seats: ["Hàng A - Ghế 01", "Hàng A - Ghế 02"],
      isStanding: false,
    },
  ],
  eventId: "e742fd19-f438-4ae8-9f75-f8d9ca26433b",
  eventTitle: "Liveshow Âm Nhạc Mùa Thu 2026",
  eventVenue: "Trung tâm Hội nghị Quốc gia, Hà Nội",
  eventDateTime: "20:00 - Thứ Hai, 16/11/2026",
};

/** Phan hoi don hang tu backend (nhieu truong co the thieu hoac khac ten). */
export interface RawOrderItem {
  ticketTypeId?: string;
  ticketType?: {
    id?: string;
    name?: string;
    price?: number | string;
    isSeated?: boolean;
  };
  ticketTypeName?: string;
  zoneName?: string;
  seat?: { rowLabel?: string; seatNumber?: string; zoneName?: string } | null;
  seats?: string[];
  quantity?: number;
  unitPrice?: number | string;
  price?: number | string;
  isStanding?: boolean;
}

export interface RawOrder {
  id?: string;
  orderId?: string;
  orderCode?: string;
  status?: string;
  totalAmount?: number | string;
  finalAmount?: number | string;
  discountAmount?: number | string;
  voucherCode?: string | null;
  expiresAt?: string;
  items?: RawOrderItem[];
  eventId?: string;
  eventTitle?: string;
  eventVenue?: string;
  eventDateTime?: string;
  event?: {
    id?: string;
    title?: string;
    venueName?: string;
    venueAddress?: string;
    city?: string;
    startTime?: string;
  };
}

/** Gop cac dong don hang theo hang ve va doi sang don hang hien thi o trang thanh toan. */
export function mapOrderResponse(
  raw: RawOrder,
  orderId: string,
  now: number,
): CheckoutOrder {
  const itemMap = new Map<string, Required<CheckoutOrderItem>>();

  if (Array.isArray(raw.items)) {
    for (const it of raw.items) {
      const tid = it.ticketTypeId || it.ticketType?.id || "default";
      const existing = itemMap.get(tid);
      const seatLabel = it.seat
        ? `Hàng ${it.seat.rowLabel} - Ghế ${it.seat.seatNumber}`
        : undefined;
      const isStanding =
        it.isStanding ?? (it.ticketType ? !it.ticketType.isSeated : !seatLabel);
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

  const id = raw.id || raw.orderId || orderId;
  return {
    orderId: id,
    orderCode:
      raw.orderCode || `ORD-${(raw.id || orderId).slice(0, 8).toUpperCase()}`,
    status: raw.status || "PENDING",
    totalAmount: Number(raw.totalAmount) || 0,
    finalAmount: Number(raw.finalAmount ?? raw.totalAmount) || 0,
    discountAmount: Number(raw.discountAmount) || 0,
    voucherCode: raw.voucherCode ?? null,
    expiresAt: raw.expiresAt
      ? new Date(raw.expiresAt).toISOString()
      : new Date(now + 300 * 1000).toISOString(),
    items:
      itemMap.size > 0 ? Array.from(itemMap.values()) : DEFAULT_ORDER.items,
    eventId: raw.eventId || raw.event?.id,
    eventTitle: raw.eventTitle || raw.event?.title || DEFAULT_ORDER.eventTitle,
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
}

/** So giay con lai den luc het han (khong am), tinh theo han giu cua server. */
export function secondsUntil(expiresAtIso: string, now: number): number {
  const expireTime = new Date(expiresAtIso).getTime();
  return Math.max(0, Math.floor((expireTime - now) / 1000));
}

/** Dinh dang so giay thanh MM:SS cho dong ho giu cho 5 phut. */
export function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Thong bao cho nguoi dung khi tao thanh toan that bai, theo ma trang thai HTTP
 * (0 = khong ket noi duoc may chu). Khong hien thi thong diep tho tu backend.
 */
export function paymentFailureMessage(status: number | undefined): string {
  switch (status) {
    case 0:
      return "Không kết nối được máy chủ thanh toán. Vui lòng kiểm tra mạng và thử lại.";
    case 401:
      return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để thanh toán.";
    case 403:
      return "Tài khoản của bạn không có quyền thanh toán đơn hàng này.";
    case 404:
      return "Không tìm thấy đơn hàng. Vui lòng quay lại trang đặt vé và chọn vé lại.";
    case 409:
      return "Đơn hàng đã hết hạn giữ chỗ hoặc không còn ở trạng thái chờ thanh toán. Vui lòng đặt vé lại.";
    case 429:
      return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít giây.";
    default:
      return "Không thể tạo thanh toán lúc này. Vui lòng thử lại sau.";
  }
}

export const MISSING_PAYMENT_URL_MESSAGE =
  "Không nhận được liên kết thanh toán từ máy chủ. Vui lòng thử lại.";
