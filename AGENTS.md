# QUY CHUẨN KIẾN TRÚC VÀ PHÁT TRIỂN HỆ THỐNG TICKETHUB (PROJECT CONSTITUTION)

Tài liệu này là Hiến chương Dự án bất biến (Immutable Project Constitution) cho toàn bộ hệ thống TicketHub. Mọi AI Agent, Subagent, kỹ sư phần mềm và người đánh giá mã nguồn (PR Reviewer) bắt buộc phải tuân thủ nghiêm ngặt các nguyên tắc kiến trúc, trải nghiệm người dùng E2E, bảo mật và quy ước phát triển dưới đây. Mọi sự tự ý suy diễn hoặc làm sai lệch quy chuẩn đều bị từ chối khi duyệt mã nguồn.

---

## 1. Nguyên Tắc Phạm Vi Và Kiến Trúc Bất Biến

### 1.1. Phân Bổ Ghế Tự Động (Auto-Seat Allocation - UC04)

- **Cơ chế chọn vé:** Người mua vé cá nhân (`BUYER`) **KHÔNG BAO GIỜ** được phép chọn từng số ghế cụ thể trên sơ đồ rạp/sân khấu.
- **Quy trình đặt vé:**
  1. Khách hàng chỉ chọn Khu vực / Hạng vé (`zoneId` / `ticketTypeId`) và Số lượng vé cần mua (`quantity`: tối thiểu 1 vé, tối đa 6 vé trên một giao dịch).
  2. Giao diện người dùng (Zone Map) chỉ là bản đồ trực quan minh họa vị trí không gian của các khu vực, mức giá, số lượng vé còn lại và trạng thái (Còn vé / Sắp hết / Hết vé). Tuyệt đối **không** xây dựng công cụ click chọn từng ghế (seat-by-seat clicker / picker) cho khách mua vé.
  3. Payload gửi lên API giữ chỗ (`POST /api/v1/booking/hold`) **chỉ** chứa:
     ```json
     {
       "eventId": "<uuid-event>",
       "items": [
         {
           "ticketTypeId": "<uuid-ticket-type>",
           "quantity": 2
         }
       ]
     }
     ```
     Tuyệt đối **cấm** gửi trường `seatId` hoặc mảng `seatIds` từ phía Frontend.
  4. Backend chịu trách nhiệm phân bổ ghế tự động bằng thuật toán tối ưu:
     - Truy vấn các ghế khả dụng trong Zone bằng cơ chế khóa hàng PostgreSQL:
       `SELECT id, seat_number, row_number FROM seats WHERE zone_id = $1 AND status = 'AVAILABLE' ORDER BY row_number ASC, seat_number ASC LIMIT $2 FOR UPDATE SKIP LOCKED`
     - Ưu tiên tối đa việc phân bổ các ghế liền kề nhau trong cùng một hàng (`row_number`).
     - Trả về danh sách ghế đã được tự động cấp phát (`allocatedSeats`) cho người dùng kiểm tra tại trang Checkout.

### 1.2. Quy Tắc Khu Vực Vé Đứng (Standing / Fanzone)

- Đối với các khu vực không đánh số ghế (General Admission / GA, Standing, Fanzone):
  - Tuyệt đối **không** sinh các bản ghi hàng ghế (`row_number`, `seat_number`) giả lập hoặc gán nhãn N/A trong cơ sở dữ liệu.
  - Quản lý theo dung lượng khu vực (`capacity` và bộ đếm `held_count` / `sold_count`).
  - Cập nhật số lượng nguyên tử trong cơ sở dữ liệu:
    `UPDATE zones SET held_count = held_count + $1 WHERE id = $2 AND capacity - sold_count - held_count >= $1`
  - Khi xuất vé điện tử (Ticket), giao diện và mã vé hiển thị rõ ràng: "Khu vực: GA - Fanzone (Vé đứng)", tuyệt đối không hiển thị "Hàng: N/A, Ghế: N/A".

### 1.3. Loại Bỏ Hoàn Toàn Hàng Chờ Ảo (Virtual Waiting Room - UC03)

