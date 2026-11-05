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
