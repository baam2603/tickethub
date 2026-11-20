// Noi dung tinh cua trang Cau hoi thuong gap va chinh sach. Viet cho nguoi dung cuoi,
// khong dung thuat ngu ky thuat. Cac quy tac phai khop voi docs tren nhanh unstable.

export type LegalTabKey = "faq" | "terms" | "privacy" | "refund";

export const LEGAL_TABS: { key: LegalTabKey; label: string }[] = [
  { key: "faq", label: "Câu hỏi thường gặp" },
  { key: "terms", label: "Điều khoản sử dụng" },
  { key: "privacy", label: "Chính sách bảo mật" },
  { key: "refund", label: "Chính sách hoàn vé" },
];

export function parseLegalTab(value: string | undefined): LegalTabKey {
  return LEGAL_TABS.find((tab) => tab.key === value)?.key ?? "faq";
}

export const FAQ_CATEGORIES = [
  { id: "all", label: "Tất cả chủ đề" },
  { id: "booking", label: "Đặt vé" },
  { id: "payment", label: "Thanh toán" },
  { id: "checkin", label: "Vào cổng" },
  { id: "refund", label: "Hủy vé và hoàn tiền" },
] as const;

export interface FaqItem {
  id: string;
  category: Exclude<(typeof FAQ_CATEGORIES)[number]["id"], "all">;
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: "hold-time",
    category: "booking",
    question: "Tôi được giữ chỗ trong bao lâu?",
    answer:
      "Sau khi bạn chọn khu vực, số lượng và bấm giữ chỗ, vé được giữ cho bạn trong 5 phút để thanh toán. Hết 5 phút mà chưa thanh toán, vé sẽ tự động trả lại cho người khác. Nếu đổi ý, bạn có thể bấm Hủy giao dịch để trả vé sớm.",
  },
  {
    id: "max-tickets",
    category: "booking",
    question: "Mỗi lần mua được tối đa bao nhiêu vé?",
    answer:
      "Mỗi đơn hàng mua từ 1 đến 6 vé. Giới hạn này giúp nhiều khán giả có cơ hội mua được vé.",
  },
  {
    id: "choose-seat",
    category: "booking",
    question: "Tôi có tự chọn số ghế được không?",
    answer:
      "Không. Bạn chọn khu vực và số lượng vé, hệ thống sẽ tự xếp chỗ ngồi cho bạn, ưu tiên các ghế liền nhau trong cùng một hàng. Vị trí cụ thể được hiển thị ở bước thanh toán. Khu vực vé đứng không có số ghế.",
  },
  {
    id: "payment-methods",
    category: "payment",
    question: "Tôi có thể thanh toán bằng cách nào?",
    answer:
      "Bạn thanh toán qua VNPay bằng mã QR, thẻ ATM nội địa hoặc thẻ quốc tế Visa, Mastercard. Nếu có mã giảm giá, hãy nhập ở bước thanh toán để biết ngay số tiền được giảm.",
  },
  {
    id: "paid-no-ticket",
    category: "payment",
    question: "Tôi đã bị trừ tiền nhưng chưa thấy vé thì làm sao?",
    answer:
      "Sau khi thanh toán thành công, vé sẽ xuất hiện trong mục Vé của tôi và được gửi qua email (hãy kiểm tra cả thư rác). Nếu bạn thanh toán thành công nhưng đơn đã quá thời gian giữ chỗ, vé vẫn được cấp khi chỗ còn trống. Nếu chỗ đã có người khác đặt, bạn sẽ được hoàn lại 100% số tiền và nhận email giải thích.",
  },
  {
    id: "screenshot-qr",
    category: "checkin",
    question: "Tôi có thể dùng ảnh chụp màn hình mã QR để vào cổng không?",
    answer:
      "Không. Mã QR trên vé tự đổi mới mỗi 30 giây, nên ảnh chụp, video hay bản in sẽ không còn dùng được. Hãy mở trực tiếp vé trong mục Vé của tôi khi đến cổng.",
  },
  {
    id: "phone-problem",
    category: "checkin",
    question:
      "Điện thoại hết pin, hỏng hoặc mạng yếu thì tôi vào cổng thế nào?",
    answer:
      "Bạn nên mở sẵn vé khi còn mạng tốt và sạc đầy pin trước khi đến. Nếu vẫn không mở được vé, nhân viên tại cổng có thể tra cứu giúp bạn bằng mã vé (chuỗi 32 ký tự có trong email xác nhận) cùng 4 số cuối số điện thoại hoặc email của bạn.",
  },
  {
    id: "one-entry",
    category: "checkin",
    question: "Một vé được vào cổng mấy lần?",
    answer:
      "Mỗi vé chỉ được vào cổng một lần. Nếu vé đã được quét trước đó, nhân viên sẽ thấy thời điểm và người đã quét.",
  },
  {
    id: "refund-amount",
    category: "refund",
    question: "Hủy vé thì được hoàn bao nhiêu tiền?",
    answer:
      "Tùy chính sách hoàn vé mà ban tổ chức chọn cho từng sự kiện: Linh hoạt, Nghiêm ngặt hoặc Không hoàn vé. Mức hoàn phụ thuộc vào việc bạn hủy trước ngày diễn ra bao lâu. Chi tiết xem ở mục Chính sách hoàn vé.",
  },
  {
    id: "partial-cancel",
    category: "refund",
    question: "Tôi có thể chỉ hủy một vài vé trong đơn không?",
    answer:
      "Được. Bạn có thể chọn hủy một hoặc nhiều vé trong đơn, các vé còn lại vẫn dùng bình thường. Hệ thống cho bạn xem trước số tiền được hoàn trước khi xác nhận.",
  },
  {
    id: "event-cancelled",
    category: "refund",
    question: "Nếu sự kiện bị hủy thì sao?",
    answer:
      "Nếu sự kiện bị ban tổ chức hoặc quản trị viên hủy, bạn sẽ được hoàn tiền kể cả khi sự kiện áp dụng chính sách Không hoàn vé.",
  },
];

