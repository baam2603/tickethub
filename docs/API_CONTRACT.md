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

#### `GET /api/v1/events/:id/seats/stream` (SSE)

Cập nhật trạng thái ghế theo thời gian thực qua Redis Pub/Sub.

- Tên sự kiện: `seat_status_changed`
- Dữ liệu gửi về:

```json
{
  "seatIds": ["s2-uuid"],
  "status": "HELD",
  "expiresAt": "2026-10-14T09:35:00.000Z"
}
```

### Địa điểm chuẩn và Sơ đồ SVG (`/venues`)

#### `GET /api/v1/venues`

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

#### `GET /api/v1/venues/:id`

Lấy chi tiết một địa điểm chuẩn kèm tất cả cấu hình sơ đồ khán đài SVG và phân khu mặc định.

- Response 200: Chi tiết địa điểm và danh sách các layout có sẵn (`layouts` kèm `defaultZones`).

#### `GET /api/v1/venues/:id/layouts`

Lấy danh sách các mẫu sơ đồ khán đài của địa điểm kèm danh sách `defaultZones` tương thích với `data-zone` trong tệp SVG.

- Response 200: Danh sách sơ đồ khán đài kiến trúc kèm ước lượng sức chứa và cấu hình phân khu.

### Đặt và giữ chỗ vé (`/booking`)

#### `POST /api/v1/booking/hold`

Giữ chỗ vé trong thời hạn 5 phút với cơ chế tự động phân bổ ghế liền kề (Auto Seat Allocation) cho vé có số ghế.

- Quyền: Người mua vé (`BUYER`). Nghiêm cấm tài khoản Quản trị viên (`ADMIN`) và Ban tổ chức (`ORGANIZER`) thực hiện giữ chỗ hoặc mua vé.
- Header:
  - `Authorization: Bearer <accessToken>`
  - `Idempotency-Key: <UUID>`
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

- Header: `Authorization: Bearer <accessToken>`, tùy chọn `Idempotency-Key: <UUID>`.
- Số tiền chỉ lấy từ đơn và chi tiết đơn trong PostgreSQL, kiểm tra tổng tiền trừ giảm giá đã được server lưu. API này không tiếp nhận giá hoặc tự phê duyệt voucher từ client.
- Chỉ chủ đơn PENDING còn trên 45 giây giữ chỗ được tạo URL. Gọi lại tái sử dụng transaction và URL đã lưu; hạn URL bằng hạn giữ chỗ.
- Response 201:
  ```json
  {
    "success": true,
    "data": {
      "paymentUrl": "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?..."
    }
  }
  ```

#### `POST /api/v1/payments/orders/:orderId/vnpay/query`

Đối soát QueryDR khi client chưa nhận được kết quả IPN.

- Header: `Authorization: Bearer <accessToken>`. Chỉ chủ sở hữu đơn được gọi.
- Không nhận số tiền, merchant, URL hoặc mã giao dịch do client cung cấp.
- Response 201: `{ "success": true, "data": { "decision": "APPLY_SUCCESS", "responseCode": "00" } }`.
- `ALREADY_PROCESSED`: giao dịch đã được xử lý; `MANUAL_REVIEW`: kết quả chưa xác định; `AMOUNT_MISMATCH`: không khớp tiền.
- HTTP 400 nếu giao dịch cũ thiếu ngày tạo VNPay; HTTP 404 nếu không có giao dịch thuộc người gọi; HTTP 503 nếu VNPay lỗi, timeout hoặc phản hồi không xác minh được.
- Chỉ phản hồi QueryDR loại thanh toán `01` được đưa vào xử lý đơn. Kết quả hoàn tiền `02`/`03` không được dùng để cấp vé.

#### `GET /api/v1/payments/vnpay/ipn`

Endpoint nhận webhook IPN (Instant Payment Notification) từ cổng thanh toán VNPay để cập nhật trạng thái đơn hàng thành công.

