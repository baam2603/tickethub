# Tài Liệu Định Hướng Kỹ Thuật: Chuẩn Hóa Kiến Trúc & Phân Công Nhiệm Vụ Tuần 3 - Tuần 4

Tài liệu này được ban hành nhằm thống nhất mô hình kiến trúc chuẩn trên toàn bộ dự án TicketHub, giải quyết dứt điểm các hiểu lầm về mặt nghiệp vụ giữa các bộ phận Frontend, Backend và QA, đồng thời định hướng phân công công việc thực hiện song song cho Tuần 3 và Tuần 4 (tính đến mốc ngày 03/11/2026).

---

## 1. Tuyên Ngôn Kiến Trúc Cốt Lõi: Auto-Seat Allocation (UC04)

### 1.1 Khách hàng chỉ chọn Khu vực và Số lượng vé

- **Mô hình trải nghiệm người dùng**: Khách hàng mua vé **thao tác chọn Khu vực / Hạng vé** (`ticketTypeId`) và **Số lượng vé** (`quantity: 1..6`) trên sơ đồ phân khu tổng thể (Zone Map).
- **Phạm vi giao diện**: Hệ thống không cung cấp giao diện bấm chọn từng số ghế trên sơ đồ chi tiết (Seat-by-seat clicker).
- **Hợp đồng dữ liệu (API Contract)**: Payload gửi lên endpoint `POST /api/v1/booking/hold` sử dụng định dạng:
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
  Client không gửi kèm trường `seatId`.

### 1.2 Phân bổ ghế tự động và khóa dòng dữ liệu tại Backend

- Khi nhận request giữ chỗ, tầng Backend (`BookingService.holdSeats`) tự động tìm các ghế trống phù hợp theo thuật toán phân bổ ghế liền kề trong cùng một hàng (`findContiguousSeats`).
- Việc giữ chỗ được thực thi bên trong một database transaction PostgreSQL với khóa dòng:
  ```sql
  SELECT id FROM seats
  WHERE event_id = $1 AND ticket_type_id = $2 AND status = 'AVAILABLE'
  ORDER BY id ASC
  FOR UPDATE;
  ```
- Sau khi transaction thành công, server trả về mã đơn hàng `orderId` kèm danh sách ghế cụ thể đã cấp phát (`allocatedSeats` gồm `zoneName`, `rowLabel`, `seatNumber`). Giao diện client chỉ nhận danh sách này và hiển thị thông tin hàng ghế cho người dùng trong thông tin tóm tắt đơn hàng.

### 1.3 Loại bỏ Hàng Chờ Ảo (Virtual Waiting Room - UC03)

- Hàng chờ ảo (UC03) đã được loại bỏ hoàn toàn khỏi phạm vi sản phẩm và kỹ thuật, theo AGENTS.md mục 1.3. Không xây dựng và không đưa trở lại dự án.
- Không có màn hình `/waiting-room`. Backend không cấp phát, không gửi và không kiểm tra header `x-admission-token`. Không dùng mã lỗi `MISSING_ADMISSION_TOKEN`.
- Luồng mua vé là luồng trực tiếp: Xem sự kiện -> Chọn Zone và số lượng -> Giữ chỗ và chuyển hướng thanh toán.
- Khả năng chịu tải khi mua đồng thời được đảm bảo bằng Redis Sliding-Window Rate Limiter kết hợp khóa dòng PostgreSQL (`FOR UPDATE SKIP LOCKED`).
- Các PR hoặc mã nguồn còn chứa hàng chờ ảo (module `waiting-room`, tham số `admissionToken`, cờ `isWaitingRoomEnabled`, test UC03) cần được loại bỏ, không được hợp nhất.

---

## 2. Bảng Phân Công Nhiệm Vụ & Hành Động Chi Tiết Cho 5 Thành Viên

### 2.1 Gia Khang (Quản lý dự án & QA)

