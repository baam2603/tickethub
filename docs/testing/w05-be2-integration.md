# Tích hợp BE2 tuần 5 với FE1

## Phạm vi và tương thích

Nhánh BE: `feat/w05-be2-staff-reporting`. Đối chiếu FE1 `vikietduong/tickethub`, commit `0fae062`.
Không đưa code FE vào nhánh BE và không thay đổi workflow CI.

Giữ `{success:true,data:{summary,sales}}` cho báo cáo và `data:[]` cho danh sách cũ.
Bổ sung `meta:{page,limit,hasMore}` ở cấp ngoài `data`. FE hiện tại vẫn đọc được `data`,
nhưng cần cập nhật adapter để dùng `meta` và các chức năng mới.

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
- `net_revenue` là tiền thực thu trừ tiền đã hoàn, CHƯA trừ phí. Nhóm chưa chốt phí nền tảng/phí cổng:
  `analytics.fees` trả `status:NOT_CONFIGURED`, các số tiền `null`. Không xem đây là khoản chi trả cuối cùng.
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
RBAC/IDOR vẫn trả 404 cho sự kiện/job không thuộc quyền, theo API_CONTRACT hiện tại và FE1;
đây là lựa chọn che sự tồn tại tài nguyên, khác mã 403 trong bản mô tả UC09 ban đầu.
Nhân viên/BTC không đủ trạng thái hoặc role vẫn bị 403.

## Triển khai API và worker

Chạy migration 0004 và 0005 sau migration tuần 5 hiện có. Không sửa migration đã áp dụng ở môi trường khác.
Nếu merge nhánh tuần 4 có migration cùng chỉ số 0003, phải xử lý chuỗi migration khi tích hợp, không chạy hai lịch sử cạnh tranh.
API và worker bắt buộc dùng cùng DATABASE_URL và cùng thư mục REPORT_EXPORT_DIR tuyệt đối trên shared volume.
Production thiếu đường dẫn tuyệt đối sẽ không tạo/tải file. Không dùng thư mục public.

Có cấu hình tùy chọn `docker-compose.reporting.yml` dùng chung image và volume, restart unless-stopped.
Sao chép `.env.reporting.example` thành `.env.reporting` (đã gitignore), điền giá trị thực.
Hostname database/Redis trong container là postgres/redis, không phải localhost; API chạy host vẫn dùng cổng host thực tế.
Chạy migrate với credentials phù hợp trước khi khởi động API/worker, rồi:

```bash
docker compose -f docker-compose.yml -f docker-compose.reporting.yml build api
docker compose -f docker-compose.yml -f docker-compose.reporting.yml up -d api report-worker
```

Image chuẩn bị thư mục volume thuộc user node. Nếu gắn bind mount, tự cấp quyền ghi cho UID node.
Worker phục hồi job PROCESSING quá lease 5 phút; lỗi DB tạm thời backoff 5 giây rồi tiếp tục.
Cần theo dõi log, job FAILED, độ mới refreshed_at; compose restart không thay thế giám sát nghiệp vụ.

## Email báo cáo

Khi hoàn tất file, cùng transaction cập nhật job sẽ ghi outbox REPORT_EXPORT_COMPLETED.
Report worker xử lý loại outbox riêng, dispatcher đăng ký/review cũ không nhận nhầm.
Gửi lỗi không làm mất file hay đổi job COMPLETED thành FAILED. Retry 3 lần, có lease và idempotency key với provider.

Mặc định KHÔNG gửi email. Chỉ bật khi cấu hình đầy đủ:
`ENABLE_REPORT_EMAIL_DELIVERY=true`, `ENABLE_REAL_EMAIL=true`, `EMAIL_WORKER_MODE=live`,
`RESEND_API_KEY`, `EMAIL_FROM` thuộc domain xác minh và `REPORT_WEB_URL` là origin HTTPS của frontend.
Email trỏ về trang báo cáo có exportId; người nhận đăng nhập và tải qua API kiểm tra quyền.
Không gửi JWT, đường dẫn filesystem hay link tải công khai trong email.
FE1 cần xử lý exportId/danh sách job như mục trên để mở đúng tác vụ.
Kiểm thử tự động xác minh outbox nguyên tử, không gửi email thật và chưa chứng minh provider/domain production đã hoạt động.

## Đối chiếu tài liệu

Đáp ứng nhóm công việc BE2 tuần 5: nhân viên, phân công cổng, tra cứu thủ công, log bất biến,
đọc MV/cache, bộ lọc và xuất nền, giám sát polling. Bổ sung danh sách người mua và hiệu quả voucher của UC09.
Phí nền tảng/cổng và khoản thực nhận cuối cùng chưa thể tính khi nhóm chưa chốt nghiệp vụ;
không gọi net_revenue sau hoàn là net payout. Email live cần cấu hình provider và tích hợp FE như trên.
Không tuyên bố toàn bộ UC09 nghiệm thu chỉ dựa vào test backend; cần FE chạy chung và kiểm thử chấp nhận của nhóm.