- Tính năng Hàng chờ ảo (Virtual Waiting Room / UC03) đã được loại bỏ hoàn toàn khỏi phạm vi sản phẩm và kỹ thuật của TicketHub.
- **Quy định triển khai:**
  - Không xây dựng màn hình hàng chờ `/waiting-room`.
  - Không gửi và không kiểm tra header xác thực hàng chờ `x-admission-token` trên bất kỳ endpoint API nào.
  - Luồng mua vé là luồng trực tiếp (Direct Booking Flow): Xem sự kiện -> Chọn Zone và số lượng -> Giữ chỗ và chuyển hướng thanh toán.
  - Năng lực chịu tải và chống nghẽn mua đồng thời được đảm bảo 100% bằng hạ tầng Backend: Redis Sliding-Window Rate Limiter kết hợp Database Row-Level Locking (`FOR UPDATE SKIP LOCKED`).

### 1.4. Tách Biệt Trang Chi Tiết Sự Kiện Và Trang Đặt Vé

- **Trang Chi tiết sự kiện (`/events/[id]`):**
  - Là Landing Page tối ưu hóa SEO (Server-Side Rendering / Static Site Generation).
  - Trưng bày đầy đủ hình ảnh poster, trailer, thông tin chi tiết nghệ sĩ, thời gian, địa điểm tổ chức (tích hợp bản đồ), điều khoản sự kiện và các hạng vé công khai.
  - Chứa nút kêu gọi hành động (CTA) nổi bật "Mua vé ngay".
  - Bấm "Mua vé ngay" sẽ chuyển hướng người dùng sang trang Đặt vé chuyên biệt.
- **Trang Đặt vé (`/events/[id]/booking`):**
  - Là ứng dụng chọn vé động tương tác cao.
  - Hiển thị sơ đồ phân khu (Zone Map SVG tương tác), bộ chọn số lượng vé (1 đến 6 vé), kiểm tra tình trạng vé theo thời gian thực và nút chuyển tiếp sang trang Checkout.

### 1.5. Quy Chuẩn Trang Thanh Toán Độc Lập 2 Cột (`/checkout`)

- Tuyệt đối **không** dùng Modal hoặc Popup cho thao tác thanh toán; `/checkout` bắt buộc là một trang giao diện toàn màn hình chuyên biệt (Standalone Page).
- Thiết kế bố cục chuẩn theo phong cách các sàn vé quốc tế (tham khảo Viagogo/StubHub):
  1. **Thanh tiêu đề cố định (Sticky Header):**
     - Hiển thị đồng hồ đếm ngược kỹ thuật số dạng `MM:SS` (chuẩn 5 phút / 300 giây).
     - Chuyển màu cảnh báo rõ ràng khi thời gian còn dưới 60 giây.
  2. **Bố cục 2 cột trên màn hình máy tính (2-Column Layout):**
     - **Cột bên trái (Thao tác thanh toán):**
       - Biểu mẫu thông tin người nhận vé (Họ và tên, Email, Số điện thoại) với tính năng tự động điền (Autofill) từ tài khoản đang đăng nhập.
       - Ô nhập mã giảm giá (Voucher / Coupon) kèm phản hồi kiểm tra ngay lập tức.
       - Bộ chọn phương thức thanh toán VNPay (VNPay-QR, Thẻ nội địa ATM, Thẻ quốc tế Visa/Mastercard).
       - Nút bấm xác nhận thanh toán nổi bật: "Thanh toán ngay qua VNPay".
     - **Cột bên phải (Tóm tắt và Cam kết):**
       - Tóm tắt thông tin sự kiện (Tên sự kiện, Thời gian bắt đầu, Địa điểm tổ chức).
       - Chi tiết vị trí vé đã được hệ thống tự động cấp phát (Tên Zone, Danh sách số ghế/hàng ghế cụ thể, Đơn giá từng vé).
       - Bảng phân tách chi phí minh bạch: Tạm tính, Phí dịch vụ (nếu có), Giảm giá voucher, Tổng tiền thanh toán đã bao gồm VAT.
       - Huy hiệu bảo đảm an toàn giao dịch và cam kết 100% vé chính hãng.
  3. **Xử lý hết hạn và hủy giao dịch:**
     - Khi đồng hồ đếm ngược chạm mốc `00:00`, lập tức khóa màn hình, kích hoạt API giải phóng chỗ giữ và điều hướng người dùng về trang sự kiện kèm thông báo cảnh báo hết hạn giữ chỗ.
     - Có nút "Hủy giao dịch" rõ ràng để người dùng chủ động trả vé đang giữ về kho vé cho người khác đặt.