export const TERMS_SECTIONS = [
  {
    title: "1. Tài khoản và thông tin liên hệ",
    body: "Bạn cần cung cấp email và số điện thoại chính xác để nhận vé điện tử. Khi gặp sự cố tại cổng, nhân viên có thể dùng 4 số cuối số điện thoại hoặc email của bạn để xác minh vé.",
  },
  {
    title: "2. Giữ chỗ và số lượng vé",
    body: "Mỗi lần giữ chỗ kéo dài 5 phút. Mỗi đơn hàng mua tối đa 6 vé để bảo đảm công bằng cho khán giả và hạn chế mua gom vé.",
  },
  {
    title: "3. Mã QR và vào cổng",
    body: "Mỗi vé hợp lệ chỉ vào cổng một lần. Mã QR đổi mới mỗi 30 giây trên ứng dụng. Ban tổ chức có quyền từ chối ảnh chụp màn hình hoặc vé đã được quét trước đó.",
  },
];

export const PRIVACY_BLOCKS = [
  {
    title: "Chúng tôi thu thập gì",
    body: "Họ tên, email và số điện thoại của bạn. Với ban tổ chức, chúng tôi cần thêm mã số thuế hoặc căn cước công dân để đối soát doanh thu.",
  },
  {
    title: "Dùng để làm gì",
    body: "Phát hành vé điện tử, thông báo khi sự kiện thay đổi, hoàn tiền qua VNPay và xác minh vé của bạn tại cổng.",
  },
  {
    title: "Bảo vệ thông tin như thế nào",
    body: "Mật khẩu của bạn được lưu ở dạng mã hóa một chiều. TicketHub không lưu thông tin thẻ ngân hàng của bạn, việc thanh toán do VNPay xử lý.",
  },
  {
    title: "Quyền của bạn",
    body: "Theo Nghị định 13/2023/NĐ-CP, bạn có quyền xem và chỉnh sửa thông tin cá nhân, rút lại sự đồng ý hoặc yêu cầu xóa dữ liệu khi không còn giao dịch phát sinh.",
  },
];

export const REFUND_POLICIES = [
  {
    name: "Linh hoạt",
    rows: [
      { when: "Hủy trước ngày diễn ra từ 7 ngày trở lên", result: "Hoàn 100%" },
      { when: "Hủy từ 3 đến dưới 7 ngày trước", result: "Hoàn 50%" },
      { when: "Hủy trong vòng 3 ngày trước", result: "Không hoàn" },
    ],
  },
  {
    name: "Nghiêm ngặt",
    rows: [
      { when: "Hủy trước ngày diễn ra từ 14 ngày trở lên", result: "Hoàn 50%" },
      { when: "Hủy trong vòng 14 ngày trước", result: "Không hoàn" },
    ],
  },
  {
    name: "Không hoàn vé",
    rows: [
      { when: "Bạn tự hủy vé", result: "Không hoàn" },
      {
        when: "Sự kiện bị ban tổ chức hoặc quản trị viên hủy",
        result: "Được hoàn tiền",
      },
    ],
  },
];

export const REFUND_NOTES = [
  "Mỗi sự kiện áp dụng một trong ba chính sách trên, do ban tổ chức chọn.",
  "Số tiền hoàn tính theo số tiền bạn thực trả, sau khi trừ mã giảm giá.",
  "Vé đã dùng để vào cổng không thể hoàn.",
  "Sự kiện bị hủy bởi ban tổ chức hoặc quản trị viên luôn được hoàn tiền, bất kể chính sách.",
];