- Tham số: Toàn bộ query params từ VNPay (`vnp_TxnRef`, `vnp_Amount`, `vnp_ResponseCode`, `vnp_SecureHash`, ...)
- Cần bật `ENABLE_VNPAY_IPN_PROCESSING=true`; mặc định endpoint tắt.
- Xác minh HMAC-SHA512, merchant, số tiền trước khi cập nhật; khóa order rồi transaction trong cùng transaction DB.
- IPN thành công đến muộn với đủ metadata: khôi phục toàn bộ vé nếu còn trống; nếu không đủ kho thì rollback phần khôi phục và chuyển đơn sang `PAYMENT_EXPIRED_REFUND_PENDING`, tạo một refund cùng sự kiện outbox `REFUND_REQUESTED`. Không gọi API hoàn tiền trong transaction DB.
- Giao dịch cũ thiếu ngày tạo, mã giao dịch VNPay hoặc ngày thanh toán hợp lệ được giữ ở `MANUAL_REVIEW` để tránh tự động xử lý dựa trên bằng chứng thiếu.
- Response 200: `{"RspCode": "00", "Message": "Confirm Success"}`; callback lặp trả `02`, sai chữ ký `97`, sai tiền `04`, không có đơn `01`, cần đối soát `99`.

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

### Hủy vé và hoàn tiền (`/refund`)

#### `POST /api/v1/refund/preview`

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

#### `POST /api/v1/refund/request`

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

#### `GET /api/v1/admin/reconciliations`

Lấy danh sách đối soát giao dịch giữa đơn hàng hệ thống và dữ liệu thanh toán VNPay.

- Header: `Authorization: Bearer <adminToken>`
- Query params: `eventId` (tùy chọn), `status` (`ALL`, `MATCHED`, `AMOUNT_MISMATCH`, `MISSING_TRANSACTION`, `ORPHAN_TRANSACTION`), `page`, `limit`
- Response 200: Danh sách giao dịch đối soát, phân loại trạng thái và khối thống kê tổng hợp `summary`.

#### `GET /api/v1/admin/payouts`

Lấy danh sách các lệnh quyết toán chi trả doanh thu cho Ban tổ chức trên toàn hệ thống.

- Header: `Authorization: Bearer <adminToken>`
- Query params: `status` (`PENDING`, `HOLD`, `PAID_OUT`), `organizerId`, `eventId`, `page`, `limit`
- Response 200: Danh sách lệnh chi trả kèm thông tin sự kiện và phân trang.

#### `POST /api/v1/admin/payouts/generate`

Tính toán doanh thu sự kiện, khấu trừ tiền hoàn vé, phí sàn (5%) và phí cổng VNPay (1.5%) để tạo hoặc cập nhật lệnh quyết toán ở trạng thái `PENDING`.

- Header: `Authorization: Bearer <adminToken>`
- Request body: `{ "eventId": "uuid-event" }`
- Response 200: Thông tin chi tiết lệnh quyết toán đã tính toán.

#### `POST /api/v1/admin/payouts/:id/approve`

Xác nhận phê duyệt lệnh chi trả tiền bán vé cho ban tổ chức.

- Header: `Authorization: Bearer <adminToken>`
- Response 200: Lệnh chi trả chuyển trạng thái `PAID_OUT` và ghi vết kiểm toán vào `audit_log`.

#### `POST /api/v1/admin/payouts/:id/hold`

Tạm giữ lệnh chi trả khi phát hiện khiếu nại hoặc tranh chấp vé.

- Header: `Authorization: Bearer <adminToken>`
- Request body: `{ "reason": "Phát hiện đơn hàng tranh chấp đang khiếu nại" }`
- Response 200: Lệnh chi trả chuyển trạng thái `HOLD` kèm lý do.

#### `POST /api/v1/admin/payouts/:id/recalculate`

Tính toán lại các con số doanh thu, tiền hoàn và phí cho lệnh chi trả đang ở trạng thái `PENDING` hoặc `HOLD`.

- Header: `Authorization: Bearer <adminToken>`
- Response 200: Lệnh chi trả với các con số cập nhật mới nhất.

#### `POST /api/v1/admin/venues`

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

#### `POST /api/v1/admin/venues/:id/layouts`

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

