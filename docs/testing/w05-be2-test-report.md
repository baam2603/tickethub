# Kết quả kiểm thử tuần 5 BE2

Ngày kiểm tra: 06/11/2026 (Asia/Saigon).

Mã nghiệp vụ được kiểm tra: commit `3aa1d4b`, nhánh `feat/w05-be2-staff-reporting`.

## Kết quả tự động

| Kiểm tra                                | Kết quả                                                             |
| --------------------------------------- | ------------------------------------------------------------------- |
| Test API, gồm 13 ca tuần 5              | 204/204 PASS, không skip                                            |
| Test web                                | 28/28 PASS, không skip                                              |
| Test kiểm tra PR/CI trong thư mục tests | 35/35 PASS                                                          |
| Lint                                    | PASS                                                                |
| Typecheck                               | PASS                                                                |
| Format                                  | PASS                                                                |
| Đồng bộ tài liệu/API/schema             | PASS                                                                |
| Build API riêng                         | PASS                                                                |
| Build toàn dự án                        | FAIL tại web do không tải được Inter/JetBrains Mono từ Google Fonts |

Các test chạy trên database PostgreSQL riêng có hậu tố _test và Redis database riêng. Không dùng dữ liệu phát triển. Các test tuần 5 dùng HTTP, PostgreSQL/Redis thật và đọc nội dung file XLSX bằng ExcelJS.

## Các trường hợp tuần 5 đã xác nhận

- Tạo nhân viên, hash mật khẩu, không trả password/hash; từ chối email trùng và thay role từ request.
- Chặn BTC truy cập/sửa nhân viên hoặc phân công thuộc BTC khác; kiểm tra cổng thuộc đúng sự kiện.
- Đối chiếu mã vé bằng email đầy đủ hoặc 4 số cuối SĐT; không chấp nhận đuôi email chung.
- 20 yêu cầu QR/thủ công đồng thời cho một vé: một thành công, 19 xung đột.
- JWT cũ không giúp nhân viên soát vé sau khi bị khóa hoặc gỡ phân công.
- Log bất biến; rollback check-in nếu ghi log thất bại.
- QR đã ký nhưng sai order/user không được check-in.
- Báo cáo đọc MV, không nhân doanh thu theo số vé/refund; Redis lỗi vẫn đọc MV.
- CSV/XLSX được tạo bằng worker, tải đúng quyền, chống formula injection, hết hạn trả 410.
- Job PROCESSING bị bỏ dở được claim lại; worker kiểm tra lại quyền BTC; giới hạn job đang chờ.

## Luồng HTTP và worker thực tế

Đã khởi động API từ dist trên cổng test riêng và chạy worker bằng lệnh CLI, trên database smoke test riêng. Đã xác nhận 10 bước:

1. Health kiểm tra PostgreSQL và Redis.
2. Truy cập staff không JWT bị từ chối 401.
3. Đăng nhập BTC qua Auth API thật.
4. Đọc báo cáo từ MV đã refresh.
5. Tạo staff và đăng nhập bằng mật khẩu được Argon2 hash.
6. Gán staff vào sự kiện/cổng.
7. Khóa staff rồi gọi bằng JWT cũ bị từ chối 403.
8. Gỡ phân công rồi gọi bằng JWT cũ bị từ chối 403.
9. Tạo job CSV qua HTTP, chạy worker CLI, tải và phân tích CSV thành công.
10. Tạo job XLSX qua HTTP, chạy worker CLI, tải và mở workbook bằng openpyxl thành công.

## Cấu hình và giới hạn

Đã kiểm tra trực tiếp khóa Ed25519 mẫu trong workflow: đọc được khóa và ký/xác minh QR thành công. Chạy lại pnpm test với chính giá trị khóa CI trên database test riêng cũng đạt 204 test API và 28 test web, không skip. Nhận định trước rằng giá trị này không sử dụng được là không đúng; tài liệu vận hành đã được đính chính. Khóa mẫu công khai chỉ dùng cho kiểm thử.

Chưa chạy E2E trình duyệt hoặc kiểm thử tải dữ liệu lớn. Build web còn bị chặn ở Google Fonts nên không kết luận toàn bộ cổng CI/PR đã xanh. Kết quả trên là kiểm thử cục bộ, không thay thế trạng thái GitHub Actions trên PR.

Không thay đổi logic nghiệp vụ trong đợt kiểm thử này. Đã đính chính tài liệu khóa QR và sửa khởi tạo/dọn fixture kiểm thử để hỗ trợ Windows.

## Bổ sung từ log Windows

Log người dùng cho thấy hook before thất bại do mkdtemp('/tmp/...') không tồn tại trên Windows. Cả 13 ca bị cancelled, chưa chạy kiểm tra nghiệp vụ. Cảnh báo Redis xuất hiện khi dọn một kết nối đang bắt tay sau khi setup lỗi.

