# Kiến trúc hệ thống

Tài liệu này mô tả kiến trúc tổng thể, mô hình phân chia module trong monorepo và các luồng xử lý đồng thời của hệ thống TicketHub.

## Kiến trúc tổng thể

Hệ thống được thiết kế theo mô hình monorepo, chia tách ứng dụng web và API backend, sử dụng PostgreSQL làm nơi lưu trữ trạng thái giao dịch và Redis làm lớp đệm trung gian.

```mermaid
graph TD
    subgraph Clients["Tầng Client"]
        BuyerBrowser["Trình duyệt Người mua\n(Next.js App Router)"]
        OrganizerDashboard["Bảng điều khiển BTC & Admin\n(Next.js App Router)"]
        GateStaffPWA["Ứng dụng Soát vé\n(Next.js PWA)"]
    end

    subgraph EdgeLayer["Tầng Biên"]
        Cloudflare["Cloudflare CDN / WAF / Turnstile CAPTCHA\n(Chặn bot và cân bằng tải)"]
    end

    subgraph AppLayer["Tầng Ứng dụng"]
        WebApp["Web App Frontend\n(Next.js / React 19)"]
        API["Backend API Service\n(NestJS + Fastify)"]
        Worker["Background Job Worker\n(BullMQ)"]
    end

    subgraph DataLayer["Tầng Dữ liệu"]
        Postgres[(PostgreSQL 16/17\nLưu trữ giao dịch, khóa hàng)]
        Redis[(Redis\nCache, Rate Limiter, Pub/Sub, BullMQ)]
        Storage[(Cloudflare R2 / AWS S3\nLưu trữ ảnh và tệp)]
    end

    subgraph ExternalServices["Dịch vụ bên thứ ba"]
        VNPay["Cổng thanh toán VNPay"]
        EmailService["Dịch vụ Email (Resend / SES)"]
        SMSService["Dịch vụ SMS"]
    end

    BuyerBrowser --> Cloudflare
    OrganizerDashboard --> Cloudflare
    GateStaffPWA --> Cloudflare

    Cloudflare --> WebApp
    Cloudflare --> API

    WebApp -.->|"SSR"| API
    BuyerBrowser -->|"REST API & SSE"| API
    OrganizerDashboard -->|"REST API"| API
    GateStaffPWA -->|"Soát vé API"| API

    API --> Postgres
    API --> Redis
    API --> Storage
    API --> VNPay

    Worker --> Redis
    Worker --> Postgres
    Worker --> EmailService
    Worker --> SMSService

    VNPay -->|"Webhook IPN"| API
```

## Cấu trúc thư mục

Kho mã nguồn sử dụng pnpm workspaces để quản lý các gói:

- `apps/web`: Ứng dụng giao diện người dùng xây dựng bằng Next.js App Router, bao gồm trang công khai, trang mua vé, bảng điều khiển ban tổ chức, bảng điều khiển quản trị viên và ứng dụng PWA soát vé.
- `apps/api`: Dịch vụ backend xây dựng bằng NestJS trên nền tảng Fastify. Các module nghiệp vụ được tách biệt (auth, events, seats, booking, payment, ticket, checkin, refund, reporting, admin, notification).
- `packages/shared`: Thư viện dùng chung chứa định nghĩa kiểu dữ liệu TypeScript, schema xác thực Zod và hằng số hệ thống.

## Ranh giới vai trò và Ma trận phân quyền

Hệ thống phân tách rõ trách nhiệm giữa các tầng client và vai trò người dùng nhằm ngăn ngừa xung đột lợi ích và bảo vệ tính minh bạch của thị trường vé:

| Vai trò        | Client tương tác     | Chức năng chính                                                                            | Giới hạn nghiệp vụ (Restrictions)                                                   |
| :------------- | :------------------- | :----------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| **BUYER**      | `BuyerBrowser`       | Mua vé, giữ chỗ ghế (`/booking/hold`), thanh toán qua VNPay, xem vé QR tại `/my-tickets`   | Bị chặn truy cập các route `/admin/*` và `/organizer/*`                             |
| **ORGANIZER**  | `OrganizerDashboard` | Tạo sự kiện, cấu hình hạng vé, sơ đồ ghế, nộp hồ sơ KYC, xem báo cáo doanh thu             | **Không thể mua vé**, không có mục "Vé của tôi", bị chặn gọi API giữ chỗ và tạo đơn |
| **ADMIN**      | `OrganizerDashboard` | Phê duyệt sự kiện, duyệt hồ sơ ban tổ chức, đối soát tài chính, kiểm tra nhật ký kiểm toán | **Không thể mua vé**, không có mục "Vé của tôi", bị chặn gọi API giữ chỗ và tạo đơn |
| **GATE_STAFF** | `GateStaffPWA`       | Quét mã QR và xác thực vé vào cổng                                                         | Không thể mua vé, không can thiệp cấu hình sự kiện                                  |

