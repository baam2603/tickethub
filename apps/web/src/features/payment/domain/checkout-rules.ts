// Quy tac thanh toan o phia client: anh xa don hang, dong ho giu cho, ma giam gia, tong tien.
// Luu y: ma giam gia, phi nen tang va du lieu mau la tam thoi cho den khi backend co endpoint
// tuong ung (xem docs/ARCHITECTURE.md).

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

/** Don hang mau khi khong tai duoc don that. */
export function fallbackOrder(orderId: string | null): CheckoutOrder {
  const safeId = orderId || "ord-sample-01";
  return {
    ...DEFAULT_ORDER,
    orderId: safeId,
    orderCode: `ORD-${safeId.slice(0, 8).toUpperCase()}`,
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

/** Chuyen "Ho va ten dem Ten" thanh ten goi (phan cuoi) va ho (phan con lai). */
export function splitFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = fullName.trim().split(" ");
  if (parts.length > 1) {
    return {
      firstName: parts[parts.length - 1]!,
      lastName: parts.slice(0, parts.length - 1).join(" "),
    };
  }
  return { firstName: parts[0]!, lastName: "" };
}

/** Thong tin dien san khi chua dang nhap (du lieu mau cho phat trien). */
export const GUEST_PREFILL = {
  firstName: "Văn An",
  lastName: "Nguyễn",
  email: "nguyenvanan@gmail.com",
  phone: "0912345678",
} as const;

export type VoucherResult =
  { ok: true; code: string; discount: number } | { ok: false; error: string };

/** Kiem tra ma giam gia (tam thoi o client; backend se quyet dinh chinh thuc). */
export function evaluateVoucher(
  rawCode: string,
  totalAmount: number,
): VoucherResult {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Vui lòng nhập mã giảm giá." };
  if (code === "TICKET50K" || code === "GIAM50K") {
    return { ok: true, code, discount: 50000 };
  }
  if (code === "VIP10" || code === "TICKETHUB10") {
    return { ok: true, code, discount: Math.round(totalAmount * 0.1) };
  }
  return {
    ok: false,
    error: "Mã giảm giá không hợp lệ hoặc đã hết lượt áp dụng.",
  };
}

export const PLATFORM_FEE = 250000;

export interface CheckoutTotals {
  subtotal: number;
  platformFee: number;
  finalTotal: number;
}

/** Tam tinh, phi dich vu va tong thanh toan sau giam gia (khong am). */
export function computeTotals(
  totalAmount: number,
  voucherDiscount: number,
): CheckoutTotals {
  const subtotal = totalAmount || 3600000;
  return {
    subtotal,
    platformFee: PLATFORM_FEE,
    finalTotal: Math.max(0, subtotal + PLATFORM_FEE - voucherDiscount),
  };
}

export interface Recipient {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/** Nguoi nhan ve phai co ten, email va so dien thoai; tra ve thong bao loi hoac null. */
export function validateRecipient(r: Recipient): string | null {
  if (!r.firstName.trim() || !r.email.trim() || !r.phone.trim()) {
    return "Vui lòng điền đầy đủ họ tên, email và số điện thoại người nhận vé.";
  }
  return null;
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
