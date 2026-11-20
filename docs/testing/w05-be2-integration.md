# Tích hợp backend Tuần 5 BE2

## Quy tắc báo cáo

- `fromDate`, `toDate`: `YYYY-MM-DD`, truyền cả hai hoặc bỏ cả hai, bao gồm trọn hai ngày theo `Asia/Ho_Chi_Minh`.
- Tiền thu tính theo `paid_at`; dữ liệu PAID/REFUNDED cũ thiếu mốc này dùng `created_at`.
- Tiền hoàn chỉ tính COMPLETED, theo `processed_at`; dữ liệu cũ thiếu mốc dùng `updated_at`.
- Vì tiền thu và tiền hoàn theo ngày phát sinh riêng, kỳ chỉ có hoàn tiền có thể có doanh thu sau hoàn âm.
- Số vé theo nhóm ngày thanh toán và trạng thái hiện tại tại lần refresh, không phải số lượt quét phát sinh trong kỳ.
  `total_sold_tickets` gồm SOLD và CHECKED_IN, không gồm CANCELLED. Tỷ lệ check-in dùng mẫu số này.
- `ticketTypeId`: UUID thuộc sự kiện; sai hạng trả 400. `voucherCode`: trim và chuyển hoa, tối đa 50 ký tự;
  mã không có doanh số trả dữ liệu rỗng/0. Áp dụng đồng thời được với khoảng ngày.
- Phân bổ tiền thu/giảm giá giữa các hạng theo tỷ trọng subtotal của order_items; phần dư làm tròn đến cent
  thuộc hạng cuối theo UUID để tổng các hạng bằng đúng tiền đơn. Refund có ticket_id thuộc hạng của vé;
  refund cấp đơn phân bổ cùng tỷ trọng, không nhân theo số vé hay số lần refund.
- `net_revenue` là tiền thực thu trừ tiền đã hoàn, trước phí. `analytics.fees` dùng số liệu quyết toán từ một lệnh `PAID_OUT` duy nhất cho báo cáo toàn sự kiện, với trạng thái `FINALIZED`. Báo cáo có lọc hoặc chưa có quyết toán xác định trả `NOT_CONFIGURED` và số tiền null.
- `analytics.cancellationPercentage`: CANCELLED / (SOLD + CHECKED_IN + CANCELLED), 0 khi không có vé.
- Cache báo cáo theo BTC, sự kiện và toàn bộ bộ lọc, TTL 60 giây, fallback MV khi Redis lỗi.
  MV refresh 5 phút; FE phải hiển thị `refreshed_at`, độ trễ có thể xấp xỉ 6 phút.
- API và worker dùng cùng hàm đọc, bộ lọc và cách tính; mỗi tác vụ đọc snapshot mới nhất lúc xử lý,
  không khóa snapshot tại thời điểm người dùng bấm nút. Số liệu có thể đổi nếu refresh diễn ra sau lần xem dashboard.

## API cần FE kết nối

Tiền tố: `/api/v1/organizer/events/:eventId`.

| API                                                                                       | Mục đích                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GET `/reports?fromDate=2026-11-01&toDate=2026-11-30&ticketTypeId=UUID&voucherCode=SUMMER` | Tổng quan và sales cùng bộ lọc                                                                                            |
| POST `/reports/exports`                                                                   | Body `{format:"csv",fromDate:"2026-11-01",toDate:"2026-11-30",ticketTypeId:"UUID",voucherCode:"SUMMER"}`; format csv/xlsx |
| GET `/reports/exports?page=1&limit=20`                                                    | Khôi phục tác vụ sau F5; chỉ job của người yêu cầu và sự kiện thuộc quyền                                                 |
| GET `/reports/exports/:exportId`                                                          | Trạng thái, bộ lọc đã lưu, hạn tải và downloadUrl                                                                         |
| GET `/reports/exports/:exportId/download`                                                 | Tải có Bearer token; 409 chưa xong, 410 hết hạn, 404 thiếu file                                                           |
| GET `/checkins/summary`                                                                   | Thống kê trực tiếp toàn sự kiện, từng cổng, timeline giờ trong 24 giờ gần nhất                                            |
| GET `/checkins?page=1&limit=50`                                                           | Lịch sử, data vẫn là mảng và bổ sung meta                                                                                 |
| GET `/reports/buyers`                                                                     | Danh sách theo đơn đã thanh toán, tên/email/SĐT; hỗ trợ bộ lọc báo cáo và phân trang                                      |
| GET `/reports/vouchers`                                                                   | Doanh số, giảm giá, hoàn tiền theo voucher; mã null là nhóm không dùng voucher                                            |
| GET `/gates?page=2&limit=100`                                                             | Duyệt hết danh sách cổng, không giới hạn tổng ở 100                                                                       |
| GET `/staff?page=2&limit=100`                                                             | Duyệt hết phân công sự kiện                                                                                               |