### 1.6. Xử Lý Thanh Toán VNPay Và Xử Lý IPN Muộn (Late IPN - UC05 / UC06)

- **Thời hạn giữ chỗ:** Chính xác 5 phút (300 giây) kể từ thời điểm tạo phiên giữ chỗ thành công.
- **Xử lý webhook IPN muộn (Late IPN Handling):**
  - Khi cổng thanh toán VNPay gửi tín hiệu IPN thành công (`vnp_ResponseCode == '00'`) nhưng đơn hàng trong hệ thống đã quá hạn 5 phút và phiên giữ chỗ đã bị hủy:
  - Backend thực hiện kiểm tra trạng thái các ghế đã giữ:
    - Nếu các ghế đó vẫn còn trống: Hệ thống tự động phục hồi và xác nhận cấp vé cho đơn hàng.
    - Nếu bất kỳ ghế nào đã bị người dùng khác đặt mất: Hệ thống chuyển trạng thái đơn hàng sang `PAYMENT_EXPIRED_REFUND_PENDING`, đồng thời tự động kích hoạt tiến trình gọi API Hoàn tiền của VNPay (`vnp_Command=refund`) để hoàn lại 100% tiền cho khách hàng, gửi email giải thích sự cố quá hạn.
  - Tuyệt đối không để xảy ra trường hợp trừ tiền người dùng nhưng không có vé và không được hoàn tiền.

### 1.7. Chính Sách Hủy Vé Và Hoàn Tiền Tự Động (UC06)

- **Cấu hình chính sách theo sự kiện (Refund Policies):**
  - `FLEXIBLE`: Cho phép hoàn 100% giá vé nếu yêu cầu trước 7 ngày; hoàn 50% nếu yêu cầu trước 3 ngày; không hoàn tiền trong vòng 3 ngày trước sự kiện.
  - `STRICT`: Cho phép hoàn 50% nếu yêu cầu trước 14 ngày; không hoàn tiền trong vòng 14 ngày trước sự kiện.
  - `NO_REFUND`: Không áp dụng hoàn vé tự nguyện dưới mọi hình thức (trừ trường hợp sự kiện bị Ban tổ chức hoặc Admin hủy bỏ).
- **Quy trình kỹ thuật xử lý hoàn tiền:**
  1. Người dùng yêu cầu hủy vé tại trang `/buyer/orders/[id]`.
  2. Backend kiểm tra điều kiện thời gian và tính toán số tiền hoàn hợp lệ.
  3. Thu hồi vé nguyên tử trong một Database Transaction: Đổi trạng thái vé từ `SOLD` sang `REFUNDED`, chuyển trạng thái ghế về `AVAILABLE`, cập nhật trạng thái đơn hàng.
  4. Áp dụng mô hình Transactional Outbox Pattern: Lưu sự kiện hoàn tiền vào cơ sở dữ liệu và chuyển cho tiến trình nền (Worker / BullMQ) gọi API VNPay Refund với cơ chế thử lại lũy tiến (Exponential Backoff).
  5. Tuyệt đối không gọi HTTP API của bên thứ ba trực tiếp bên trong Database Transaction.

### 1.8. Soát Vé Bằng Mã QR Động Ed25519 Và Tra Cứu Dự Phòng (UC08)