## Các luồng xử lý chính

### Giữ chỗ trực tiếp

Luồng mua vé là luồng trực tiếp: xem sự kiện, chọn hạng vé và số lượng, giữ chỗ rồi chuyển sang thanh toán. Khả năng chịu tải khi mua đồng thời được đảm bảo bằng Redis Sliding-Window Rate Limiter kết hợp khóa dòng PostgreSQL (`FOR UPDATE SKIP LOCKED`). Nền tảng áp dụng cơ chế tự động phân bổ ghế liền kề (Auto Seat Allocation) theo hạng vé và số lượng, không yêu cầu người dùng chọn từng vị trí ghế thủ công nhằm tối ưu tốc độ mua vé và ngăn ngừa phân mảnh ghế ngồi.

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Người mua
    participant Web as Web Client
    participant Redis as Redis
    participant API as API Server
    participant DB as PostgreSQL
    participant Worker as BullMQ Worker

    Buyer->>Web: Chọn hạng vé và số lượng vé
    Web->>API: POST /booking/hold (kèm Idempotency-Key và items ticketTypeId + quantity)
    Note over API,DB: Thuật toán tìm ghế liền kề theo hàng (nhảy hàng khi phân mảnh)
    loop Thử lại tối đa 10 lần nếu tranh chấp khóa ứng viên
        API->>DB: BEGIN TRANSACTION
        API->>DB: SELECT id FROM seats WHERE id = ANY($1) ORDER BY id ASC FOR UPDATE
        API->>DB: UPDATE seats SET status = 'HELD', hold_expires_at = now() + 5 phút WHERE id = ANY($1) AND (status='AVAILABLE' OR (status='HELD' AND hold_expires_at < now())) RETURNING id
    end

    alt Không đủ ghế hoặc tranh chấp không thể giải quyết
        API->>DB: ROLLBACK
        API-->>Web: Báo lỗi INSUFFICIENT_TICKET_CAPACITY hoặc SEAT_ALREADY_HELD
    else Cập nhật đủ số ghế
        API->>DB: INSERT INTO orders (status = 'PENDING', expires_at = now() + 5 phút)
        API->>DB: INSERT INTO order_items (đính kèm seat_id đã tự động phân bổ)
        API->>DB: COMMIT
        API->>Redis: PUBLISH trạng thái ghế chuyển HELD
        Redis-->>Web: SSE cập nhật sơ đồ ghế tới các client khác
        API-->>Web: Trả mã đơn hàng, danh sách allocatedSeats và đếm ngược 5 phút
    end

    opt Quá hạn 5 phút chưa thanh toán
        Worker->>DB: Quét đơn PENDING hết hạn
        Worker->>DB: Chuyển đơn sang EXPIRED, hoàn ghế về AVAILABLE
        Worker->>Redis: PUBLISH trạng thái ghế chuyển AVAILABLE
    end
```

### Thanh toán qua VNPay và xử lý webhook

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Người mua
    participant Web as Web Client
    participant API as API Server
    participant DB as PostgreSQL
    participant VNPay as Cổng VNPay
    participant Worker as BullMQ Worker

    Buyer->>Web: Chọn thanh toán qua VNPay
    Web->>API: POST /checkout/create-payment
    API->>DB: Kiểm tra đơn PENDING và tính tổng tiền phía server
    API->>API: Tạo URL thanh toán kèm chữ ký HMAC SHA512
    API-->>Web: Trả về URL thanh toán
    Web->>VNPay: Chuyển hướng người dùng sang VNPay
    Buyer->>VNPay: Hoàn tất thao tác thanh toán

    VNPay->>API: Gửi IPN webhook (GET /webhooks/vnpay/ipn)
    Note over API: Xác thực chữ ký HMAC và kiểm tra bản ghi giao dịch

    alt Chữ ký hợp lệ và giao dịch chưa được xử lý
        API->>DB: BEGIN TRANSACTION
        API->>DB: Cập nhật đơn PAID, ghế SOLD, tạo bản ghi tickets
        API->>DB: Ghi bản ghi outbox TICKET_ISSUED
        API->>DB: COMMIT
        API-->>VNPay: Trả {"RspCode":"00","Message":"Confirm Success"}

        Worker->>DB: Đọc bản ghi outbox
        Worker->>Worker: Gửi email vé qua Resend/SES
    else Giao dịch đã xử lý trước đó
        API-->>VNPay: Trả {"RspCode":"00","Message":"Confirm Success"}
    else Chữ ký không hợp lệ
        API-->>VNPay: Trả {"RspCode":"97","Message":"Invalid Signature"}
    end

    VNPay->>Web: Chuyển hướng người dùng về màn hình kết quả
```

### Ký số mã QR động và kiểm soát soát vé

