# Thiết Kế Kỹ Thuật: Phân Hệ Đối Soát Giao Dịch & Quyết Toán Doanh Thu Ban Tổ Chức (Reconciliations & Payouts)

- **Phân hệ**: Quản trị hệ thống (`/admin/reconciliations`, `/admin/payouts`) & Cổng Ban tổ chức (`/organizer/payouts`)
- **Tài liệu tham chiếu**:
  - [ERD.md](file:///home/user/Downloads/Projects/tickethub/docs/ERD.md#L653) (Bảng `payouts`, `transactions`, `orders`, `refunds`, `audit_log`)
  - [API_CONTRACT.md](file:///home/user/Downloads/Projects/tickethub/docs/API_CONTRACT.md#L1069)
  - [AGENTS.md](file:///home/user/Downloads/Projects/tickethub/AGENTS.md) (Mục 1.7 Chính sách hoàn tiền; Mục 1.9 Kiểm duyệt 2 lớp & Audit Log; Mục 1.10 RBAC & IDOR)

---

## 1. Mục Đích Và Bối Cảnh (Intent & Why)

Sau khi một sự kiện kết thúc hoặc trong chu kỳ kinh doanh định kỳ, sàn bán vé TicketHub cần:
1. Đối soát độc lập giữa dữ liệu đơn hàng (`orders`), dữ liệu giao dịch cổng VNPay (`transactions`) và dữ liệu hoàn vé (`refunds`) để phát hiện các trường hợp chênh lệch số tiền hoặc giao dịch chưa khớp.
2. Quyết toán chi trả doanh thu bán vé cho Ban tổ chức (`payouts`): Khấu trừ tỷ lệ phí sàn TicketHub (mặc định 5%), phí xử lý cổng thanh toán (mặc định 1.5%) và toàn bộ số tiền vé đã hoàn trả khách hàng (`refundDeduction`), từ đó tính ra số tiền thực nhận (`netPayout`).
3. Cung cấp quy trình phê duyệt chi trả có kiểm soát bởi Quản trị viên (`ADMIN`), hỗ trợ chức năng tạm giữ chi trả (`HOLD`) kèm lý do rõ ràng khi có tranh chấp, cập nhật tính toán lại (`recalculate`), và ghi vết kiểm toán bất biến vào `audit_log`.

---

## 2. Mục Tiêu, Phi Mục Tiêu Và Điều Cấm (Goals, Non-Goals, Anti-Goals)

### 2.1. Mục Tiêu (Goals)
- Định nghĩa DTO và Zod validation schema trong `packages/shared` cho đối soát và quyết toán: `ReconciliationQuerySchema`, `ApprovePayoutSchema`, `HoldPayoutSchema`, `GeneratePayoutSchema`.
- Triển khai `PayoutsService` và `ReconciliationsService` tại `apps/api/src/payouts/` kết nối Drizzle ORM với các bảng `payouts`, `orders`, `transactions`, `refunds`, `organizer_profiles`, `events`.
- Triển khai nhóm API Quản trị viên (`ADMIN`):
  1. `GET /api/v1/admin/reconciliations`: Lấy danh sách giao dịch đối soát, phân loại trạng thái `MATCHED`, `AMOUNT_MISMATCH`, `MISSING_TRANSACTION`, `ORPHAN_TRANSACTION`, kèm khối thống kê tổng hợp `summary` (tổng doanh thu, tổng tiền thanh toán qua VNPay, tổng tiền hoàn, số lượng khớp/lệch).
  2. `GET /api/v1/admin/payouts`: Danh sách các lệnh quyết toán chi trả, lọc theo `status`, `organizerId`, `eventId`, hỗ trợ phân trang.
  3. `POST /api/v1/admin/payouts/generate`: Kích hoạt tính toán đối soát doanh thu của một sự kiện và tạo hoặc cập nhật bản ghi `payouts` ở trạng thái `PENDING`.
  4. `POST /api/v1/admin/payouts/:id/approve`: Phê duyệt lệnh chi trả, cập nhật trạng thái `PAID_OUT`, lưu `approvedBy`, `paidOutAt`, ghi `audit_log`.
  5. `POST /api/v1/admin/payouts/:id/hold`: Tạm giữ lệnh chi trả khi có sự cố hoặc tranh chấp vé, lưu `holdReason`, ghi `audit_log`.
  6. `POST /api/v1/admin/payouts/:id/recalculate`: Tính toán lại số liệu doanh thu, hoàn tiền và phí của lệnh quyết toán đang ở trạng thái `PENDING` hoặc `HOLD`.
- Triển khai nhóm API Ban tổ chức (`ORGANIZER`):
  7. `GET /api/v1/organizer/payouts`: Ban tổ chức tra cứu danh sách quyết toán của các sự kiện do chính mình sở hữu (ngăn chặn triệt để IDOR).
- Đồng bộ hóa tài liệu [API_CONTRACT.md](file:///home/user/Downloads/Projects/tickethub/docs/API_CONTRACT.md): Gỡ nhãn `[PLANNED]` tại dòng 1069 và dòng 1075.

### 2.2. Phi Mục Tiêu (Non-Goals)
- Không tích hợp lệnh chuyển tiền tự động liên ngân hàng qua Open Banking API hoặc VietQR payout trong giai đoạn này (chuyển tiền thực tế do bộ phận kế toán thực hiện, sau đó Admin xác nhận trên hệ thống để hoàn tất trạng thái).
- Không cho phép người dùng vai trò `BUYER` truy cập bất kỳ endpoint nào thuộc phân hệ này.

### 2.3. Điều Cấm (Anti-Goals)
- Tuyệt đối cấm thao tác sửa đổi hoặc xóa trực tiếp các bản ghi `audit_log`. Mọi hành động phê duyệt hoặc tạm giữ đều là ghi mới (Append-only).
- Nghiêm cấm IDOR: Ban tổ chức không được xem bất kỳ bản ghi thanh quyết toán của Ban tổ chức khác.
- Ngăn chặn lỗi làm tròn số tiền: Phải sử dụng số học nguyên hoặc làm tròn chính xác `Math.round()` / PostgreSQL `NUMERIC(14,2)` để không xảy ra sai lệch số dư.

---

## 3. Các Phương Án Kỹ Thuật Đã Đánh Giá (Approaches)

### Phương Án A (Đã chọn): Mô đun Payouts & Reconciliations độc lập, đối soát trực tiếp theo cơ sở dữ liệu
- Tạo mô đun `PayoutsModule` độc lập trong `apps/api/src/payouts/`, liên kết với `AdminModule` và `EventsModule`.
- Đối soát trực tiếp giữa bảng `transactions` (ghi nhận dữ liệu IPN từ VNPay) và bảng `orders` + `refunds` trong cơ sở dữ liệu PostgreSQL.
- Ưu điểm: Độc lập, kiến trúc sạch (clean architecture), dễ dàng kiểm thử đơn vị và tích hợp, truy vấn dữ liệu thời gian thực không phụ thuộc batch file bên ngoài.

### Phương Án B (Bị loại): Gộp chung vào AdminService hiện tại
- Đánh đổi: Tệp `admin.service.ts` hiện đã vượt quá 700 dòng code (gồm KYC organizer, event moderation, kill switch, audit logs). Gộp thêm nghiệp vụ tài chính phức tạp sẽ vi phạm Single Responsibility Principle và gây khó bảo trì.

---

## 4. Công Thức Tính Toán Tài Chính Quyết Toán (Financial Calculation Logic)

Đối với một sự kiện `eventId`:
1. **Tổng doanh thu gộp ban đầu (`grossRevenue`)**:
   - Theo [AGENTS.md](file:///home/user/Downloads/Projects/tickethub/AGENTS.md) Mục 1.7, khi một đơn hàng được hoàn tiền toàn bộ thì trạng thái chuyển từ `PAID` sang `REFUNDED`. Để tránh lỗi khấu trừ kép (double-deduction), tổng doanh thu gốc thu về từ cổng thanh toán là tổng giá trị `finalAmount` của tất cả các đơn hàng thuộc sự kiện có trạng thái `orders.status IN ('PAID', 'REFUNDED')`.
2. **Tổng khấu trừ hoàn tiền (`refundDeduction`)**:
   - Tổng giá trị `amount` của các yêu cầu hoàn tiền thuộc các đơn hàng của sự kiện có trạng thái `refunds.status IN ('PENDING', 'COMPLETED')`.
3. **Doanh thu thực giữ lại của sự kiện (`retainedRevenue`)**:
   - `retainedRevenue = Math.max(0, grossRevenue - refundDeduction)`
4. **Phí nền tảng TicketHub (`platformFee`)**:
   - Mặc định 5% tính trên doanh thu thực giữ:
     `platformFee = Math.round(retainedRevenue * 0.05)`
5. **Phí cổng thanh toán VNPay (`gatewayFee`)**:
   - Mặc định 1.5% tính trên tổng tiền giao dịch đã thanh toán ban đầu:
     `gatewayFee = Math.round(grossRevenue * 0.015)`
6. **Số tiền thực nhận của Ban tổ chức (`netPayout`)**:
   - `netPayout = Math.max(0, retainedRevenue - platformFee - gatewayFee)`

---

## 5. Quy Chuẩn API & Hợp Đồng Dữ Liệu

### 5.1. `GET /api/v1/admin/reconciliations`
- **Quyền**: `ADMIN`
- **Query params**:
  - `eventId` (UUID tùy chọn)
  - `status` (`ALL`, `MATCHED`, `AMOUNT_MISMATCH`, `MISSING_TRANSACTION`, `ORPHAN_TRANSACTION` - mặc định `ALL`)
  - `page` (mặc định 1), `limit` (mặc định 20)
- **Thuật toán đối soát**:
  - `MATCHED`: Đơn hàng `PAID` có giao dịch VNPay `SUCCESS` và `orders.finalAmount === transactions.amount`.
  - `AMOUNT_MISMATCH`: Đơn hàng `PAID` có giao dịch VNPay `SUCCESS` nhưng số tiền ghi nhận không bằng nhau.
  - `MISSING_TRANSACTION`: Đơn hàng ở trạng thái `PAID` nhưng không tìm thấy bản ghi giao dịch thành công nào trong bảng `transactions`.
  - `ORPHAN_TRANSACTION`: Giao dịch VNPay `SUCCESS` nhưng không gắn với đơn hàng hợp lệ nào hoặc đơn hàng chưa bao giờ được xác nhận.
- **Response 200**:
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalTransactions": 150,
      "totalOrderAmount": 75000000,
      "totalPaidAmount": 75000000,
      "totalRefundedAmount": 3000000,
      "matchedCount": 148,
      "mismatchedCount": 2
    },
    "items": [
      {
        "orderId": "uuid-1",
        "orderCode": "ORD-123456",
        "eventId": "uuid-event",
        "eventTitle": "Concert Anh Trai",
        "orderAmount": 1500000,
        "paidAmount": 1500000,
        "refundedAmount": 0,
        "transactionRef": "vnp-ref-1",
        "providerTxNumber": "14567890",
        "bankCode": "NCB",
        "payDate": "2026-11-20T19:30:00.000Z",
        "reconciliationStatus": "MATCHED"
      }
    ],
    "meta": {
      "total": 150,
      "page": 1,
      "limit": 20,
      "totalPages": 8
    }
  }
}
```

### 5.2. `POST /api/v1/admin/payouts/generate`
- **Quyền**: `ADMIN`
- **Request body**: `{ "eventId": "uuid-event" }`
- **Hành vi vòng đời (Lifecycle & Idempotency)**:
  - Kiểm tra sự kiện tồn tại.
  - Tính toán các số liệu doanh thu theo Mục 4.
  - Nếu sự kiện chưa có lệnh quyết toán: Tạo mới bản ghi `payouts` với trạng thái `PENDING`.
  - Nếu sự kiện đã có lệnh quyết toán ở trạng thái `PENDING` hoặc `HOLD`: Cập nhật các con số tính toán mới nhất.
  - Nếu sự kiện đã có lệnh quyết toán ở trạng thái `PAID_OUT`: Trả về mã lỗi 409 Conflict ("Lệnh chi trả cho sự kiện này đã được hoàn tất trước đó").
- **Response 200**:
```json
{
  "success": true,
  "data": {
    "id": "uuid-payout",
    "eventId": "uuid-event",
    "organizerId": "uuid-organizer",
    "totalRevenue": 100000000,
    "platformFee": 4900000,
    "gatewayFee": 1500000,
    "refundDeduction": 2000000,
    "netPayout": 91600000,
    "status": "PENDING"
  }
}
```

### 5.3. `POST /api/v1/admin/payouts/:id/approve`
- **Quyền**: `ADMIN`
- **Response 200**:
```json
{
  "success": true,
  "data": {
    "id": "uuid-payout",
    "status": "PAID_OUT",
    "approvedBy": "uuid-admin",
    "paidOutAt": "2026-11-20T20:00:00.000Z",
    "message": "Lệnh chi trả đã được phê duyệt thành công."
  }
}
```

### 5.4. `POST /api/v1/admin/payouts/:id/hold`
- **Quyền**: `ADMIN`
- **Request body**: `{ "reason": "Phát hiện đơn hàng tranh chấp đang khiếu nại" }`
- **Response 200**:
```json
{
  "success": true,
  "data": {
    "id": "uuid-payout",
    "status": "HOLD",
    "holdReason": "Phát hiện đơn hàng tranh chấp đang khiếu nại"
  }
}
```

### 5.5. `POST /api/v1/admin/payouts/:id/recalculate`
- **Quyền**: `ADMIN`
- **Mô tả**: Tính toán lại các số dư cho lệnh chi trả đang ở `PENDING` hoặc `HOLD` sau khi có thêm giao dịch hoàn tiền hoặc đối soát.
- **Response 200**: Bản ghi quyết toán với các con số cập nhật mới nhất.

### 5.6. `GET /api/v1/organizer/payouts`
- **Quyền**: `ORGANIZER`
- **Mô tả**: Trả về danh sách quyết toán của các sự kiện do chính ban tổ chức đang đăng nhập sở hữu (kiểm tra `organizerId = currentUser.organizerProfileId`).
- **Response 200**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid-payout",
        "eventId": "uuid-event",
        "eventTitle": "Concert Âm Nhạc",
        "totalRevenue": 100000000,
        "platformFee": 4900000,
        "gatewayFee": 1500000,
        "refundDeduction": 2000000,
        "netPayout": 91600000,
        "status": "PAID_OUT",
        "paidOutAt": "2026-11-20T20:00:00.000Z",
        "createdAt": "2026-11-20T10:00:00.000Z"
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

---

## 6. Chiến Lược Kiểm Thử (Testing Strategy)

- Kiểm thử đơn vị tính toán tài chính (`payout-calculator.spec.ts`):
  - Doanh thu gộp bao gồm cả đơn `PAID` và `REFUNDED`.
  - Trừ đúng số tiền hoàn tiền mà không bị trừ 2 lần (no double-deduction).
  - Phí sàn 5% trên doanh thu thực giữ.
  - Phí cổng VNPay 1.5% trên doanh thu thanh toán gốc.
  - Xử lý các biên: Doanh thu 0 đồng, hoàn tiền 100% doanh thu (netPayout = 0), làm tròn VND nguyên vẹn.
- Kiểm thử tích hợp luồng API (`payouts.integration.test.ts`):
  - Khởi tạo lệnh chi trả qua `POST /api/v1/admin/payouts/generate`.
  - Tạm giữ lệnh chi trả qua `POST /api/v1/admin/payouts/:id/hold`.
  - Tính toán lại qua `POST /api/v1/admin/payouts/:id/recalculate`.
  - Phê duyệt lệnh chi trả qua `POST /api/v1/admin/payouts/:id/approve` và kiểm tra ghi vết `audit_log`.
  - Chặn phê duyệt kép (không duyệt lại lệnh đã `PAID_OUT`).
  - Kiểm tra đối soát `GET /api/v1/admin/reconciliations` khớp trạng thái `MATCHED`, `AMOUNT_MISMATCH`.
  - Kiểm tra bảo mật IDOR cho `GET /api/v1/organizer/payouts`.