- **Mã QR động (Dynamic Rolling QR):**
  - Giao diện vé của khách hàng tự động làm mới mã QR mỗi 30 giây một lần.
  - Dữ liệu mã QR là một chuỗi JWT được ký bằng thuật toán mã hóa bất đối xứng `Ed25519` (Khóa bí mật lưu tại Backend, Khóa công khai nạp vào ứng dụng soát vé).
  - Dữ liệu mã hóa bao gồm: `ticketId`, `eventId`, `timestamp`, `nonce`, chữ ký số.
  - Ngăn chặn hoàn toàn việc chụp ảnh màn hình, quay video hoặc in ấn vé lậu bán lại nhiều lần.
- **Xác thực và cập nhật nguyên tử tại cổng soát vé:**
  - Thực hiện câu lệnh cập nhật nguyên tử trực tiếp trong PostgreSQL:
    `UPDATE tickets SET status = 'CHECKED_IN', checked_in_at = NOW(), gate_staff_id = $2 WHERE id = $1 AND status = 'SOLD' RETURNING *;`
  - Nếu số dòng ảnh hưởng bằng 0: Trả về thông báo lỗi vé không hợp lệ hoặc vé đã được sử dụng trước đó (kèm thời gian và nhân viên đã thực hiện soát vé trước đó).
- **Quy trình tra cứu thủ công dự phòng (Manual Lookup Fallback):**
  - Áp dụng khi điện thoại của người mua hết pin, vỡ màn hình hoặc mất kết nối mạng.
  - Mỗi vé sở hữu một mã định danh tĩnh ngẫu nhiên 32 ký tự (`ticketCode`) được gửi qua email xác nhận khi mua vé thành công.
  - Nhân viên soát vé nhập mã vé kết hợp với 4 chữ số cuối của Số điện thoại hoặc Email người mua tại trang `/gate/lookup`.
  - Bắt buộc ghi nhận log kiểm toán cho mọi thao tác tra cứu thủ công: `gateId`, `staffId`, `reason`, `checkedInAt`.

### 1.9. Kiểm Duyệt Quản Trị 2 Lớp Và Công Tắc Khẩn Cấp Kill Switch (UC10)

- **Quy trình kiểm duyệt 2 lớp (Two-tier Moderation):**
  - **Lớp 1 - Xác minh danh tính Ban tổ chức (Organizer KYC):** Quản trị viên đối soát giấy chứng nhận đăng ký kinh doanh, căn cước công dân người đại diện pháp luật và tài khoản ngân hàng trước khi cấp quyền tạo sự kiện.
  - **Lớp 2 - Phê duyệt sự kiện mở bán (Event Publishing Approval):** Quản trị viên rà soát nội dung sự kiện, giấy phép biểu diễn, sơ đồ giá vé và chính sách hoàn trả trước khi cho phép chuyển trạng thái sự kiện sang `PUBLISHED`.
- **Công tắc ngắt khẩn cấp (Emergency Kill Switch):**
  - Quản trị viên có quyền kích hoạt Kill Switch trên bất kỳ sự kiện nào có dấu hiệu gian lận, vi phạm pháp luật hoặc sự cố an ninh nghiêm trọng.
  - Chuyển trạng thái sự kiện sang `SUSPENDED` ngay lập tức.
  - Hiệu lực tức thì: Hủy toàn bộ các phiên giữ chỗ đang thực hiện, chặn tạo đơn hàng mới, vô hiệu hóa toàn bộ mã QR soát vé tại cổng.
- **Nhật ký kiểm toán bất biến (Immutable Audit Log):**
  - Bảng `audit_logs` hoạt động theo cơ chế chỉ ghi (Append-only).
  - Nghiêm cấm các thao tác `UPDATE` hoặc `DELETE` trên bảng này bằng quyền Database và Trigger bảo vệ.
  - Thuộc tính ghi vết bắt buộc: `actor_id`, `actor_role`, `action`, `resource_type`, `resource_id`, `old_value`, `new_value`, `ip_address`, `user_agent`, `created_at`.

### 1.10. Kiểm Soát Truy Cập Và Phòng Chống IDOR (RBAC & IDOR Prevention)