Mã QR hiển thị trên ứng dụng là một token JWS có thời hạn ngắn (30 giây) để giảm nguy cơ chia sẻ ảnh chụp màn hình.

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Người mua
    participant AppBuyer as Màn hình Vé của tôi
    participant API as API Server
    actor Staff as Nhân viên soát vé
    participant GateApp as Ứng dụng Soát vé
    participant DB as PostgreSQL

    Buyer->>AppBuyer: Mở chi tiết vé trong khung giờ check-in
    AppBuyer->>API: GET /tickets/:id/dynamic-qr
    API->>API: Tạo token JWS ký bằng khóa riêng Ed25519 (exp = iat + 30s, jti)
    API-->>AppBuyer: Trả qrToken
    AppBuyer->>AppBuyer: Hiển thị mã QR và tự xin token mới sau mỗi 25-30 giây

    Staff->>GateApp: Quét mã QR bằng camera
    GateApp->>API: POST /checkin/scan (qrToken, gateId)
    API->>API: Xác thực chữ ký bằng khóa công khai Ed25519, kiểm tra hạn và jti
    API->>DB: UPDATE tickets SET status = 'CHECKED_IN', checked_in_at = now(), gate_id = $gateId WHERE id = $ticketId AND status = 'SOLD' RETURNING id

    alt Trả về 1 dòng
        API-->>GateApp: Xác nhận hợp lệ (màn hình xanh)
    else Trả về 0 dòng
        API-->>GateApp: Báo vé không hợp lệ hoặc đã sử dụng (màn hình đỏ)
    end
```

## Hệ thống Địa điểm Chuẩn & Quản lý Sơ đồ SVG (Curated Venues)

Hệ thống TicketHub chuẩn hóa quy trình tạo sự kiện thông qua mô hình Địa điểm Chuẩn (Curated Venues) và Sơ đồ SVG vector tương tác:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Quản trị viên (Admin)
    actor Host as Ban tổ chức (Host)
    participant Web as Web Dashboard
    participant API as API Server
    participant DB as PostgreSQL
    actor Buyer as Người mua vé

    Admin->>Web: Nhập địa điểm mới & tải lên sơ đồ SVG đã chuẩn hóa
    Web->>API: POST /admin/venues (kèm sơ đồ mapKey & metadata phân khu)
    API->>DB: Lưu venues và venue_layouts (default_zones, map_key)

    Host->>Web: Vào màn hình Tạo sự kiện mới
    Web->>API: GET /venues?city=Hà Nội
    API->>DB: Truy vấn danh sách địa điểm khả dụng theo thành phố
    API-->>Web: Trả danh mục 11 địa điểm chuẩn (TP.HCM, Hà Nội, Đà Nẵng)

    Host->>Web: Nhấp chọn 1-click Địa điểm chuẩn (VD: Cung Điền Kinh Hà Nội)
    Web-->>Host: Tự động điền địa chỉ, quận huyện, chọn sơ đồ T-Stage & nạp bảng giá khu vực
    Host->>Web: Điều chỉnh đơn giá từng khu vực & nhấn Xuất bản sự kiện
    Web->>API: POST /events (kèm venue_id, venue_layout_id, ticket_types)
    API->>DB: Tạo sự kiện và khởi tạo các phân khu vé

    Buyer->>Web: Xem trang chi tiết sự kiện
    Web-->>Buyer: Hiển thị SeatMap SVG tương tác với giá vé động theo từng phân khu
```

### 1. Phân quyền và kiểm duyệt sơ đồ (Admin Curation)

- Quản trị viên biên tập và duy trì danh mục các địa điểm tổ chức biểu diễn và thi đấu lớn tại 3 thành phố hạt nhân: **TP. Hồ Chí Minh** (SVĐ Thống Nhất, NTĐ Quân Khu 7, Nhà Hát Hòa Bình, NTĐ Hồ Xuân Hương), **Hà Nội** (SVĐ Quốc Gia Mỹ Đình, Cung Điền Kinh Hà Nội, SVĐ Hàng Đẫy, Nhà Hát Lớn Hà Nội), và **Đà Nẵng** (Cung Thể Thao Tiên Sơn, SVĐ Hòa Xuân, Nhà Hát Trưng Vương).
- Mỗi địa điểm được liên kết với một hoặc nhiều mẫu sơ đồ kiến trúc chuẩn dạng SVG (sân khấu chữ T concert, mega concert sân vận động ngoài trời, sân bóng đá tiêu chuẩn FIFA, sàn đấu bóng rổ VBA, khán phòng nhà hát thính phòng).
- Các tệp SVG được chuẩn hóa thuộc tính `data-zone` trên từng phần tử khán đài nhằm đồng bộ tự động với bảng mã phân khu vé của hệ thống.