#### `PUT /api/v1/admin/venues/:id`

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

#### `GET /api/v1/organizer/payouts`

Ban tổ chức tra cứu danh sách các khoản quyết toán chi trả của các sự kiện do chính mình sở hữu.

- Header: `Authorization: Bearer <organizerToken>`
- Query params: `page`, `limit`
- Response 200: Danh sách các lệnh chi trả kèm số tiền thực nhận (`netPayout`) và trạng thái.

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

## Tuần 5 BE2: Nhân viên, lịch sử soát vé và báo cáo UC09

Các API `/organizer` bên dưới yêu cầu JWT của ORGANIZER đang ACTIVE và hồ sơ VERIFIED. Mọi tài nguyên được kiểm tra theo BTC sở hữu; truy cập tài nguyên của BTC khác trả 404. Không lấy organizerId từ body.

### Quản lý nhân viên

#### `POST /api/v1/organizer/staff`

Body: `{ "email": "staff@example.com", "fullName": "Nhân viên A", "password": "<tối thiểu 12 ký tự>", "phone": "0901234567" }`. Tạo tài khoản GATE_STAFF ACTIVE thuộc BTC. Response 201 gồm id, email, fullName, phone, status, createdAt; không trả mật khẩu/hash. Email trùng trả 409. Role không được truyền bởi client.

#### `GET /api/v1/organizer/staff`

Query `page` mặc định 1, `limit` mặc định 20, tối đa 100. Response 200: `{ "success": true, "data": [ ... ] }`, chỉ gồm nhân viên thuộc BTC hiện tại.

#### `PATCH /api/v1/organizer/staff/:staffId`

Body gồm các trường muốn sửa: fullName, phone, status (ACTIVE hoặc LOCKED). Không sửa role/email qua API này. Response 200 là thông tin nhân viên sau cập nhật. Khóa nhân viên khiến JWT cũ không còn dùng để soát vé được; giữ lịch sử soát vé.

#### `POST /api/v1/organizer/events/:eventId/gates`

Body: `{ "name": "Cổng A", "locationDesc": "Sảnh chính" }`. Response 201 là cổng mới của sự kiện thuộc BTC.

#### `GET /api/v1/organizer/events/:eventId/gates`

Response 200: data là mảng cổng, hỗ trợ page/limit (mặc định 1/100, tối đa 100 mỗi trang); meta ở ngoài data gồm page, limit, hasMore. Không giới hạn tổng ở 100 cổng.

#### `POST /api/v1/organizer/events/:eventId/staff`

Body: `{ "userId": "staff-uuid", "gateId": "gate-uuid" }`. Chỉ gán nhân viên ACTIVE do BTC quản lý vào cổng thuộc đúng sự kiện của BTC. Response 201 là phân công. Gọi lại cập nhật cổng của phân công hiện có, không tạo dòng trùng.

#### `GET /api/v1/organizer/events/:eventId/staff`

Response 200: data là mảng phân công, hỗ trợ page/limit (mặc định 1/100); meta gồm page, limit, hasMore. Không trả passwordHash.

#### `DELETE /api/v1/organizer/events/:eventId/staff/:staffId`

Gỡ phân công, không xóa tài khoản hay lịch sử. Response 200: `{ "success": true, "data": { "removed": true } }`. Yêu cầu soát vé tiếp theo của nhân viên phải bị từ chối.

### Bổ sung hợp đồng soát vé

`POST /api/v1/gate/lookup` hỗ trợ hai cách đối chiếu:

- `ticketCode` + `phoneOrEmailLast4` chứa 4 số cuối SĐT (giữ tên trường cũ để tương thích).
- `ticketCode` + `email` đầy đủ, đối chiếu không phân biệt hoa/thường. Không chấp nhận 4 ký tự cuối email vì không đủ để xác minh.

Vẫn cần eventId và reason không rỗng. gateId có thể bỏ qua nếu nhân viên đã được gán cổng; nếu truyền thì phải đúng cổng được phân công. Check-in phải xác định được cổng thực tế. Admin cần chỉ định cổng khi không có phân công. Trả nguyên GateLookupResponse như hợp đồng cũ, không bọc thêm data.