- **Phân định 4 vai trò người dùng (Roles):**
  - `BUYER`: Khách hàng mua vé, quản lý vé cá nhân, yêu cầu hoàn tiền.
  - `ORGANIZER`: Ban tổ chức tạo và quản lý sự kiện, cấu hình khu vực vé, theo dõi báo cáo doanh thu.
  - `GATE_STAFF`: Nhân viên soát vé tại sự kiện, vận hành máy quét QR và tra cứu vé thủ công.
  - `ADMIN`: Quản trị viên cấp cao, kiểm duyệt KYC, duyệt mở bán sự kiện, vận hành Kill Switch và giám sát Audit Log.
- **Phòng chống IDOR (Insecure Direct Object Reference) triệt để:**
  - Mọi API truy xuất hoặc biến đổi dữ liệu (Đơn hàng, Vé, Doanh thu, Cấu hình) bắt buộc phải xác thực quyền sở hữu tài nguyên thông qua định danh `userId` trích xuất trực tiếp từ JWT Payload đã được ký số hợp lệ.
  - Ví dụ: `GET /api/v1/orders/:id` bắt buộc kiểm tra điều kiện `WHERE id = $1 AND buyer_id = $currentUser.id` đối với vai trò BUYER, hoặc kiểm tra quyền sở hữu sự kiện đối với vai trò ORGANIZER.
  - Tuyệt đối không bao giờ tin cậy `userId` hay `role` được truyền qua Request Body hoặc Query Parameters từ phía người dùng.

---

## 2. Bản Đồ 19 Trang Giao Diện Toàn Hệ Thống (Frontend Routing Map)

Toàn bộ ứng dụng giao diện TicketHub được cấu trúc chính xác thành 19 trang thuộc 5 phân hệ người dùng:

### Phân Hệ 1: Khách Mua Vé (Buyer Experience - 7 Trang)

1. `/` : Trang chủ khám phá sự kiện, banner tiêu điểm, danh mục thể loại, tìm kiếm nhanh.
2. `/events` : Trang danh sách sự kiện kết hợp bộ lọc đa chiều (thời gian, địa điểm, khoảng giá, trạng thái vé).
3. `/events/[id]` : Trang giới thiệu sự kiện (SEO Landing Page, thông tin nghệ sĩ, lịch biểu, địa điểm tổ chức, điều khoản).
4. `/events/[id]/booking` : Trang đặt vé tương tác (Sơ đồ khu vực Zone Map, bộ chọn số lượng 1-6 vé, tình trạng còn vé).
5. `/checkout` : Trang thanh toán chuyên biệt 2 cột (Đồng hồ đếm ngược 5 phút, form người nhận, mã giảm giá, cổng VNPay).
6. `/buyer/orders` : Danh sách lịch sử đơn hàng đã đặt của người dùng.
7. `/buyer/orders/[id]` : Chi tiết đơn hàng, hiển thị mã QR động 30s đổi một lần và nút yêu cầu hủy/hoàn vé.

### Phân Hệ 2: Xác Thực Và Hồ Sơ (Auth & Profile - 3 Trang)

8. `/auth/login` : Đăng nhập tài khoản bằng Email/Mật khẩu hoặc liên kết OAuth Google.
9. `/auth/register` : Đăng ký tài khoản người dùng mới kèm kiểm tra xác thực.
10. `/profile` : Xem và cập nhật thông tin cá nhân, đổi mật khẩu và quản lý bảo mật.

### Phân Hệ 3: Cổng Quản Lý Ban Tổ Chức (Organizer Portal - 4 Trang)

11. `/organizer/dashboard` : Tổng quan doanh thu, số lượng vé đã bán, biểu đồ tăng trưởng thời gian thực.
12. `/organizer/events` : Danh sách các sự kiện do Ban tổ chức quản lý kèm trạng thái kiểm duyệt.
13. `/organizer/events/new` : Trình khởi tạo sự kiện mới (Thông tin, tải sơ đồ Zone, cài đặt giá và số lượng vé).
14. `/organizer/events/[id]/stats` : Báo cáo thống kê chi tiết theo sự kiện (Doanh thu theo Zone, tiến độ soát vé tại cổng).

### Phân Hệ 4: Cổng Nhân Viên Soát Vé (Gate Staff Mobile/PWA - 2 Trang)

