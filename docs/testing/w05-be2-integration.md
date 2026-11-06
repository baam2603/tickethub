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

Trên nhánh PR W05, migration riêng là 0007_w05-staff-reporting.sql, sau 0005_w04-provider-integration.sql của W04 và 0000-0004 gốc. Không chạy lại các file migration W04/W05 cũ.
Nộp PR W05 sau khi W03 và W04 đã merge vào unstable bản gốc. Nhánh đã kế thừa W04 để giữ một chuỗi migration; PR W05 chỉ nên review delta so với W04.
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

## Đồng hồ worker

Nhận job, retry, lease và hạn file dùng giờ PostgreSQL thay vì so sánh giờ Node với giờ database.
Điều này tránh job mới bị giữ PENDING khi Windows và PostgreSQL Docker lệch giờ.
Bộ W05 hiện có 19 ca, gồm đối chứng đồng hồ chậm/nhanh và kiểm tra không bỏ qua backoff.

Khi chạy suite tự động, dừng report worker riêng đang trỏ vào cùng database test để tránh hai tiến trình tranh job. Suite tự khởi động API và gọi worker, không cần bật dev backend hay worker bên ngoài. Bản sửa đồng hồ không yêu cầu migration mới.

## Nhánh PR W05 đã chuẩn bị lại

Nền là nhánh W04 đã sửa, kế thừa W03 và upstream unstable 1964f85. Diff W05 chỉ thêm staff/gate/report,
clock worker báo cáo và kiểm thử tích hợp báo cáo với thanh toán đã có ở W04.
Validation dùng helper chung từ W04, không sao chép ngược module báo cáo vào W04.
Schema cuối 21 bảng (18 nền + organizer_staff, gate_checkin_logs, report_exports), bốn MV.
Không phục hồi Waiting Room. Không force-push các nhánh cũ; commit mới giữ lịch sử để các PR hiện tại nhận cập nhật.
Thứ tự nộp/merge: W03, W04, W05. Khi PR trước đã merge, cập nhật metadata/base PR sau nếu GitHub chưa tự tính lại.

## Kết quả chuẩn bị ba PR riêng (06/11/2026)

| Nhánh           | API tests    | Schema DB mới | Migration riêng               |
| --------------- | ------------ | ------------- | ----------------------------- |
| W03             | 225/225 PASS | 18 bảng       | Không thêm                    |
| W04 kế thừa W03 | 250/250 PASS | 18 bảng       | 0005_w04-provider-integration |
| W05 kế thừa W04 | 270/270 PASS | 21 bảng       | 0007_w05-staff-reporting      |

Mỗi nhánh có 28 test web và 35 root PR/CI tests PASS; lint, typecheck, format, doc parity và db:generate đều PASS.
API build từng nhánh PASS. Kiểm thử dùng DB/Redis riêng. Không có file workflow hoặc gate bị sửa trong diff từng PR.
Kiểm tra nâng cấp DB W05 legacy qua W04 rồi W05 giữ đơn PAID, final_amount=100, một vé và paid_revenue=100;
giữ lại năm index của bốn MV. Chưa gửi provider thật hoặc chạy E2E FE1 trên ba nhánh PR.
Build web toàn dự án vẫn phụ thuộc tải Google Fonts, đã bị chặn ở môi trường cloud trước đó.

Nếu nhóm squash/rebase PR trước khi merge, cần fetch và merge upstream/unstable mới vào nhánh kế tiếp
để GitHub tính lại diff. Không cần force-push. Các nhánh cũ giữ tên để PR đang mở tự nhận commit mới.

## Đồng bộ review thanh toán W04

Chuỗi mới: 0000-0004 gốc, 0005_w04-provider-integration, 0006_w04-refund-groups, 0007_w05-staff-reporting. Snapshot 0006 giữ 18 bảng và snapshot 0007 có 21 bảng. Không sửa journal trong DB hoặc reset dữ liệu. Với DB đã chạy bản W05 0006 cũ, migrate áp dụng cột nhóm refund và chạy lại phần tạo báo cáo theo IF NOT EXISTS; test riêng kiểm tra staff, job export, log bất biến, refund đang xử lý và MV không mất dữ liệu.

Test HTTP W04 trên nhánh W05 kiểm tra thêm báo cáo sau hoàn nhóm ba vé 100% và 50%, bảo đảm không nhân số tiền hoặc đếm trùng nhóm. Dùng `pnpm --filter @tickethub/api test:isolated` để migrate/seed, chạy toàn bộ suite và dọn cả DB tạm, gồm audit log. Chỉ dùng DATABASE_URL của DB test có quyền CREATE DATABASE. Trước deploy dừng payment worker cũ, migrate, khởi động worker mới; không chạy song song worker cũ và mới trên cùng hàng đợi refund.
