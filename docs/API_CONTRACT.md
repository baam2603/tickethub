# Hợp đồng giao diện lập trình (API Contract)

Tài liệu này đặc tả các endpoint REST API, định dạng dữ liệu đầu vào và đầu ra, mã lỗi, cũng như giao thức Server-Sent Events (SSE) cho hệ thống TicketHub.

Phiên bản API hiện tại: `v1` (tiền tố URL: `/api/v1`).

## Quy ước chung

### Cấu trúc phản hồi

Tất cả các endpoint API trả về dữ liệu theo cấu trúc chuẩn sau:

Thành công (`HTTP 200` hoặc `201`):

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-10-14T09:30:00.000Z",
    "requestId": "req_01HZX890ABCDEF"
  }
}
```

Thất bại (`HTTP 4xx` hoặc `5xx`):

```json
{
  "success": false,
  "error": {
    "code": "SEAT_ALREADY_HELD",
    "message": "Một hoặc nhiều ghế bạn chọn đang được giữ trong phiên khác.",
    "details": [
      {
        "field": "seatIds",
        "issue": "Ghế A-12 không khả dụng"
      }
    ]
  },
  "meta": {
    "timestamp": "2026-10-14T09:30:00.000Z",
    "requestId": "req_01HZX890ABCDEF"
  }
}
```

### Mã lỗi nghiệp vụ

| Mã lỗi                   | HTTP Status | Diễn giải                                                |
| :----------------------- | :---------- | :------------------------------------------------------- |
| `VALIDATION_ERROR`       | 400         | Dữ liệu đầu vào không hợp lệ                             |
| `UNAUTHORIZED`           | 401         | Thiếu JWT token hoặc token hết hạn/không hợp lệ          |
| `FORBIDDEN`              | 403         | Tài khoản không có quyền truy cập tài nguyên             |
| `ACCOUNT_LOCKED`         | 403         | Tài khoản bị tạm khóa 15 phút do nhập sai mật khẩu 5 lần |
| `ORGANIZER_NOT_VERIFIED` | 403         | Ban tổ chức chưa được quản trị viên duyệt hồ sơ          |
| `NOT_FOUND`              | 404         | Tài nguyên không tồn tại                                 |
| `SEAT_ALREADY_HELD`      | 409         | Ghế đã có người giữ hoặc đã bán                          |
| `CONFLICT_VERSION`       | 409         | Xung đột phiên bản dữ liệu khi cập nhật đồng thời        |
| `WAITING_ROOM_REQUIRED`  | 428         | Sự kiện đang bật hàng chờ, thiếu admission token         |
| `TOO_MANY_REQUESTS`      | 429         | Gửi yêu cầu vượt quá giới hạn tần suất cho phép          |
| `INTERNAL_SERVER_ERROR`  | 500         | Lỗi xử lý nội bộ phía máy chủ                            |

### Xác thực và phân quyền

- Access Token: JWT có thời hạn 15 phút, truyền qua header: `Authorization: Bearer <accessToken>`.
- Refresh Token: Lưu trong HTTP-Only Cookie (`SameSite=Strict`, `Secure`), thời hạn 7 ngày, áp dụng cơ chế token rotation khi gọi `/auth/refresh`.
- Khóa Idempotency: Với các yêu cầu tạo đơn, giữ chỗ, thanh toán hoặc hoàn tiền, client truyền header: `Idempotency-Key: <UUIDv4>`. Hệ thống đối chiếu bảng `idempotency_keys` trước khi thực thi.

## Danh sách endpoint

### Xác thực tài khoản (`/auth`)

#### `POST /api/v1/auth/check-identifier`

Kiểm tra định danh người dùng (email) đã tồn tại trong hệ thống hay chưa phục vụ luồng Identifier-first Auth.

- Quyền: Công khai
- Request body:

```json
{
  "identifier": "organizer@tickethub.vn"
}
```

- Response: `200 OK`

```json
{
  "success": true,
  "data": {
    "exists": true,
    "methods": ["password"]
  }
}
```

#### `POST /api/v1/auth/register`

Đăng ký tài khoản người mua hoặc ban tổ chức.

- Quyền: Công khai
- Request body:

```json
{
  "email": "nguyenan@example.com",
  "phone": "0912345678",
  "fullName": "Nguyễn Văn An",
  "password": "Password123!",
  "role": "BUYER"
}
```

- Response 201:

```json
{
  "success": true,
  "data": {
    "userId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "email": "nguyenan@example.com",
    "status": "PENDING_EMAIL",
    "message": "Liên kết kích hoạt đã được gửi tới email của bạn (hiệu lực 24 giờ)."
  }
}
```

#### `POST /api/v1/auth/verify-email`

Xác thực địa chỉ email.

- Request body: `{ "token": "string" }`
- Response 200: `{ "success": true, "data": { "status": "ACTIVE" } }`

#### `POST /api/v1/auth/login`

Đăng nhập hệ thống.

- Request body: `{ "email": "nguyenan@example.com", "password": "Password123!" }`
- Response 200:

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOi...",
    "expiresIn": 900,
    "user": {
      "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "email": "nguyenan@example.com",
      "fullName": "Nguyễn Văn An",
      "role": "BUYER",
      "status": "ACTIVE"
    }
  }
}
```

#### `POST /api/v1/auth/refresh`

Làm mới Access Token thông qua Refresh Token từ cookie.

- Response 200: `{ "success": true, "data": { "accessToken": "...", "expiresIn": 900 } }`

#### `POST /api/v1/auth/logout`

Thu hồi Refresh Token và xóa cookie phiên đăng nhập.

- Response 200: `{ "success": true, "data": { "message": "Đăng xuất thành công" } }`