Cả QR và thủ công cùng kiểm tra tài khoản ACTIVE, phân công sự kiện/cổng và trạng thái PUBLISHED. QR còn phải khớp ticketId, eventId, orderId, userId với vé thật. Cập nhật CHECKED_IN, ghi gate_checkin_logs SUCCESS và audit_log cùng một transaction; lỗi ghi log phải rollback check-in. Lần thử bị từ chối được ghi REJECTED riêng sau rollback. Không ghi email/SĐT đối chiếu hoặc QR token vào log.

#### `GET /api/v1/organizer/events/:eventId/checkins`

Query page/limit như danh sách staff. Response 200 gồm các log của sự kiện: id, eventId, ticketId, gateId, staffId, method (QR/MANUAL), outcome (SUCCESS/REJECTED), reason, errorCode, checkedInAt. Log append-only. QR hỏng không xác định được sự kiện vẫn được lưu với eventId null, không xuất hiện trong lịch sử riêng của sự kiện.

### Báo cáo và xuất file

#### `GET /api/v1/organizer/events/:eventId/reports`

Response 200: `{ "success": true, "data": { "summary": { ... }, "sales": [ ... ] } }`.

- summary đọc từ mv_event_sales_summary: event_id, organizer_id, title, total_sold_tickets, total_checked_in_tickets, total_cancelled_tickets, gross_revenue, paid_revenue, total_refunded_amount, net_revenue, checkin_percentage, refreshed_at.
- sales đọc từ mv_event_ticket_sales: event_id, organizer_id, ticket_type_id, ticket_type_name, sale_date, total_sold_tickets, total_checked_in_tickets, paid_revenue, refreshed_at.
- Tiền là chuỗi decimal; số đếm BIGINT có thể là chuỗi. Ngày bán theo Asia/Ho_Chi_Minh. paid_revenue là tiền đã thu trước hoàn tiền; net_revenue trừ các refund COMPLETED. Doanh thu theo hạng/ngày phân bổ tiền sau giảm giá theo giá vé trong order_items.
- Worker refresh view mỗi 5 phút; cache Redis TTL 60 giây. Redis hỏng thì đọc MV, không quay về truy vấn tổng hợp trên bảng giao dịch. Kết quả có thể chậm tối đa khoảng 6 phút; xem refreshed_at. Sự kiện chưa refresh có summary null; không coi là doanh thu 0.

#### `POST /api/v1/organizer/events/:eventId/reports/exports`

Body: `{ "format": "csv" }` hoặc `{ "format": "xlsx" }`. Response 202: `{ "success": true, "data": { "id": "export-uuid", "status": "PENDING", "format": "csv", "createdAt": "..." } }`. Tối đa 3 job đang PENDING/PROCESSING mỗi người dùng; vượt giới hạn trả 409. Không tạo file trong HTTP request.

#### `GET /api/v1/organizer/events/:eventId/reports/exports/:exportId`

Chỉ người tạo, còn quyền với sự kiện, được đọc trạng thái. Response 200 gồm id, status, format, createdAt, expiresAt, errorMessage, downloadUrl. Các trạng thái: PENDING, PROCESSING, COMPLETED, FAILED, EXPIRED. downloadUrl chỉ có khi COMPLETED; không trả đường dẫn filesystem.

#### `GET /api/v1/organizer/events/:eventId/reports/exports/:exportId/download`

Yêu cầu JWT và kiểm tra lại quyền. File thực sự là CSV UTF-8 hoặc XLSX, tên file do server tạo. Response 409 khi chưa xong, 410 khi hết hạn 24 giờ, 404 nếu không có file/tài nguyên thuộc người gọi. Header Cache-Control private, no-store. File không được phục vụ trực tiếp từ thư mục public.

CSV ngăn công thức bắt đầu bằng =, +, -, @; Excel ghi dữ liệu không tin cậy bằng ô string, không tạo formula. Một báo cáo hỗ trợ tối đa 10.000 dòng phân tổ; vượt giới hạn báo lỗi thay vì xuất thiếu dữ liệu.