### 2. Quy trình lựa chọn 1-click cho Ban tổ chức (Host)

- Ban tổ chức có thể lọc địa điểm trực quan theo thành phố (Tất cả, TP. Hồ Chí Minh, Hà Nội, Đà Nẵng), lọc theo danh mục không gian hoặc tìm kiếm nhanh theo từ khóa.
- Khi chọn địa điểm, hệ thống tự động điền toàn bộ thông tin địa danh, địa chỉ, đồng thời thiết lập sẵn mẫu sơ đồ kiến trúc tối ưu nhất kèm theo ma trận phân bổ vé và mức giá đề xuất thực tế.
- Ban tổ chức có thể xem trước trực quan sơ đồ SVG tương tác (xoay, thu phóng, rê chuột xem giá) trước khi hoàn tất phát hành vé.

### 3. Trải nghiệm chọn chỗ trực quan cho Người mua vé

- Sơ đồ SVG vector được hiển thị sắc nét trên mọi thiết bị và độ phân giải, hỗ trợ thao tác cảm ứng trên thiết bị di động và chuột trên máy tính bàn.
- Trạng thái từng phân khu (còn vé, sắp hết vé, hết vé) được cập nhật đồng bộ với hệ thống giữ chỗ thông qua Server-Sent Events (SSE).

## Các biện pháp an toàn và giới hạn

### Giới hạn gian lận vé

- Cơ chế QR động giới hạn hiệu lực trong 30 giây giúp giảm thiểu việc chia sẻ ảnh chụp màn hình, nhưng không ngăn được việc người dùng đưa trực tiếp thiết bị của họ cho người khác vào cổng.
- Nhân viên soát vé vẫn duy trì quy trình kiểm tra đối chiếu giấy tờ tùy thân khi phát hiện dấu hiệu nghi vấn.

### Dừng khẩn cấp (Kill Switch)

- Khi phát hiện sự kiện vi phạm hoặc có khiếu nại nghiêm trọng, quản trị viên có thể chuyển trạng thái sự kiện sang `SUSPENDED`.
- Hệ thống sẽ chặn các yêu cầu đặt chỗ, thanh toán mới, hủy các đơn đang giữ chỗ và thông báo cho người dùng đang chờ trong hàng.

### Kiểm soát lưu lượng và bảo vệ ứng dụng

- Cloudflare áp dụng tường lửa ứng dụng (WAF) và Turnstile CAPTCHA để hạn chế lưu lượng truy cập từ bot tự động.
- API áp dụng rate limiting theo địa chỉ IP và tài khoản người dùng trên các endpoint nhạy cảm như đăng nhập, giữ chỗ và tạo thanh toán.

### Cơ chế an toàn giao dịch và Khóa hàng đồng thời (Atomic Row-level Locking)

Để triệt tiêu hoàn toàn nguy cơ bán trùng vé (double booking) và tranh chấp bế tắc (deadlock) trong các sự kiện có lưu lượng truy cập cao:

- **Nguyên tắc khóa:** Mọi thao tác giữ chỗ vé đều được thực thi bên trong một cơ sở dữ liệu transaction của PostgreSQL.
- **Thứ tự khóa bắt buộc:** Khi khóa nhiều hàng ghế đồng thời, câu lệnh SQL bắt buộc phải sắp xếp danh sách mã định danh tăng dần:
  ```sql
  SELECT id, status, version FROM seats
  WHERE id = ANY($1)
  ORDER BY id ASC
  FOR UPDATE;
  ```
  Việc khóa theo thứ tự `id ASC` nhất quán giữa mọi luồng xử lý đảm bảo không bao giờ xảy ra tình trạng khóa chéo (cyclic wait) gây deadlock trong PostgreSQL.

### Mô hình Transactional Outbox Pattern cho Tác vụ Phi đồng bộ

Hệ thống tuân thủ nghiêm ngặt nguyên lý Transactional Outbox nhằm đảm bảo tính nhất quán cuối cùng (Eventual Consistency):

- Không bao giờ gọi trực tiếp các dịch vụ mạng bên thứ ba (gửi email SMTP, dịch vụ SMS, cổng thanh toán bên ngoài) bên trong database transaction của đơn hàng.
- Khi đơn hàng hoàn tất hoặc sự kiện được phê duyệt, một bản ghi sự kiện sẽ được chèn vào bảng `outbox` ngay trong cùng transaction của đơn hàng.
- Bộ điều phối Outbox Dispatcher định kỳ quét các bản ghi chưa xử lý (`status = 'PENDING'`), đẩy vào hàng đợi BullMQ (Redis) và gửi thông báo qua BullMQ Email Worker. Nếu có lỗi mạng, tác vụ sẽ tự động kích hoạt cơ chế thử lại (retry với exponential backoff) mà không làm ảnh hưởng đến dữ liệu nghiệp vụ chính.