#### `GET /api/v1/auth/me`

Lấy thông tin người dùng đang đăng nhập thông qua Access Token Bearer.

- Header: `Authorization: Bearer <accessToken>`
- Response 200:
  ```json
  {
    "success": true,
    "data": {
      "id": "u-uuid",
      "email": "user@tickethub.vn",
      "fullName": "Nguyen Van A",
      "role": "buyer",
      "isVerified": true
    }
  }
  ```

### Tìm kiếm và chi tiết sự kiện (`/events`)

#### `GET /api/v1/events`

Tìm kiếm và lọc danh sách sự kiện, phân trang theo cursor.

- Tham số truy vấn:
  - `keyword`: string (tìm kiếm tiếng Việt có dấu hoặc không dấu)
  - `city`: string
  - `category`: string
  - `fromDate`: chuỗi ISO 8601
  - `toDate`: chuỗi ISO 8601
  - `minPrice`: số
  - `maxPrice`: số
  - `cursor`: UUID của sự kiện mốc
  - `limit`: số lượng bản ghi (mặc định 20, tối đa 50)
- Response 200:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "e1-uuid",
        "title": "Liveshow Âm Nhạc Mùa Thu 2026",
        "slug": "liveshow-am-nhac-mua-thu-2026",
        "bannerUrl": "https://cdn.tickethub.vn/banners/show1.webp",
        "venueName": "Trung tâm Hội nghị Quốc gia",
        "city": "Hà Nội",
        "startTime": "2026-11-20T19:30:00Z",
        "minPrice": 500000,
        "maxPrice": 2500000,
        "isSoldOut": false
      }
    ],
    "nextCursor": "e2-uuid",
    "hasMore": true
  }
}
```

#### `GET /api/v1/events/:slug`

Lấy chi tiết sự kiện phục vụ SSR.

- Response 200: Chi tiết sự kiện kèm danh sách các hạng vé (`ticketTypes`).

#### `GET /api/v1/events/:id/seatmap`

Lấy sơ đồ phân bố khu vực, hàng ghế và trạng thái chỗ ngồi (dùng cho hiển thị trực quan bản đồ SVG; hệ thống áp dụng tự động phân bổ ghế liền kề khi đặt vé chứ không yêu cầu người dùng chọn từng vị trí thủ công).

- Response 200:

```json
{
  "success": true,
  "data": {
    "eventId": "e1-uuid",
    "zones": [
      {
        "zoneName": "Khu VIP A",
        "isSeated": true,
        "ticketTypeId": "tt-vip-uuid",
        "rows": [
          {
            "rowLabel": "A",
            "seats": [
              {
                "id": "s1-uuid",
                "seatNumber": "01",
                "status": "AVAILABLE",
                "price": 2500000
              },
              {
                "id": "s2-uuid",
                "seatNumber": "02",
                "status": "HELD",
                "price": 2500000
              },
              {
                "id": "s3-uuid",
                "seatNumber": "03",
                "status": "SOLD",
                "price": 2500000
              }
            ]
          }
        ]
      }
    ]
  }
}
```

#### `GET /api/v1/events/:id/inventory`

Lấy thông tin tồn kho và số lượng vé còn lại của từng hạng vé trong sự kiện.

- Response 200:
  ```json
  {
    "success": true,
    "data": {
      "eventId": "e-uuid",
      "ticketTypes": [
        {
          "id": "tt-uuid",
          "name": "VIP",
          "price": 2500000,
          "totalCapacity": 100,
          "availableCapacity": 42
        }
      ]
    }
  }
  ```

#### `GET /api/v1/events/:id/seats/stream` (SSE) [PLANNED]

Cập nhật trạng thái ghế theo thời gian thực.

- Tên sự kiện: `seat_status_changed`
- Dữ liệu gửi về:

```json
{
  "seatIds": ["s2-uuid"],
  "status": "HELD",
  "expiresAt": "2026-10-14T09:35:00.000Z"
}
```

### [PLANNED] Địa điểm chuẩn và Sơ đồ SVG (`/venues`)

#### [PLANNED] `GET /api/v1/venues`

Lấy danh mục các địa điểm tổ chức chuẩn (Curated Venues) đã được quản trị viên kiểm duyệt, hỗ trợ lọc theo 3 thành phố lớn, thể loại và tìm kiếm từ khóa.

- Quyền: Công khai / Ban tổ chức
- Tham số truy vấn:
  - `city`: string (`TP. Hồ Chí Minh`, `Hà Nội`, `Đà Nẵng`)
  - `category`: string (`stadium`, `arena`, `theater`, `sports`)
  - `search`: string (tìm theo tên sân, quận huyện, địa chỉ)
- Response 200:

```json
{
  "success": true,
  "data": [
    {
      "id": "vn-hn-my-dinh",
      "name": "Sân Vận Động Quốc Gia Mỹ Đình",
      "shortName": "SVĐ Mỹ Đình",
      "city": "Hà Nội",
      "district": "Quận Nam Từ Liêm",
      "address": "Đường Lê Đức Thọ, Phường Mỹ Đình 1, Quận Nam Từ Liêm, Hà Nội",
      "category": "stadium",
      "categoryLabel": "Sân vận động quốc gia",
      "totalCapacity": "40.000 chỗ",
      "thumbnailUrl": "/images/events/vn/vleague-cahn.jpg",
      "description": "Công trình thể thao và biểu diễn quy mô lớn nhất Việt Nam với 4 khán đài đồ sộ.",
      "featuredEvents": "Đội tuyển Quốc gia Việt Nam, Born Pink World Tour",
      "layouts": [
        {
          "id": "layout-stadium-concert",
          "name": "Mega Concert Sân Vận Động",
          "categoryName": "Đại nhạc hội / Festival ngoài trời",
          "mapKey": "stadium-concert",
          "capacityEstimate": "30.000 - 50.000 chỗ"
        },
        {
          "id": "layout-stadium-football",
          "name": "Sân Bóng Đá (Chuẩn Thi Đấu FIFA)",
          "categoryName": "Bóng đá / Giải V-League & Quốc tế",
          "mapKey": "stadium-football",
          "capacityEstimate": "20.000 - 45.000 chỗ"
        }
      ]
    }
  ]
}
```

#### [PLANNED] `GET /api/v1/venues/:id`

Lấy chi tiết một địa điểm chuẩn kèm tất cả cấu hình sơ đồ khán đài SVG và phân khu mặc định.

- Response 200: Chi tiết địa điểm và danh sách các layout có sẵn (`layouts` kèm `defaultZones`).

#### [PLANNED] `GET /api/v1/venues/:id/layouts`

Lấy danh sách các mẫu sơ đồ khán đài của địa điểm kèm danh sách `defaultZones` tương thích với `data-zone` trong tệp SVG.

- Response 200: Danh sách sơ đồ khán đài kiến trúc kèm ước lượng sức chứa và cấu hình phân khu.

### Hàng chờ ảo (`/waiting-room`)

#### `POST /api/v1/waiting-room/:eventId/join`

Gia nhập hàng chờ trước khi vào màn hình giữ chỗ và mua vé.

- Header: `Authorization: Bearer <accessToken>`
- Response 200 (khi số người mua vé đồng thời còn dưới ngưỡng `MAX_ACTIVE`):

```json
{
  "success": true,
  "data": {
    "status": "ADMITTED",
    "admissionToken": "jwt_token_valid_10_minutes"
  }
}
```

- Response 202 (khi phải xếp hàng):

```json
{
  "success": true,
  "data": {
    "status": "QUEUED",
    "queuePosition": 142,
    "estimatedWaitSeconds": 90,
    "queueId": "q_user_uuid_event_uuid"
  }
}
```

#### `POST /api/v1/waiting-room/:eventId/heartbeat`

Gửi tín hiệu duy trì vị trí hàng chờ mỗi 15 giây.

- Request body: `{ "queueId": "q_user_uuid_event_uuid" }`
- Response 200: `{ "success": true, "data": { "queuePosition": 120, "estimatedWaitSeconds": 75 } }`

### Đặt và giữ chỗ vé (`/booking`)

#### `POST /api/v1/booking/hold`

Giữ chỗ vé trong thời hạn 5 phút với cơ chế tự động phân bổ ghế liền kề (Auto Seat Allocation) cho vé có số ghế.

- Quyền: Người mua vé (`BUYER`). Nghiêm cấm tài khoản Quản trị viên (`ADMIN`) và Ban tổ chức (`ORGANIZER`) thực hiện giữ chỗ hoặc mua vé.
- Header:
  - `Authorization: Bearer <accessToken>`
  - `Idempotency-Key: <UUID>`
  - `X-Admission-Token: <token>` (khi sự kiện bật hàng chờ)
- Cơ chế phân bổ: Người mua chọn hạng vé (`ticketTypeId`) và số lượng vé (`quantity`). Hệ thống tự động tìm và cấp các ghế còn trống liền kề trong cùng một hàng. Nếu hàng bị phân mảnh, hệ thống tự động quét và ưu tiên hàng có đủ ghế liền kề tiếp theo trong cùng hạng vé.
- Request body:

```json
{
  "eventId": "e1-uuid",
  "items": [{ "ticketTypeId": "tt-vip-uuid", "quantity": 2 }]
}
```

_Lưu ý: Hệ thống vẫn hỗ trợ tương thích trường hợp client chỉ định trực tiếp `seatId`:_

```json
{
  "eventId": "e1-uuid",
  "items": [
    { "seatId": "s1-uuid", "ticketTypeId": "tt-vip-uuid" },
    { "seatId": "s2-uuid", "ticketTypeId": "tt-vip-uuid" }
  ]
}
```

- Response 201:

```json
{
  "success": true,
  "data": {
    "orderId": "ord-uuid",
    "orderCode": "ORD-20261014-ABC12",
    "heldSeats": ["s1-uuid", "s2-uuid"],
    "allocatedSeats": [
      {
        "id": "s1-uuid",
        "zoneName": "Khu VIP A",
        "rowLabel": "A",
        "seatNumber": "01",
        "ticketTypeId": "tt-vip-uuid"
      },
      {
        "id": "s2-uuid",
        "zoneName": "Khu VIP A",
        "rowLabel": "A",
        "seatNumber": "02",
        "ticketTypeId": "tt-vip-uuid"
      }
    ],
    "totalAmount": 5000000,
    "holdExpiresAt": "2026-10-14T09:35:00.000Z",
    "remainingSeconds": 300
  }
}
```

- Response 400: Mã lỗi `INSUFFICIENT_TICKET_CAPACITY` nếu số lượng ghế trống khả dụng không đủ đáp ứng số lượng vé yêu cầu.
- Response 403: Mã lỗi `FORBIDDEN_RESOURCE` nếu tài khoản có vai trò `ADMIN`, `ORGANIZER` hoặc `GATE_STAFF` gửi yêu cầu giữ chỗ.
- Response 409: Mã lỗi `SEAT_ALREADY_HELD` nếu các vị trí ghế được chọn gặp xung đột khóa đồng thời sau các lượt thử lại (retry limit).

#### `POST /api/v1/booking/release`

Hủy giữ chỗ chủ động khi người dùng rời màn hình thanh toán.

- Quyền: Người mua vé (`BUYER`)
- Request body: `{ "orderId": "ord-uuid" }`
- Response 200: `{ "success": true, "data": { "message": "Đã giải phóng ghế" } }`

#### `GET /api/v1/booking/orders/:orderId`

Xem chi tiết đơn hàng giữ chỗ hiện tại và thời gian đếm ngược còn lại.

- Header: `Authorization: Bearer <accessToken>`
- Response 200:
  ```json
  {
    "success": true,
    "data": {
      "orderId": "ord-uuid",
      "status": "PENDING",
      "totalAmount": 5000000,
      "expiresAt": "2026-10-14T09:35:00.000Z",
      "items": [
        {
          "ticketTypeId": "tt-vip-uuid",
          "quantity": 2,
          "seats": ["VIP-A01", "VIP-A02"]
        }
      ]
    }
  }
  ```

### Quản lý đơn hàng người mua (`/buyer/orders`)

#### `GET /api/v1/buyer/orders`

Lấy danh sách lịch sử đơn hàng của người mua đang đăng nhập.

- Quyền: `BUYER`, `ADMIN`
- Header: `Authorization: Bearer <accessToken>`
- Query params:
  - `page` (optional, mặc định: 1)
  - `limit` (optional, mặc định: 10, tối đa: 50)
  - `status` (optional: `PENDING`, `PAID`, `CANCELLED`, `REFUNDED`)
- Response 200: Danh sách đơn hàng tóm tắt kèm thông tin sự kiện, tổng tiền và số lượng vé.

#### `GET /api/v1/buyer/orders/:id`

Xem chi tiết chuyên sâu của một đơn hàng.

- Quyền: `BUYER` (chỉ xem đơn của chính mình), `ADMIN` (xem mọi đơn hàng)
- Header: `Authorization: Bearer <accessToken>`
- Path param: `id` (UUID của đơn hàng)
- Response 200: Chi tiết đơn hàng, sự kiện, các hạng vé, danh sách vé điện tử kèm vị trí ghế (hoặc GA vé đứng không nhãn N/A), và lịch sử hoàn tiền.
- Lỗi 403: `ACCESS_DENIED` nếu người dùng không phải chủ sở hữu đơn hàng (ngăn chặn IDOR).
- Lỗi 404: `ORDER_NOT_FOUND` nếu đơn hàng không tồn tại.

### Thanh toán VNPay (`/payments`)

#### `POST /api/v1/payments/orders/:orderId/vnpay`

Khởi tạo giao dịch thanh toán VNPay và nhận URL chuyển hướng đến cổng thanh toán VNPay.

- Header: `Authorization: Bearer <accessToken>`
- Response 200:
  ```json
  {
    "success": true,
    "data": {
      "paymentUrl": "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?..."
    }
  }
  ```

#### `GET /api/v1/payments/vnpay/ipn`

Endpoint nhận webhook IPN (Instant Payment Notification) từ cổng thanh toán VNPay để cập nhật trạng thái đơn hàng thành công.

- Tham số: Toàn bộ query params từ VNPay (`vnp_TxnRef`, `vnp_Amount`, `vnp_ResponseCode`, `vnp_SecureHash`, ...)
- Response 200: `{"RspCode": "00", "Message": "Confirm Success"}`

#### `GET /api/v1/internal/vnpay/ipn-preview`

Endpoint nội bộ hỗ trợ quản trị viên và hệ thống xem trước quyết định xử lý IPN mà không thay đổi dữ liệu thật.

- Response 200:
  ```json
  {
    "success": true,
    "data": {
      "decision": "ACCEPT",
      "orderId": "ord-uuid"
    }
  }
  ```

### [PLANNED] Thanh toán dự phòng (`/checkout`)

#### [PLANNED] `POST /api/v1/checkout/create-payment`

Khởi tạo giao dịch thanh toán và lấy URL cổng VNPay.

- Quyền: Người mua vé (`BUYER`). Nghiêm cấm tài khoản Quản trị viên (`ADMIN`) và Ban tổ chức (`ORGANIZER`) thanh toán mua vé.
- Header: `Authorization: Bearer <accessToken>`, `Idempotency-Key: <UUID>`
- Request body:

```json
{
  "orderId": "ord-uuid",
  "voucherCode": "GIAM50K",
  "bankCode": "NCB"
}
```

- Response 200:

```json
{
  "success": true,
  "data": {
    "paymentUrl": "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?...",
    "orderCode": "ORD-20261014-ABC12",
    "finalAmount": 4950000,
    "expiresAt": "2026-10-14T09:35:00.000Z"
  }
}
```

#### [PLANNED] `GET /api/v1/webhooks/vnpay/ipn`

Webhook tiếp nhận thông báo kết quả từ cổng VNPay.

- Tham số truy vấn: Toàn bộ tham số do VNPay gửi (`vnp_TxnRef`, `vnp_Amount`, `vnp_ResponseCode`, `vnp_SecureHash`,...).
- Phản hồi trả lại VNPay:
  - Thành công: `{"RspCode": "00", "Message": "Confirm Success"}`
  - Sai chữ ký: `{"RspCode": "97", "Message": "Invalid Signature"}`
  - Không tìm thấy đơn: `{"RspCode": "01", "Message": "Order not found"}`

### Vé điện tử và soát vé (`/tickets` và `/gate`)

#### `GET /api/v1/tickets/my-tickets`

Lấy danh sách vé đã mua của người dùng đăng nhập.

- Quyền: `BUYER`, `ADMIN`
- Header: `Authorization: Bearer <accessToken>`
- Query params:
  - `page` (optional, mặc định: 1)
  - `limit` (optional, mặc định: 20, tối đa: 100)
  - `status` (optional: `SOLD`, `CHECKED_IN`, `CANCELLED`; mặc định: chỉ lấy `SOLD` và `CHECKED_IN`)
  - `eventId` (optional: lọc theo UUID sự kiện)
- Sắp xếp mặc định: `events.startTime ASC, tickets.id ASC`
- Response 200: Danh sách vé kèm thông tin sự kiện, vị trí ghế (hoặc GA vé đứng không nhãn N/A) và trạng thái.

#### `GET /api/v1/tickets/:id/qr`

Lấy mã QR động JWT ký số bằng thuật toán Ed25519 (chu kỳ làm mới 30 giây).

- Quyền: `BUYER` (chủ sở hữu vé) hoặc `ADMIN`
- Header: `Authorization: Bearer <accessToken>`
- Path param: `id` (UUID của vé)
- Điều kiện: Vé ở trạng thái `SOLD` và sự kiện đang ở trạng thái `PUBLISHED`.
- Response: `200 OK`

```json
{
  "ticketId": "3fd0bca3-cea0-4eff-b8aa-76329dfd0e4f",
  "qrToken": "eyJhbGciOiJFZERTQSI...",
  "expiresAt": "2026-11-20T17:30:30.000Z",
  "remainingSeconds": 30
}
```

Nội dung giải mã của `qrToken` (Ed25519 JWS Payload):

```json
{
  "sub": "3fd0bca3-cea0-4eff-b8aa-76329dfd0e4f",
  "eventId": "071bb3bc-3264-4e42-afb2-20a91282a182",
  "orderId": "3aff9a01-7078-4e84-9e4f-4857ca03c932",
  "userId": "165a34d9-64d9-42c7-a9a1-e8034a632f16",
  "iat": 1795195800,
  "exp": 1795195830,
  "nonce": "a7b3c2d1-e4f5-6a7b-8c9d-0e1f2a3b4c5d"
}
```

#### `POST /api/v1/gate/scan`

Nhân viên soát vé quét mã QR động tại cổng vào sự kiện. Thực hiện cập nhật trạng thái vé nguyên tử (`SOLD` -> `CHECKED_IN`).

- Quyền: `GATE_STAFF` (được phân công cho sự kiện trong `event_staff`) hoặc `ADMIN`
- Header: `Authorization: Bearer <staffToken>`
- Request body:

```json
{
  "qrToken": "eyJhbGciOiJFZERTQSI...",
  "gateId": "7b82fe51-4029-4d2c-9a3b-285b001a1d12"
}
```

- Response: `200 OK` (soát vé thành công)

```json
{
  "ticketId": "3fd0bca3-cea0-4eff-b8aa-76329dfd0e4f",
  "ticketCode": "TK1_c5837da3336143918702fc862f87",
  "status": "CHECKED_IN",
  "eventTitle": "Đại Nhạc Hội Mùa Hè 2026",
  "ticketTypeName": "VIP Diamond",
  "zoneName": "Khu VIP Diamond",
  "seatLabel": "Hàng A - Ghế 01",
  "isSeated": true,
  "buyerName": "Nguyễn Văn Mua",
  "checkedInAt": "2026-11-20T18:15:22.000Z",
  "gateId": "7b82fe51-4029-4d2c-9a3b-285b001a1d12",
  "staffId": "9a8b7c6d-5e4f-3a2b-1c0d-e9f8a7b6c5d4"
}
```

- Response: `409 Conflict` (vé đã được sử dụng trước đó):

```json
{
  "statusCode": 409,
  "message": "TICKET_ALREADY_USED: Ticket was already checked in at 2026-11-20T18:02:11.000Z by staff 9a8b7c6d-5e4f-3a2b-1c0d-e9f8a7b6c5d4"
}
```

- Response: `403 Forbidden` (nhân viên không được phân công cho sự kiện):

```json
{
  "statusCode": 403,
  "message": "STAFF_NOT_ASSIGNED_TO_EVENT: Gate staff is not assigned to this event"
}
```

#### `POST /api/v1/gate/lookup`

Tra cứu thủ công vé dự phòng bằng mã vé tĩnh 32 ký tự kết hợp 4 chữ số cuối của Số điện thoại hoặc Email khi khách gặp sự cố thiết bị (hết pin, vỡ màn hình, mất mạng). Bắt buộc ghi nhận nhật ký kiểm toán bất biến vào `audit_log`.

- Quyền: `GATE_STAFF` (được phân công cho sự kiện) hoặc `ADMIN`
- Header: `Authorization: Bearer <staffToken>`
- Request body:

```json
{
  "eventId": "071bb3bc-3264-4e42-afb2-20a91282a182",
  "ticketCode": "LK6_a7b3c2d1e4f56a7b8c9d0e1f2a3b",
  "phoneOrEmailLast4": "4567",
  "reason": "Khách hết pin điện thoại tại cổng",
  "gateId": "7b82fe51-4029-4d2c-9a3b-285b001a1d12"
}
```

- Response: `200 OK`

```json
{
  "ticketId": "3fd0bca3-cea0-4eff-b8aa-76329dfd0e4f",
  "ticketCode": "LK6_a7b3c2d1e4f56a7b8c9d0e1f2a3b",
  "status": "CHECKED_IN",
  "eventTitle": "Đại Nhạc Hội Mùa Hè 2026",
  "ticketTypeName": "VIP Diamond",
  "zoneName": "Khu VIP Diamond",
  "seatLabel": "Hàng A - Ghế 01",
  "isSeated": true,
  "buyerName": "Nguyễn Văn Mua",
  "checkedInAt": "2026-11-20T18:18:00.000Z",
  "gateId": "7b82fe51-4029-4d2c-9a3b-285b001a1d12",
  "staffId": "9a8b7c6d-5e4f-3a2b-1c0d-e9f8a7b6c5d4",
  "method": "MANUAL_LOOKUP"
}
```

- Response: `400 Bad Request` (xác minh 4 số cuối thất bại):

```json
{
  "statusCode": 400,
  "message": "VERIFICATION_FAILED: Last 4 digits of phone or email do not match attendee record"
}
```

### [PLANNED] Hủy vé và hoàn tiền (`/refund`)

#### [PLANNED] `POST /api/v1/refund/preview`

Tính trước số tiền hoàn lại theo chính sách trước khi xác nhận.

- Request body: `{ "ticketId": "tkt-uuid" }`
- Response 200:

```json
{
  "success": true,
  "data": {
    "ticketPrice": 2500000,
    "refundPercentage": 70,
    "refundAmount": 1750000,
    "feeDeducted": 750000,
    "policyApplied": "Hủy trước sự kiện 3-7 ngày (hoàn 70%)"
  }
}
```

#### [PLANNED] `POST /api/v1/refund/request`

Gửi yêu cầu hủy vé.

- Header: `Authorization: Bearer <accessToken>`, `Idempotency-Key: <UUID>`
- Request body: `{ "ticketId": "tkt-uuid", "reason": "Bận việc đột xuất" }`
- Response 200: `{ "success": true, "data": { "refundId": "ref-uuid", "status": "PROCESSING" } }`

### Quản trị hệ thống (`/admin`)

#### `GET /api/v1/admin/organizers`

Lấy danh sách hồ sơ ban tổ chức đang chờ quản trị viên phê duyệt (trạng thái `PENDING_VERIFICATION`).

- Header: `Authorization: Bearer <adminToken>`
- Response 200:

```json
{
  "success": true,
  "data": [
    {
      "id": "org-uuid",
      "userId": "usr-uuid",
      "organizationName": "Công ty TNHH Sự Kiện Âm Nhạc",
      "representativeName": "Nguyễn Văn A",
      "taxCode": "0101234567",
      "businessLicenseUrl": "https://media.tickethub.vn/licenses/lic-123.jpg",
      "status": "PENDING_VERIFICATION",
      "version": 1,
      "createdAt": "2026-10-22T08:00:00.000Z",
      "email": "btc@concert.vn"
    }
  ],
  "meta": {
    "total": 1
  }
}
```

#### `POST /api/v1/admin/organizers/:id/approve`

Phê duyệt hồ sơ ban tổ chức chuyển sang trạng thái `VERIFIED`.

- Header: `Authorization: Bearer <adminToken>`
- Request body (tùy chọn): `{ "version": 1 }`
- Response 200: Hồ sơ chuyển trạng thái `VERIFIED` và tự động ghi outbox gửi email thông báo.

#### `POST /api/v1/admin/organizers/:id/reject`

Từ chối hồ sơ ban tổ chức chuyển sang trạng thái `REJECTED` kèm lý do.

- Header: `Authorization: Bearer <adminToken>`
- Request body: `{ "reason": "Giấy phép kinh doanh không khớp", "version": 1 }`
- Response 200: Hồ sơ chuyển trạng thái `REJECTED`.

#### `POST /api/v1/admin/organizers/:id/review`

Duyệt hoặc từ chối hồ sơ ban tổ chức (alias hợp nhất).

- Header: `Authorization: Bearer <adminToken>`
- Request body:

```json
{
  "decision": "APPROVE",
  "version": 1
}
```

hoặc

```json
{
  "decision": "REJECT",
  "reason": "Mã số thuế không hợp lệ",
  "version": 1
}
```

- Response 200: Trả về thông tin hồ sơ đã cập nhật.

#### `GET /api/v1/admin/events`

Lấy danh sách sự kiện đang chờ quản trị viên phê duyệt (trạng thái `PENDING_APPROVAL`).

- Header: `Authorization: Bearer <adminToken>`
- Response 200:

```json
{
  "success": true,
  "data": [
    {
      "id": "evt-uuid",
      "title": "Liveshow Âm Nhạc 2026",
      "organizerId": "org-uuid",
      "organizationName": "Công ty Âm Nhạc",
      "status": "PENDING_APPROVAL",
      "version": 1,
      "startTime": "2026-11-20T19:00:00.000Z",
      "createdAt": "2026-10-22T09:00:00.000Z"
    }
  ],
  "meta": {
    "total": 1
  }
}
```

#### `POST /api/v1/admin/events/:id/approve`

Phê duyệt sự kiện chuyển sang trạng thái `PUBLISHED`.

- Header: `Authorization: Bearer <adminToken>`
- Request body (tùy chọn): `{ "version": 1 }`
- Response 200: Sự kiện chuyển trạng thái `PUBLISHED` và tạo outbox gửi email thông báo.

#### `POST /api/v1/admin/events/:id/reject`

Từ chối sự kiện chuyển về trạng thái `DRAFT` kèm lý do để ban tổ chức chỉnh sửa.

- Header: `Authorization: Bearer <adminToken>`
- Request body: `{ "reason": "Sơ đồ ghế thiếu lối thoát hiểm", "version": 1 }`
- Response 200: Sự kiện chuyển `DRAFT`.

#### `POST /api/v1/admin/events/:id/review`

Duyệt hoặc từ chối sự kiện (alias hợp nhất).

- Header: `Authorization: Bearer <adminToken>`
- Request body:

```json
{
  "decision": "APPROVE",
  "version": 1
}
```

hoặc

```json
{
  "decision": "REJECT",
  "reason": "Thiếu thông tin hạng vé",
  "version": 1
}
```

- Response 200: Trả về thông tin sự kiện đã cập nhật.

#### `POST /api/v1/admin/events/:id/kill-switch`

Kích hoạt dừng khẩn cấp sự kiện vi phạm (Emergency Kill Switch). Chuyển trạng thái sự kiện sang `SUSPENDED`, hủy toàn bộ các đơn hàng chưa thanh toán (`PENDING` sang `CANCELLED`), giải phóng toàn bộ ghế ngồi đang bị giữ (`HELD` sang `AVAILABLE`), reset số lượng giữ vé đứng GA về 0, xóa cache sự kiện trên Redis và ghi nhật ký kiểm toán bất biến `audit_log`.

- Quyền: `ADMIN`
- Header: `Authorization: Bearer <adminToken>`
- Request body:

```json
{
  "reason": "Phát hiện thông tin giả mạo hoặc sự cố an ninh nghiêm trọng",
  "version": 1
}
```

- Response: `200 OK`

```json
{
  "success": true,
  "data": {
    "eventId": "evt-uuid",
    "status": "SUSPENDED",
    "rejectionReason": "Phát hiện thông tin giả mạo hoặc sự cố an ninh nghiêm trọng",
    "version": 2,
    "cancelledPendingOrdersCount": 3,
    "releasedHeldSeatsCount": 2,
    "releasedHeldStandingCount": 5,
    "totalReleasedHoldsCount": 7,
    "suspendedAt": "2026-11-20T19:30:00.000Z"
  }
}
```

#### `POST /api/v1/admin/events/:id/resume`

Khôi phục mở bán sự kiện đã bị đình chỉ trở lại trạng thái `PUBLISHED` sau khi ban tổ chức giải trình và khắc phục xong vi phạm. Chỉ áp dụng cho sự kiện chưa kết thúc (`endTime > NOW()`).

- Quyền: `ADMIN`
- Header: `Authorization: Bearer <adminToken>`
- Request body (tùy chọn):

```json
{
  "reason": "Ban tổ chức đã bổ sung đầy đủ giấy phép biểu diễn hợp lệ",
  "version": 2
}
```

- Response: `200 OK`

```json
{
  "success": true,
  "data": {
    "eventId": "evt-uuid",
    "status": "PUBLISHED",
    "version": 3,
    "resumedAt": "2026-11-20T20:00:00.000Z"
  }
}
```

#### `GET /api/v1/admin/events/:id/audit-logs`

Truy vấn danh sách lịch sử kiểm toán bất biến theo sự kiện phục vụ trang điều khiển khẩn cấp `/admin/events/[id]/control`.

- Quyền: `ADMIN`
- Header: `Authorization: Bearer <adminToken>`
- Query params:
  - `page`: Số trang (mặc định 1)
  - `limit`: Số bản ghi mỗi trang (mặc định 20, tối đa 100)
  - `action`: Lọc theo loại hành động kiểm toán (tùy chọn)
- Response: `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 12,
        "actorId": "admin-uuid",
        "actorRole": "ADMIN",
        "action": "EVENT_KILL_SWITCH_ACTIVATED",
        "targetType": "EVENT",
        "targetId": "evt-uuid",
        "changes": {
          "oldStatus": "PUBLISHED",
          "newStatus": "SUSPENDED",
          "reason": "Phát hiện thông tin giả mạo",
          "cancelledPendingOrdersCount": 3,
          "releasedHeldSeatsCount": 2,
          "releasedHeldStandingCount": 5,
          "totalReleasedHoldsCount": 7
        },
        "ipAddress": "127.0.0.1",
        "userAgent": "Mozilla/5.0 ...",
        "createdAt": "2026-11-20T19:30:00.000Z"
      }
    ],
    "meta": {
      "total": 1,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    }
  }
}
```

#### [PLANNED] `GET /api/v1/admin/reconciliations`

Lấy danh sách đối soát giao dịch với dữ liệu VNPay.

- Response 200: Danh sách giao dịch khớp và các bản ghi phát hiện chênh lệch.

#### [PLANNED] `POST /api/v1/admin/payouts/:id/approve`

Xác nhận phê duyệt lệnh chi trả tiền bán vé cho ban tổ chức.

- Response 200: Lệnh chi trả chuyển trạng thái `PAID_OUT`.

#### [PLANNED] `POST /api/v1/admin/venues`

Quản trị viên tạo mới hoặc nhập một địa điểm tổ chức chuẩn vào hệ thống.

- Header: `Authorization: Bearer <adminToken>`
- Request body:

```json
{
  "name": "Cung Thể Thao Tiên Sơn (Đĩa Bay)",
  "shortName": "Cung Tiên Sơn",
  "city": "Đà Nẵng",
  "district": "Quận Hải Châu",
  "address": "Đường Phan Đăng Lưu, Phường Hòa Cường Bắc, Quận Hải Châu, Đà Nẵng",
  "category": "arena",
  "totalCapacity": "7.500 chỗ",
  "thumbnailUrl": "/images/events/vn/anh-trai.jpg",
  "description": "Kiến trúc độc đáo hình đĩa bay nổi tiếng bên bờ sông Hàn."
}
```

- Response 201:

```json
{
  "success": true,
  "data": {
    "id": "vn-danang-tien-son",
    "isCreated": true,
    "message": "Địa điểm chuẩn đã được tạo và kích hoạt."
  }
}
```

#### [PLANNED] `POST /api/v1/admin/venues/:id/layouts`

Quản trị viên liên kết mẫu sơ đồ SVG đã chuẩn hóa (hoặc tải lên SVG mới) cho địa điểm tổ chức.

- Header: `Authorization: Bearer <adminToken>`
- Request body:

```json
{
  "name": "Sân Khấu Chữ T (Live Concert)",
  "categoryName": "Âm nhạc / Live Concert",
  "mapKey": "arena-t-stage",
  "capacityEstimate": "8.000 - 15.000 chỗ",
  "defaultZones": [
    {
      "zoneId": "495",
      "name": "VIP Đặc Biệt",
      "price": 2500000,
      "capacity": 1200,
      "isSeated": true
    },
    {
      "zoneId": "496",
      "name": "VIP Vàng",
      "price": 1900000,
      "capacity": 2500,
      "isSeated": true
    }
  ]
}
```

- Response 201:

```json
{
  "success": true,
  "data": {
    "layoutId": "layout-arena-t-stage",
    "status": "ACTIVE"
  }
}
```

#### [PLANNED] `PUT /api/v1/admin/venues/:id`

Quản trị viên cập nhật thông tin địa điểm hoặc tạm ngưng khả dụng.

- Header: `Authorization: Bearer <adminToken>`
- Request body: `{ "isActive": false }`
- Response 200: `{ "success": true, "data": { "message": "Cập nhật địa điểm thành công" } }`

---

### Tải lên tệp đa phương tiện (`/uploads`)

#### `POST /api/v1/uploads/event-image/presign`

Tạo presigned URL để ban tổ chức tải ảnh trực tiếp lên bộ lưu trữ đám mây (S3/R2).

- Header: `Authorization: Bearer <organizerToken>`
- Request body:

```json
{
  "filename": "banner-concert.jpg",
  "contentType": "image/jpeg",
  "sizeBytes": 2097152
}
```

- Response 200:

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://s3.ap-southeast-1.amazonaws.com/tickethub-media/events/org-id/uuid.jpg?X-Amz-...",
    "key": "events/org-id/uuid.jpg",
    "publicUrl": "https://media.tickethub.vn/events/org-id/uuid.jpg",
    "method": "PUT",
    "headers": {
      "Content-Type": "image/jpeg"
    },
    "expiresIn": 300,
    "maxBytes": 5242880
  }
}
```