Đã đổi sang tmpdir()/join(), dùng lazyConnect và await connect trong hook, xử lý lỗi kết nối qua promise, bảo đảm đóng kết nối và chỉ dọn thư mục đã được tạo. Đã chạy lại 13/13 ca thành công với TMPDIR tùy chỉnh có khoảng trắng trên môi trường Linux; chưa có runner Windows để xác nhận trực tiếp. Cần người dùng pull bản sửa và chạy lại PowerShell để xác nhận trên máy Windows.

## Bản hoàn thiện tích hợp FE1 ngày 06/11/2026

Kiểm tra thay đổi sau commit 1829528 trên cùng nhánh BE2. Phần này cập nhật kết quả cho bản mở rộng;
những kết quả HTTP smoke của commit cũ phía trên vẫn là bằng chứng cho phiên bản cũ.

| Kiểm tra                                                                | Kết quả                                                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| pnpm test: API                                                          | 209/209 PASS, không skip                                                                           |
| pnpm test: web                                                          | 28/28 PASS, không skip                                                                             |
| W05 trên database mới, migrate/seed từ đầu                              | 18/18 PASS, không skip                                                                             |
| Root PR/CI tests (`node --test --test-isolation=none tests/*.test.mjs`) | 35/35 PASS                                                                                         |
| Lint, typecheck, format, audit-doc-parity                               | PASS                                                                                               |
| Build API riêng                                                         | PASS                                                                                               |
| db:generate                                                             | Không phát sinh schema drift                                                                       |
| Compose API/worker config                                               | PASS, còn cảnh báo version cũ ở compose gốc                                                        |
| Build toàn dự án                                                        | Web không tải được Inter/JetBrains Mono từ Google Fonts trong môi trường này; API build riêng PASS |

Ca mới xác nhận qua HTTP và DB thật: biên nửa đêm Việt Nam, kỳ chỉ có hoàn tiền với net âm,
refund PENDING bị loại, cache không lẫn bộ lọc, hạng vé/voucher trên đơn nhiều hạng,
phân bổ đến cent, refund theo vé và theo đơn, tổng tiền dashboard/file CSV/XLSX theo cùng bộ lọc,
khôi phục danh sách job, IDOR, phân trang, thống kê check-in toàn sự kiện và từng cổng.
Báo cáo 10001 dòng bị giới hạn ở HTTP bằng 422 nhưng xuất nền đủ 10001 dòng dữ liệu.
Outbox REPORT_EXPORT_COMPLETED được xác nhận sau khi file hoàn tất; không gửi email thật trong test.

Chưa kiểm thử FE1 bằng trình duyệt trên bản BE mới, chưa có xác nhận provider email live,
chưa kiểm thử ngưỡng 100000 dòng hoặc tải đồng thời production. Phí vẫn NOT_CONFIGURED theo xác nhận của nhóm.
Chi tiết tích hợp và các bước FE cần cập nhật: [w05-be2-integration.md](w05-be2-integration.md).

### Xác minh Docker và runtime

Docker backend build PASS. Trong môi trường cloud, dùng bản Dockerfile tạm ngoài repository để truyền CA proxy
và bật Node sử dụng proxy, đồng thời ánh xạ tên proxy về địa chỉ proxy hiện có cho BuildKit.
Không tắt TLS, không đưa CA/địa chỉ proxy riêng vào image hay Dockerfile được commit.
Dockerfile trong nhánh chỉ bổ sung thư mục report-exports thuộc user node.

Chạy image với NODE_ENV=production trên database tickethub_w05_fresh_test:
API /health trả 200, PostgreSQL và Redis healthy; report worker --once kết thúc 0;
user node ghi/xóa tệp thử trong named volume report-exports thành công. Container và volume smoke được dọn sau kiểm tra.
Đây là kiểm tra runtime cục bộ, chưa thay thế chạy E2E FE1 hoặc triển khai production.

## Sửa lỗi đồng hồ Windows/PostgreSQL

Log người dùng trên Windows có 2 job còn PENDING và ca giới hạn hàng đợi trả 409 do job trước chưa được xử lý.
Worker cũ so sánh next_retry_at do PostgreSQL tạo với new Date() của Node; hai đồng hồ khác nhau có thể khiến
job mới chưa đến hạn theo Node dù đã hợp lệ theo database.

Đã dùng clock_timestamp() của PostgreSQL cho nhận job, retry/backoff, lease, hạn file, dọn file và trạng thái hết hạn.
Timestamp cập nhật của outbox được chuẩn hóa millisecond để so khớp fencing qua Date không mất phần microsecond.
Thêm test Node chậm 60 giây/nhanh 2 ngày, giữ database thật. Đối chứng worker cũ thất bại đúng tại nhận job;
bản sửa đạt 19/19 ca W05, không skip. Không dùng sleep để che lỗi và không bỏ giới hạn hàng đợi.
Cần người dùng pull bản sửa và chạy lại Windows; kết quả mô phỏng trên Linux không thay thế xác nhận Windows thực tế.

Kiểm thử hồi quy sau bản sửa: pnpm test đạt 210/210 API và 28/28 web, không skip; build API, typecheck, lint API, format và audit-doc-parity đều PASS. Không thêm migration cho bản sửa này.
