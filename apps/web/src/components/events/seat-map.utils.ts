/**
 * Utility functions for SeatMap and Minimap calculations (UC04)
 */

export interface MapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapPanParams {
  pan: { x: number; y: number };
  zoom: number;
  containerWidth: number;
  containerHeight: number;
  svgWidth: number;
  svgHeight: number;
  viewBox: string;
}

/** Fit the SVG viewBox into a box using the browser's xMidYMid meet behavior. */
export function fitMapRect(
  boxWidth: number,
  boxHeight: number,
  viewBox: string,
): MapRect {
  const parsed = parseViewBox(viewBox);
  if (
    !Number.isFinite(boxWidth) ||
    !Number.isFinite(boxHeight) ||
    boxWidth <= 0 ||
    boxHeight <= 0 ||
    parsed.width <= 0 ||
    parsed.height <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const scale = Math.min(boxWidth / parsed.width, boxHeight / parsed.height);
  const width = parsed.width * scale;
  const height = parsed.height * scale;
  return {
    x: (boxWidth - width) / 2,
    y: (boxHeight - height) / 2,
    width,
    height,
  };
}

/** Keep the transformed map within the visible canvas instead of exposing blank space. */
export function clampPanToMap({
  pan,
  zoom,
  containerWidth,
  containerHeight,
  svgWidth,
  svgHeight,
  viewBox,
}: MapPanParams): { x: number; y: number } {
  const canvasMap = fitMapRect(svgWidth, svgHeight, viewBox);
  if (!canvasMap.width || !canvasMap.height) return pan;

  const safeZoom = Math.max(0.1, Number.isFinite(zoom) ? zoom : 1);
  const maxX = Math.max(0, (canvasMap.width * safeZoom - containerWidth) / 2);
  const maxY = Math.max(0, (canvasMap.height * safeZoom - containerHeight) / 2);
  const clampAxis = (value: number, max: number) => {
    const clamped = Math.min(max, Math.max(-max, value));
    return Object.is(clamped, -0) ? 0 : clamped;
  };
  return {
    x: clampAxis(pan.x, maxX),
    y: clampAxis(pan.y, maxY),
  };
}

/** Parses SVG viewBox string "minX minY width height" into numeric components. */
export function parseViewBox(viewBox: string): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    return { minX: 0, minY: 0, width: 0, height: 0 };
  }

  const [minX, minY, width, height] = parts;
  return {
    minX,
    minY,
    width: width > 0 ? width : 0,
    height: height > 0 ? height : 0,
  };
}

/**
 * Validates ticket quantity according to UC04 specs (1 to 6 tickets per order)
 */
export function isValidTicketQuantity(qty: number): boolean {
  return Number.isInteger(qty) && qty >= 1 && qty <= 6;
}

/**
 * Evaluates whether a zone has enough tickets for the required quantity
 */
export function isZoneAvailable(
  zoneInfo?: { count: number } | null,
  requiredQty = 1,
): boolean {
  if (!zoneInfo) return false;
  return zoneInfo.count >= requiredQty;
}

/**
 * Calculates subtotal for ticket checkout order (W03-FE2)
 */
export function calculateOrderSubtotal(
  unitPrice: number,
  quantity: number,
): number {
  if (
    !Number.isFinite(unitPrice) ||
    !Number.isFinite(quantity) ||
    unitPrice <= 0 ||
    quantity <= 0
  ) {
    return 0;
  }
  return Math.round(unitPrice * quantity);
}

/** Đồng hồ hệ thống tách riêng để component không gọi Date.now trực tiếp (React purity). */
export function nowMs(): number {
  return Date.now();
}

/**
 * Giây còn lại của phiên giữ chỗ, tính theo holdExpiresAt của server (UC04-E2).
 * Làm tròn lên để đồng hồ không về 0 sớm; không bao giờ âm.
 */
export function computeRemainingSeconds(
  expiresAtMs: number,
  nowMs: number,
): number {
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
}

export interface HoldErrorInfo {
  message: string;
  action: "LOGIN" | "REFRESH" | "RETRY" | "NONE";
}

/**
 * Ánh xạ lỗi API giữ chỗ theo mã HTTP/mã lỗi sang thông điệp + hành động (UC04-E1, E5, E6, E7).
 */
export function getHoldErrorInfo(
  status: number,
  code?: string,
  serverMessage?: string,
): HoldErrorInfo {
  switch (status) {
    case 401:
      return {
        message:
          "Vui lòng đăng nhập tài khoản Người mua (Buyer) để giữ chỗ và thanh toán vé.",
        action: "LOGIN",
      };
    case 403:
      return {
        message:
          serverMessage ??
          "Tài khoản của bạn không có quyền thực hiện thao tác này.",
        action: "NONE",
      };
    case 404:
      return {
        message: serverMessage ?? "Không tìm thấy sự kiện hoặc hạng vé.",
        action: "REFRESH",
      };
    case 409:
      return {
        message:
          "Vé hoặc ghế vừa được người khác giữ hoặc mua. Vui lòng chọn lại.",
        action: "REFRESH",
      };
    case 422:
      return {
        message:
          serverMessage ??
          "Yêu cầu vi phạm quy định đặt vé (tối đa 6 vé/đơn, mỗi sự kiện 1 phiên giữ chỗ).",
        action: "NONE",
      };
    case 429:
      return {
        message: "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít giây.",
        action: "RETRY",
      };
    case 503:
      return {
        message: "Hệ thống đang bận, vui lòng thử lại sau.",
        action: "RETRY",
      };
    default:
      return {
        message:
          serverMessage ??
          "Không thể thực hiện giữ chỗ vé lúc này. Vui lòng thử lại sau.",
        action: "NONE",
      };
  }
}