`GET /api/v1/organizer/staff` cũng bổ sung meta. Cổng/phân công mặc định limit 100 để giữ tương thích,
các danh sách khác mặc định 20, limit tối đa 100. Trang tối đa 10000; dùng hasMore thay vì suy đoán total.
CORS backend cho phép GET/HEAD/POST/PATCH/DELETE/OPTIONS; proxy Next PATCH/DELETE hiện tại vẫn dùng được.

`checkins/summary` trả:

```json
{
  "success": true,
  "data": {
    "eventId": "UUID",
    "generatedAt": "2026-11-06T01:00:00.000Z",
    "suggestedPollIntervalMs": 5000,
    "summary": {
      "validTickets": 100,
      "checkedInTickets": 60,
      "remainingTickets": 40,
      "successfulAttempts": 60,
      "rejectedAttempts": 5,
      "checkinPercentage": 60
    },
    "gates": [
      {
        "gateId": "UUID",
        "gateName": "A",
        "successfulAttempts": 60,
        "rejectedAttempts": 5,
        "checkedInTickets": 60,
        "activeAssignedStaff": 2,
        "lastScanAt": "2026-11-06T01:00:00Z"
      }
    ],
    "timelineLast24Hours": [
      {
        "hour": "2026-11-06T08:00:00+07:00",
        "successfulAttempts": 10,
        "rejectedAttempts": 1
      }
    ]
  }
}
```

Số lượt quét khác số vé đã vào; quét trùng chỉ tăng lượt từ chối. Cổng chưa có lượt vẫn được trả với số 0.
Log không xác định cổng vào nhóm gateId null. `activeAssignedStaff` là nhân viên ACTIVE đang được phân công,
không phải số người online. Timeline chỉ chứa giờ có lượt; FE có thể điền giờ thiếu bằng 0.
Polling 5 giây khi trang đang hiển thị; không dùng MV chậm cho giám sát, không khẳng định có SSE/WebSocket.

FE1 cần bỏ lọc ngày cục bộ khi dùng API mới, đưa toàn bộ bộ lọc vào queryKey và request,
gửi cùng bộ lọc khi tạo export, sửa nhãn tổng quan theo kỳ. Dùng summary API cho số tổng,
không đếm lại 50 dòng lịch sử. Nạp danh sách job sau F5 và chọn job theo `exportId` trên URL nếu có.
Adapter hiện tại chỉ lấy data nên cần bổ sung cách đọc meta của response cho phân trang.

## Giới hạn và lỗi

HTTP đọc tối đa 10000 dòng hạng vé/ngày, vượt trả 422 `REPORT_TOO_LARGE`, không cắt mất dòng.
Xuất nền hỗ trợ tối đa 100000 dòng; vượt mức này job FAILED với cùng mã, không retry lỗi kích thước.
Lỗi tạm thời thử tối đa 3 lần; tối đa 3 job đang chờ/xử lý mỗi người.
API đọc báo cáo và tạo export trả 403 cho sự kiện ngoài phạm vi theo UC09. API tra cứu job và tài nguyên vận hành giữ mã 404 để che tài nguyên.
Nhân viên/BTC không đủ trạng thái hoặc role vẫn bị 403.

## Chạy báo cáo nền

Chạy `pnpm --filter @tickethub/api db:migrate` để áp dụng `0006_w05_operations.sql`.
API và worker dùng chung `DATABASE_URL` và thư mục `REPORT_EXPORT_DIR` trên volume dùng chung.
Khởi động worker bằng `pnpm --filter @tickethub/api start:report-worker`. Với image API đã build,
chạy `node dist/contexts/operations/report.worker.js` làm lệnh khởi động của tiến trình worker riêng.

Để gửi thư khi báo cáo hoàn tất, đặt `ENABLE_REPORT_EMAIL_DELIVERY=true`,
`ENABLE_REAL_EMAIL=true`, `EMAIL_WORKER_MODE=live`, `RESEND_API_KEY`,
`EMAIL_FROM` thuộc miền đã xác minh và `REPORT_WEB_URL` là origin của frontend. Khi chưa cấu hình email, người yêu cầu vẫn có thể
tải báo cáo từ danh sách sau khi job hoàn tất.

Để chạy suite tích hợp, trỏ `DATABASE_URL` đến PostgreSQL kiểm thử riêng có tên kết thúc bằng
`_test`, áp dụng migrations, bật Redis và chạy:

```bash
pnpm --filter @tickethub/api exec tsx --test test/w05-operations.integration.test.ts
```