#### `POST /api/v1/uploads/event-image/confirm`

Xác thực tính hợp lệ của tệp ảnh sau khi ban tổ chức hoàn tất tải lên S3 (kiểm tra dung lượng, Content-Type và magic bytes).

- Header: `Authorization: Bearer <organizerToken>`
- Request body:

```json
{
  "key": "events/org-id/uuid.jpg"
}
```

- Response 200:

```json
{
  "success": true,
  "data": {
    "key": "events/org-id/uuid.jpg",
    "contentType": "image/jpeg",
    "sizeBytes": 2097152,
    "verified": true,
    "publicUrl": "https://media.tickethub.vn/events/org-id/uuid.jpg"
  }
}
```

---

### Quản lý sự kiện dành cho Ban tổ chức (`/organizer/events`)

#### `POST /api/v1/organizer/events`

Tạo sự kiện mới ở trạng thái bản nháp (`DRAFT`).

- Header: `Authorization: Bearer <organizerToken>`
- Request body: Schema `CreateEventRequestSchema` từ `@tickethub/shared`
- Response 201: Dữ liệu sự kiện mới tạo

#### `GET /api/v1/organizer/events`

Lấy danh sách các sự kiện do ban tổ chức đang đăng nhập sở hữu.

- Header: `Authorization: Bearer <organizerToken>`
- Response 200: Danh sách sự kiện kèm tổng số lượng bản ghi

