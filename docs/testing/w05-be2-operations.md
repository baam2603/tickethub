# Tuần 5 BE2: nhân viên soát vé và báo cáo

## Khởi chạy

Dùng checkout hiện có, tạo nhánh từ unstable đã đồng bộ. Không cần đưa lại toàn bộ nhánh tuần 4 vào nhánh này. Không sửa workflow CI.

```bash
pnpm install --frozen-lockfile
pnpm --filter @tickethub/shared build
pnpm --filter @tickethub/api db:migrate
pnpm --filter @tickethub/api build
pnpm --filter @tickethub/api start
```

API soát vé dùng khóa Ed25519 hợp lệ qua ED25519_PRIVATE_KEY dạng base64 PKCS8 DER. Đã xác minh giá trị mẫu hiện có trong CI vẫn đọc được và ký/xác minh QR thành công. Đây là khóa cố định đã công khai trong repository, chỉ dùng cho kiểm thử; staging/production phải có khóa riêng. Không tự sinh khóa thay thế âm thầm trong production.

## Worker báo cáo

```bash
pnpm --filter @tickethub/api start:report-worker
# Một lượt refresh view và lấy tối đa một job:
pnpm --filter @tickethub/api start:report-worker --once
```

Worker refresh MV mỗi 5 phút, claim job bằng FOR UPDATE SKIP LOCKED, tạo CSV/XLSX ngoài HTTP request. Nếu sự kiện mới chưa có trong MV, worker refresh trước khi xuất. Quá trình bị dừng được claim lại sau 5 phút. attempt_id ngăn worker cũ ghi đè kết quả worker mới. Lỗi thử tối đa 3 lượt với backoff; sau đó FAILED.

REPORT_EXPORT_DIR là thư mục lưu file riêng, development mặc định tmp/report-exports so với thư mục làm việc; production yêu cầu cấu hình đường dẫn tuyệt đối. API và worker phải dùng cùng đường dẫn tuyệt đối và volume khi triển khai nhiều container. Không dùng thư mục public. Hạn tải 24 giờ; worker dọn file hết hạn. Với hạ tầng không có shared volume cần chuyển phần lưu file sang object storage trước khi triển khai phân tán.

## Quản lý nhân viên

BTC đã VERIFIED tạo tài khoản GATE_STAFF, khóa/mở tài khoản và gán vào một cổng cho mỗi sự kiện. Không nhận quản lý tài khoản BTC khác. Gỡ phân công hoặc khóa không xóa lịch sử. Mỗi lần check-in đọc lại trạng thái và phân công trong database, không chỉ tin role trong JWT.

Migration chỉ backfill organizer_staff cho nhân viên cũ có phân công thuộc đúng một BTC. Nhân viên có phân công nhiều BTC không tự gán quyền sở hữu; cần quản trị viên đối chiếu trước khi quản lý qua API mới. Các phân công hợp lệ cũ vẫn dùng được để check-in.

## Kiểm thử

w05-operations.integration.test.ts sử dụng HTTP, PostgreSQL và Redis thật, khóa QR thật và đọc lại file Excel thật. Không gọi Docker từ trong test. Chạy trên database có tên kết thúc _test, đã migrate và seed. Với suite IPN cũ, đặt IPN_TEST_DB_NAME trùng database test để không bị skip.

Các kiểm tra bao gồm: RBAC/IDOR, không lộ mật khẩu, chống trùng email, phân công sai cổng, staff bị khóa/gỡ phân công với JWT cũ, email đầy đủ/4 số cuối SĐT, QR sai phạm vi, QR/manual đồng thời, tính nguyên tử khi log lỗi, log bất biến, tổng hợp MV không fanout, Redis fallback MV, export thật, chống formula injection, tải file đúng chủ, hết hạn, phục hồi job và giới hạn queue.

```bash
NODE_ENV=test IPN_TEST_DB_NAME=tickethub_w05_test DATABASE_URL=postgresql://tickethub:tickethub_secret@localhost:5432/tickethub_w05_test REDIS_URL=redis://localhost:6379/8 pnpm test
pnpm lint
pnpm typecheck
pnpm format:check
node scripts/audit-doc-parity.mjs
pnpm --filter @tickethub/api db:generate
pnpm build
```

Log check-in không sửa/xóa, kể cả khi dọn fixture. Chúng dùng ID lịch sử không có FK tới fixture nên không cản dọn dữ liệu nghiệp vụ trong database test cô lập. Kiểm thử lỗi log dùng trigger tạm riêng trong database test, luôn gỡ trong finally.

## PowerShell / Windows

Bộ test dùng node:os tmpdir() và node:path join() để tạo thư mục trong TEMP/TMP của hệ điều hành. Redis chỉ kết nối trong before; teardown vẫn đóng kết nối và dọn fixture nếu setup thất bại. Nếu lỗi before, các ca cancelled chưa được thực thi và không được tính là lỗi nghiệp vụ.

Sau khi migrate/seed thành công và DATABASE_URL đã được đặt đúng trong cùng terminal:

```powershell
git switch feat/w05-be2-staff-reporting
git pull --ff-only
pnpm.cmd --filter @tickethub/api exec tsx --test test/w05-operations.integration.test.ts
```

Giữ NODE_ENV=test, database riêng có hậu tố _test và Redis database riêng. Không cần bật dev backend cho bộ test này.

## Bản hoàn thiện tích hợp FE1

Xem [hợp đồng và triển khai mới](w05-be2-integration.md) cho bộ lọc ngày/hạng vé/voucher, thống kê toàn sự kiện, phân trang, danh sách job, email outbox và giới hạn xuất nền 100000 dòng. Chạy thêm migration 0004 và 0005.