- **Gói W03-PM (Tiến độ: 70% - Đang sửa PR #17)**:
  - Tái cấu trúc bài test concurrency `apps/web/test/booking-concurrency.spec.ts`: loại bỏ trường `seatId` trong request body; chuyển sang kiểm thử tranh chấp số lượng vé trong khu vực (Zone capacity contention).
  - Kịch bản chuẩn: 100 requests đồng thời tranh chấp một khu vực chỉ còn 1 ghế trống (kỳ vọng đúng 1 request thành công 201 Created và 99 requests nhận 409 Conflict với mã `INSUFFICIENT_TICKET_CAPACITY`).
  - Kiểm tra tính duy nhất: 50 requests thành công giữ chỗ không được trùng bất kỳ ghế nào trong `allocatedSeats`.
  - Loại bỏ việc gọi lệnh `docker exec tickethub-postgres psql` trong mã test; lấy thông tin qua API công khai hoặc test fixtures định sẵn.
  - Gỡ bỏ `testIgnore` trong `playwright.config.ts` và thêm script chạy `pnpm test:concurrency` vào `apps/web/package.json`.
- **Gói W04-PM (Tiến độ: 10% - Mở song song)**:
  - Lập bộ test case cho cổng thanh toán VNPay sandbox: trường hợp thanh toán thành công, người dùng hủy, timeout, và xử lý IPN ngoại lệ (gửi trùng, sai chữ ký, đơn đã quá hạn).

### 2.2 Vĩ Kiệt (Frontend Lead)

- **Gói W03-FE1 (Tiến độ: 80% - Đang sửa PR #42)**:
  - Loại bỏ toàn bộ phần hàng chờ ảo khỏi PR #42: xóa trang `apps/web/src/app/(public)/waiting-room/page.tsx`, mã token giả lập (`adm_w03_...`), bộ đếm client và logic chuyển hướng sang `/waiting-room` trong `apps/web/src/components/events/event-detail-client.tsx`. PR chỉ giữ lại phần tìm kiếm sự kiện.
  - Loại bỏ logic tự sinh mã đơn hàng giả `ORD-XXXXX` ở client khi API chưa phản hồi; không cho phép thanh toán với đơn hàng ảo.
  - Chuyển đổi 10 thẻ `<img>` thô sang component `<Image />` từ `next/image`.
  - Tiếp nhận bàn giao giao diện chọn phân khu (Zone Map) từ FE2 để tích hợp hoàn chỉnh tại trang chi tiết sự kiện.
- **Gói W04-FE1 (Tiến độ: 15% - Mở song song)**:
  - Xây dựng luồng Checkout: hiển thị tóm tắt đơn giữ chỗ, đồng hồ đếm ngược 5 phút, nút chuyển hướng sang cổng thanh toán VNPay và màn hình kết quả thanh toán `/checkout/result`.

### 2.3 Phú An (Frontend PWA & UI/UX)

- **Gói W03-FE2 (Tiến độ: 60% - Đã bàn giao)**:
  - Đóng PR #12; bỏ logic vẽ sơ đồ chi tiết từng ghế và xử lý sự kiện click/minimap phức tạp.
  - Bàn giao layout hiển thị phân khu tổng thể (Zone Map) cho Vĩ Kiệt (FE1).
- **Gói W04-FE2 (Tiến độ: 20% - Mở song song)**:
  - Tập trung phát triển màn hình "Vé của tôi" (`/my-tickets`): hiển thị danh sách vé đã mua, thông tin vị trí ghế được cấp, khung chờ mã QR động.
  - Thiết kế template email vé HTML hiển thị chuẩn trên Gmail và Apple Mail.
- **Gói W05-FE2 (Chuẩn bị mở)**:
  - Dựng khung ứng dụng PWA soát vé (Gate App) hỗ trợ quét QR qua camera thiết bị.

### 2.4 Tuấn Anh (Backend Lead)

- **Gói W03-BE1 (Tiến độ: 100% - Đã nghiệm thu tại PR #14)**:
  - Đã kiểm chứng thuật toán Auto-Seat Allocation, transaction phân tầng PostgreSQL và tác vụ dọn dẹp đơn hết hạn.
- **Gói W04-BE1 (Tiến độ: 100% - Đã hoàn tất và nghiệm thu)**:
  - Hoàn tất đơn hàng nguyên tử khi nhận tín hiệu thanh toán thành công (PENDING sang PAID, HELD sang SOLD, sinh mã vé).
  - Thiết lập endpoint SSE đẩy trạng thái ghế cập nhật thời gian thực qua Redis Pub/Sub (`GET /api/v1/events/:id/seats/stream`).
  - Xây dựng API hủy vé và hoàn tiền theo chính sách (UC06).

### 2.5 Tuấn Khôi (Backend Integration)

- **Gói W03-BE2 (Tiến độ: 100% - Đã nghiệm thu tại PR #13)**:
  - Đã hoàn tất API tìm kiếm full-text tiếng Việt unaccent và cơ chế cache tồn kho Redis.
- **Gói W04-BE2 (Tiến độ: 15% - Mở song song)**:
  - Hoàn thiện module thanh toán VNPay: tạo URL thanh toán có `idempotencyKey`, xử lý webhook IPN an toàn chống replay attack, hàm kiểm tra trạng thái QueryDR.
  - Tích hợp API Refund của VNPay phục vụ chức năng hủy vé tự động.

---

## 3. Lộ Trình Nghiệm Thu & Kế Hoạch Thực Hiện Song Song

| Ngày                   | Mục tiêu trọng tâm                                                                                                                        | Trách nhiệm                |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- | :------------------------- |
| **04/11/2026**         | Sửa dứt điểm và merge các PR Tuần 3: PR #17 (QA Concurrency, bỏ phần UC03) và PR #42 (FE1 Search, bỏ phần hàng chờ). Đóng PR #12 của FE2. | Gia Khang, Vĩ Kiệt, Phú An |
| **05/11 - 07/11/2026** | Hoàn thiện tích hợp cổng thanh toán VNPay sandbox giữa Backend và Web Client. Bàn giao màn hình Vé của tôi và template email HTML.        | Tuấn Khôi, Vĩ Kiệt, Phú An |
| **08/11 - 09/11/2026** | Kiểm thử tích hợp toàn trình luồng mua vé: Tìm kiếm -> Giữ chỗ tự động -> Thanh toán VNPay -> Nhận vé QR.                                 | Gia Khang, Toàn nhóm       |
| **10/11/2026**         | Nghiệm thu Giai đoạn 2 (Bán vé), sẵn sàng chuyển giao sang Giai đoạn 3 (Cổng soát vé PWA & Vận hành).                                     | PM, Toàn nhóm              |