15. `/gate/scanner` : Trình quét mã QR động bằng camera điện thoại, hiển thị trạng thái hợp lệ tức thì và phát âm thanh phản hồi.
16. `/gate/lookup` : Giao diện tra cứu thủ công vé bằng mã tĩnh 32 ký tự kết hợp thông tin người mua khi có sự cố.

### Phân Hệ 5: Cổng Quản Trị Hệ Thống (Admin Portal - 3 Trang)

17. `/admin/dashboard` : Bảng điều khiển trung tâm toàn nền tảng, các chỉ số giao dịch và cảnh báo hệ thống.
18. `/admin/moderation` : Trung tâm kiểm duyệt 2 lớp (Duyệt hồ sơ pháp lý Ban tổ chức KYC và Phê duyệt sự kiện mở bán).
19. `/admin/events/[id]/control` : Bảng điều khiển khẩn cấp sự kiện, vận hành Kill Switch và tra cứu nhật ký Audit Log.

---

## 3. Quy Chuẩn Kiểm Thử Và Ranh Giới Phát Triển (Testing & Git Conventions)

### 3.1. Độc Lập Trong Kiểm Thử (Test Isolation)

- Toàn bộ kiểm thử tích hợp API phải được viết dưới dạng Black-box HTTP API Tests (sử dụng thư viện `supertest` hoặc native `fetch` gửi HTTP request trực tiếp tới ứng dụng).
- **Tuyệt đối cấm:** Gọi các câu lệnh can thiệp container hệ điều hành trong mã kiểm thử (như `child_process.execFileSync('docker', ...)`).
- Sử dụng cơ sở dữ liệu kiểm thử riêng biệt. Dữ liệu thử nghiệm phải được dọn dẹp và reset thông qua Transaction Rollback hoặc làm rỗng bảng trước/sau mỗi test suite.
- Nguyên tắc Zero-mocking đối với toàn bộ logic nghiệp vụ cốt lõi: Giữ chỗ, thanh toán, phân bổ ghế, hoàn tiền và soát vé phải chạy trực tiếp với Database và Redis thật trong môi trường kiểm thử.

### 3.2. Quy Chuẩn Git Và Nhánh Làm Việc

- Nhánh tích hợp mặc định của dự án là `unstable`. Toàn bộ Pull Request, tính năng mới và bản vá lỗi bắt buộc phải phân nhánh từ `unstable` và tạo PR hướng về `unstable`.
- Nghiêm cấm mọi hành vi tự ý chỉnh sửa hoặc xóa bỏ các tệp workflow CI/CD trong thư mục `.github/workflows/` trừ khi có chỉ thị trực tiếp từ Kiến trúc sư trưởng.
- Mọi Pull Request bắt buộc phải vượt qua toàn bộ quy trình kiểm tra tự động (`pnpm test`, `pnpm build`, `pnpm lint`, `scripts/audit-doc-parity.mjs`) trước khi được xem xét hợp nhất.

---

## 4. Quy Chuẩn Văn Bản Và Phong Cách (Style & Character Conventions)

- **Tuyệt đối không dùng emoji (0 emoji):** Không sử dụng bất kỳ biểu tượng cảm xúc hoặc emoji nào trong mã nguồn, tài liệu, tệp cấu hình, thông điệp commit hoặc phản hồi thảo luận.
- **Tuyệt đối không dùng dấu gạch ngang dài:** Không dùng ký tự en-dash (`\u2013`) hoặc em-dash (`\u2014`). Chỉ sử dụng dấu gạch ngang ngắn tiêu chuẩn `-` hoặc dấu hai chấm `:`.
- **Ngôn ngữ chuẩn mực:** Sử dụng tiếng Việt kỹ thuật chuẩn, văn phong chuyên nghiệp, trung tính, khách quan, chính xác về mặt định danh kỹ thuật.
- **Tính toàn vẹn của liên kết tệp:** Khi nhắc đến tệp tin hoặc mã nguồn, bắt buộc phải sử dụng định dạng liên kết `file://` chuẩn Markdown Github-flavored.