### Mở rộng UC09 cho tích hợp FE1

Hợp đồng chi tiết, quy tắc thời gian/tiền và mẫu response: [w05-be2-integration.md](testing/w05-be2-integration.md).

#### `GET /api/v1/organizer/events/:eventId/checkins/summary`

Thống kê trực tiếp toàn sự kiện và từng cổng: validTickets, checkedInTickets, remainingTickets,
successfulAttempts, rejectedAttempts, checkinPercentage; kèm generatedAt và timelineLast24Hours theo giờ Việt Nam.
Không dùng các dòng của một trang lịch sử để tính tổng. activeAssignedStaff không có nghĩa là online.

#### `GET /api/v1/organizer/events/:eventId/reports/exports`

Danh sách job của người tạo và đúng sự kiện thuộc quyền, hỗ trợ page/limit; data là mảng, meta page/limit/hasMore.
Mỗi job có bộ lọc fromDate/toDate/ticketTypeId/voucherCode, trạng thái hiệu lực và link tải khi còn hạn.

#### `GET /api/v1/organizer/events/:eventId/reports/buyers`

Danh sách đơn đã thanh toán với thông tin liên hệ người mua từ MV; hỗ trợ bộ lọc báo cáo và phân trang.
Không trả passwordHash, token hay thông tin đăng nhập. Chỉ BTC có quyền sự kiện được xem.

#### `GET /api/v1/organizer/events/:eventId/reports/vouchers`

Phân tích theo voucher từ MV: paidOrders, grossRevenue, discountAmount, paidRevenue,
refundedAmount, netRevenue, validTickets, refreshedAt. Hỗ trợ bộ lọc báo cáo và phân trang.

GET reports nhận fromDate/toDate (YYYY-MM-DD, cả hai hoặc không có), ticketTypeId, voucherCode.
POST exports nhận cùng bộ lọc và format, lưu bộ lọc bền vững cho worker. Không truyền lọc giữ hành vi toàn sự kiện.
Tiền hoàn theo ngày COMPLETED, tiền thu theo ngày thanh toán; kỳ có thể có net âm.
analytics.fees là NOT_CONFIGURED với giá trị null vì nhóm chưa chốt phí, net_revenue chưa trừ phí.
HTTP tối đa 10000 dòng, vượt trả 422 REPORT_TOO_LARGE và hướng sang xuất nền; xuất nền tối đa 100000 dòng,
vượt trả job FAILED REPORT_TOO_LARGE, không xuất thiếu dòng. Giới hạn mới thay thế giới hạn export 10000 dòng phía trên.
Danh sách staff, cổng, phân công, checkins và exports giữ data dạng mảng, thêm meta page/limit/hasMore.
Outbox REPORT_EXPORT_COMPLETED được ghi nguyên tử với hoàn tất job; gửi email cần cấu hình riêng, link vào FE có xác thực.

### Tích hợp W03/W04/W05 trên unstable

Search keyword dưới hai ký tự bỏ full-text nhưng giữ các bộ lọc, keyword hợp lệ ưu tiên ts_rank và phân trang theo cùng thứ tự.
Không phục hồi UC03 hoặc admission token. Giữ các API venues, payout và SSE hiện có trên unstable.
POST /api/v1/refund/preview và /request kiểm tra request bằng shared schema trước khi gọi service.
Giá hoàn tiền ưu tiên snapshot order_items.unit_price thay vì giá hạng vé hiện tại.
Worker xử lý REFUND_REQUESTED với refundId hoặc refundIds; kiểm tra vé đã CANCELLED và cho phép đơn PAID/REFUNDED,
không coi order.status=REFUNDED là bằng chứng provider đã hoàn tất: chỉ refunds.status=COMPLETED xác nhận tiền hoàn.
Sau IPN, SSE phát trạng thái ghế đọc từ DB, không phát AVAILABLE cho ghế đã thuộc đơn khác khi IPN cũ phải hoàn tiền.