#### `GET /api/v1/organizer/events/:id`

Lấy thông tin chi tiết một sự kiện của ban tổ chức để chỉnh sửa.

- Header: `Authorization: Bearer <organizerToken>`
- Response 200: Chi tiết sự kiện

#### `PUT /api/v1/organizer/events/:id`

Cập nhật thông tin sự kiện ở trạng thái bản nháp kèm trường `version` kiểm soát xung đột dữ liệu đồng thời.

- Header: `Authorization: Bearer <organizerToken>`
- Response 200: Chi tiết sự kiện đã cập nhật

#### `POST /api/v1/organizer/events/:id/seats/generate`

Tạo danh sách ghế tự động theo cấu hình khu vực và hàng ghế của ban tổ chức.

- Header: `Authorization: Bearer <organizerToken>`
- Request body: Cấu hình phân khu và số hàng ghế (`GenerateSeatsDto`)
- Response 200: Trạng thái khởi tạo ghế thành công

#### `POST /api/v1/organizer/events/:id/submit`

Ban tổ chức nộp sự kiện để quản trị viên phê duyệt (chuyển sang trạng thái `PENDING_APPROVAL`).

- Header: `Authorization: Bearer <organizerToken>`
- Response 200: Sự kiện chuyển trạng thái chờ duyệt

---

### Tìm kiếm sự kiện nâng cao (`/search`)

#### `GET /api/v1/search/events`

Tìm kiếm sự kiện có áp dụng giới hạn tốc độ truy vấn (Rate Limit: 30 requests / phút).

- Tham số truy vấn: `keyword`, `city`, `category`, `fromDate`, `toDate`, `page`, `limit`
- Response 200: Danh sách kết quả tìm kiếm kèm thông tin phân trang

---

### Kiểm tra sức khỏe hệ thống (`/health`)

#### `GET /api/v1/health`

Kiểm tra kết nối tới cơ sở dữ liệu PostgreSQL và máy chủ Redis Cache.

- Response 200 (khi cả PostgreSQL và Redis đều hoạt động bình thường):
  ```json
  {
    "status": "ok",
    "checks": {
      "database": "healthy",
      "redis": "healthy"
    }
  }
  ```
