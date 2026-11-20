// Noi dung huong dan su dung viet cho nguoi dung cuoi. Chi mo ta nhung gi docs tren nhanh
// unstable da quy dinh; khong hua hen chi so toc do hay tinh nang chua co.

export type GuideRoleKey = "buyer" | "organizer" | "staff";

export const GUIDE_ROLES: { key: GuideRoleKey; label: string }[] = [
  { key: "buyer", label: "Dành cho người mua vé" },
  { key: "organizer", label: "Dành cho ban tổ chức" },
  { key: "staff", label: "Dành cho nhân viên soát vé" },
];

export function parseGuideRole(value: string | undefined): GuideRoleKey {
  return GUIDE_ROLES.find((role) => role.key === value)?.key ?? "buyer";
}

export interface GuideStep {
  title: string;
  description: string;
  tips: string[];
}

export interface RoleGuide {
  summary: string;
  ctaHref: string;
  ctaLabel: string;
  steps: GuideStep[];
}

export const GUIDE_BY_ROLE: Record<GuideRoleKey, RoleGuide> = {
  buyer: {
    summary: "Từ lúc chọn vé đến lúc vào cổng, gồm 3 bước.",
    ctaHref: "/my-tickets",
    ctaLabel: "Mở Vé của tôi",
    steps: [
      {
        title: "Chọn khu vực và số lượng vé",
        description:
          "Vào trang sự kiện, bấm Mua vé ngay, chọn khu vực trên sơ đồ và số lượng từ 1 đến 6 vé. Hệ thống tự xếp chỗ ngồi cho bạn.",
        tips: [
          "Sơ đồ cho biết khu vực còn vé, sắp hết hay đã hết.",
          "Khu vực vé đứng không có số ghế.",
          "Sau khi bấm giữ chỗ, vé được giữ cho bạn 5 phút.",
        ],
      },
      {
        title: "Thanh toán qua VNPay",
        description:
          "Kiểm tra vị trí chỗ ngồi, điền thông tin người nhận vé, nhập mã giảm giá nếu có rồi thanh toán trong 5 phút.",
        tips: [
          "Đồng hồ đếm ngược ở đầu trang cho biết thời gian còn lại.",
          "Bạn có thể thanh toán bằng mã QR, thẻ ATM nội địa hoặc thẻ Visa, Mastercard.",
          "Đổi ý thì bấm Hủy giao dịch để trả vé cho người khác.",
        ],
      },
      {
        title: "Nhận vé và vào cổng",
        description:
          "Thanh toán xong, vé xuất hiện trong mục Vé của tôi và được gửi qua email. Đến cổng, mở vé và đưa mã QR cho nhân viên quét.",
        tips: [
          "Mã QR tự đổi mới mỗi 30 giây, ảnh chụp màn hình sẽ không dùng được.",
          "Hết pin hoặc hỏng điện thoại: đưa mã vé trong email và 4 số cuối số điện thoại cho nhân viên.",
          "Cần hủy vé thì vào chi tiết đơn hàng, hệ thống cho xem trước số tiền hoàn.",
        ],
      },
    ],
  },
  organizer: {
    summary: "Từ lúc đăng ký đến lúc theo dõi bán vé, gồm 2 bước.",
    ctaHref: "/organizer/events",
    ctaLabel: "Vào trang Ban tổ chức",
    steps: [
      {
        title: "Xác minh tài khoản và tạo sự kiện",
        description:
          "Hoàn thiện hồ sơ tổ chức gồm mã số thuế, giấy phép kinh doanh và người đại diện để được xác minh. Sau đó tạo sự kiện với thông tin, khu vực vé, giá và số lượng.",
        tips: [
          "Sự kiện cần được quản trị viên phê duyệt trước khi mở bán.",
          "Chọn chính sách hoàn vé cho sự kiện: Linh hoạt, Nghiêm ngặt hoặc Không hoàn vé.",
        ],
      },
      {
        title: "Theo dõi bán vé",
        description:
          "Xem doanh thu, số vé đã bán theo từng khu vực và tiến độ soát vé tại cổng ở trang thống kê của sự kiện.",
        tips: [
          "Nếu phát hiện sự cố, hãy liên hệ quản trị viên để tạm dừng bán vé.",
        ],
      },
    ],
  },
  staff: {
    summary: "Từ lúc chuẩn bị đến lúc xử lý sự cố tại cổng, gồm 2 bước.",
    ctaHref: "/gate/scanner",
    ctaLabel: "Mở máy quét vé",
    steps: [
      {
        title: "Chuẩn bị trước giờ mở cửa",
        description:
          "Đăng nhập, chọn đúng sự kiện được phân công và cho phép ứng dụng dùng camera của điện thoại.",
        tips: [
          "Kiểm tra camera và âm lượng trước khi đón khán giả.",
          "Giữ điện thoại đủ pin và có kết nối mạng.",
        ],
      },
      {
        title: "Quét vé và xử lý sự cố",
        description:
          "Hướng camera vào mã QR của khách. Màn hình báo ngay vé hợp lệ hay không kèm âm thanh phản hồi.",
        tips: [
          "Vé đã dùng: màn hình cho biết thời điểm và nhân viên đã quét trước đó.",
          "Khách hết pin hoặc hỏng màn hình: dùng trang Tra cứu thủ công với mã vé và 4 số cuối số điện thoại hoặc email của khách.",
        ],
      },
    ],
  },
};

export const GUIDE_TIP = {
  title: "Mẹo cho ngày diễn ra sự kiện",
  body: "Hãy mở sẵn vé khi còn mạng tốt, sạc đầy pin và tăng độ sáng màn hình. Bạn cũng có thể thêm TicketHub vào màn hình chính (Safari trên iPhone: Chia sẻ rồi Thêm vào MH chính, Chrome trên Android: menu rồi Cài đặt ứng dụng) để mở nhanh hơn.",
};
