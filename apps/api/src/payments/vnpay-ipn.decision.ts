import { OrderStatus, TransactionStatus } from "@tickethub/shared";

export type IpnDecision =
  | "INVALID_SIGNATURE"
  | "ORDER_NOT_FOUND"
  | "AMOUNT_MISMATCH"
  | "ALREADY_PROCESSED"
  | "APPLY_SUCCESS"
  | "RECORD_FAILURE"
  | "REFUND_PENDING"
  | "MANUAL_REVIEW";

export interface IpnDecisionInput {
  signatureValid: boolean;
  transactionFound: boolean;
  amountMatches: boolean;
  orderStatus: OrderStatus | null;
  transactionStatus: TransactionStatus | null;
  paymentSuccessful: boolean;
  orderExpired: boolean;
}

export function decideVnpayIpn(input: IpnDecisionInput): IpnDecision {
  // Không tin bất kỳ dữ liệu nào khi chữ ký không hợp lệ.
  if (!input.signatureValid) {
    return "INVALID_SIGNATURE";
  }

  // Transaction phải được tạo từ Backend trước thanh toán.
  if (!input.transactionFound) {
    return "ORDER_NOT_FOUND";
  }

  // Amount phải được đối chiếu với PostgreSQL.
  if (!input.amountMatches) {
    return "AMOUNT_MISMATCH";
  }

  if (!input.orderStatus || !input.transactionStatus) {
    return "MANUAL_REVIEW";
  }

  // Cùng một giao dịch đã hoàn tất:
  // tuyệt đối không cập nhật hay cấp vé thêm lần nữa.
  if (
    input.orderStatus === OrderStatus.PAID &&
    input.transactionStatus === TransactionStatus.SUCCESS
  ) {
    return "ALREADY_PROCESSED";
  }

  // Các trạng thái không đồng nhất cần đối soát.
  if (
    input.orderStatus !== OrderStatus.PENDING ||
    input.transactionStatus !== TransactionStatus.PENDING
  ) {
    return "MANUAL_REVIEW";
  }

  // Khách có thể đã thanh toán sau khi ghế hết hạn.
  // Không tự cấp vé cho đơn hết hạn.
  if (input.orderExpired) {
    return "MANUAL_REVIEW";
  }

  return input.paymentSuccessful ? "APPLY_SUCCESS" : "RECORD_FAILURE";
}
