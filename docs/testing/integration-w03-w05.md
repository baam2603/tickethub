# Tích hợp tuần 3, 4, 5 trên unstable của fork

## Phạm vi

Nền unstable 1964f85; giữ code venues/layouts, payouts, SSE và quyết định loại UC03.
Gộp W03 5d34586 (Search, không phục hồi Waiting Room), W04 91f6f94 (VNPay/worker), W05 1cc7172 (staff/report).
Không sửa .github/workflows hoặc các script/test gate được bảo vệ, không merge lên repository gốc.

## Database

Schema cuối có 21 BASE TABLE public:
users, organizer_profiles, venues, venue_layouts, events, ticket_types, seats,
orders, order_items, tickets, transactions, refunds, gates, event_staff, payouts,
audit_log, outbox, idempotency_keys, organizer_staff, gate_checkin_logs, report_exports.
Bốn Materialized View và bảng metadata drizzle không được cộng vào số bảng này.

Giữ nguyên các migration 0000-0004 của unstable. Tạo 0005_integrate-w03-w05 từ snapshot schema kết hợp,
không đưa hai lịch sử 0003 của nhánh W04/W05 vào cùng journal.
DDL kiểm tra tồn tại để nâng cấp từ DB W04 16 bảng, W05 19 bảng và unstable 18 bảng.
Khi mở rộng orders.status mà MV cũ đang tham chiếu, dựng lại bốn MV trong cùng transaction;
không xóa bảng nghiệp vụ hoặc reset metadata migration của người dùng.
Nếu có view tùy biến bên ngoài phụ thuộc các MV này, migration từ chối và rollback thay vì CASCADE xóa view đó.

Đã kiểm tra database mới tạo đủ 21 bảng, nâng cấp W04/W05/unstable đều tạo đủ 21 bảng.
Ca W05 có dữ liệu trước nâng cấp giữ nguyên đơn PAID, final_amount=100, một vé SOLD;
MV sau nâng cấp vẫn có paid_revenue=100. Dữ liệu kiểm thử là fixture riêng, không phải database người dùng.

## Các điểm nối đã sửa

- Search bỏ FTS với keyword ngắn, ưu tiên ts_rank, cursor cùng thứ tự; HTTP regression TC15/TC16.
- Không thêm lại Waiting Room; giữ các cột và module đã loại khỏi unstable ở trạng thái đã loại bỏ.
- Giữ cả worker payment và report, không dùng report worker thay cho xử lý hoàn tiền VNPay.
- Worker refund nhận cả refundId và refundIds của BE1, chấp nhận đơn đã thu hồi vé hoàn toàn ở trạng thái REFUNDED.
- Refunded ở bảng orders mô tả vòng đời vé/đơn, refunds.COMPLETED mới là tiền hoàn thực tế.
- API refund dùng shared schema và snapshot giá order_items khi có; dữ liệu legacy thiếu order_items giữ fallback cũ.
- Worker payment dùng đồng hồ DB và fencing theo lần claim để tránh job bị PENDING do lệch giờ Windows/Docker.
- SSE sau IPN đọc trạng thái ghế từ DB. Ghế đã bán cho đơn khác không phát AVAILABLE khi IPN muộn chuyển hoàn tiền.
- Test HTTP xuyên UC06 -> provider fixture -> outbox worker -> báo cáo W05 xác nhận toàn bộ tiền hoàn và idempotency.

## Cập nhật trên máy phát triển

Dừng backend và worker cũ, giữ PostgreSQL/Redis chạy. Sao lưu DB đang dùng trước khi nâng cấp.
Pull unstable của fork, giữ DATABASE_URL trỏ đúng DB và chạy:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd --filter @tickethub/shared build
pnpm.cmd db:migrate
pnpm.cmd db:seed
pnpm.cmd --filter @tickethub/api build
```

Không đổi nhánh rồi trộn journal thủ công, không xóa bảng/drizzle để ép migrate.
Chạy seed cập nhật danh mục địa điểm/layouts. Với dữ liệu khách hàng thật, kiểm tra runbook seed trước khi chạy.

API: pnpm --filter @tickethub/api dev.
Worker báo cáo: pnpm --filter @tickethub/api start:report-worker.
Worker thanh toán: pnpm --filter @tickethub/api start:payment-worker, chỉ bật các handler đã cấu hình merchant/email.
Cấu hình compose.reporting dùng profile payments tùy chọn, bật bằng --profile payments.
API và report worker phải chia sẻ REPORT_EXPORT_DIR tuyệt đối.

## Kiểm thử và phạm vi xác nhận

Dùng database _test và Redis riêng; không chạy worker rời trên cùng DB khi suite đang xử lý job.
Bộ test dùng HTTP, PostgreSQL và Redis thật. HTTP provider VNPay/Resend là fixture cục bộ,
không chứng minh merchant sandbox thật hoặc gửi email live đã được xác nhận.
FE1 vẫn cần nối các API mới theo w05-be2-integration.md và chạy kiểm thử trình duyệt.
Phí W05 vẫn NOT_CONFIGURED theo xác nhận nhóm; chưa thay đổi các tỷ lệ mặc định có sẵn trong module payout upstream.
Không coi khoản sau hoàn tiền của báo cáo là khoản net payout đã trừ phí.

## Kết quả xác minh bản tích hợp

Ngày 06/11/2026 (Asia/Saigon), trong worktree cô lập:

| Kiểm tra                                                     | Kết quả                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| pnpm test API                                                | 261/261 PASS, không skip                                             |
| pnpm test web                                                | 28/28 PASS, không skip                                               |
| Root PR/CI tests                                             | 35/35 PASS                                                           |
| Regression W03/W04/W05 qua HTTP                              | 38/38 PASS                                                           |
| Lint, typecheck, format, audit-doc-parity                    | PASS                                                                 |
| Drizzle db:generate                                          | Không phát sinh schema drift                                         |
| Build API và Docker backend                                  | PASS                                                                 |
| Runtime Docker: health, JWT, report worker, quyền ghi volume | PASS                                                                 |
| Build web                                                    | Môi trường cloud không tải được Inter/JetBrains Mono từ Google Fonts |

Kiểm tra nâng cấp DB W04, W05 và unstable bằng database _test riêng đều đủ 21 bảng.
Ca W05 có đơn/vé giữ nguyên dữ liệu và tổng báo cáo sau nâng cấp. Không chạy provider sandbox/live bên ngoài.
Sau khi kiểm thử, đã sao lưu DB phát triển cloud bằng pg_dump trước khi migrate; DB cloud hiện có 21 bảng.
Backup nằm ngoài Git tại /workspace/tickethub-integration-backups/tickethub_dev.before-w03-w05.dump.

Đã sửa seed: tài khoản organizer có sẵn không còn khiến script bỏ qua danh mục venues/layouts mới.
Seed danh mục chạy trong transaction với advisory lock, dùng lại địa điểm theo name/city và layout theo venueId/mapKey,
giữ bản ghi tùy chỉnh hiện có, chạy lặp không nhân bản. Đã chạy hai lần trên DB có core seed, kết quả vẫn 3 venues/4 layouts.
Ba fixture kiểm thử cũ được chuẩn hóa UUID và reason để đi qua shared schema; các kiểm tra idempotency/conflict vẫn giữ nguyên.
Kết quả trên không thay thế E2E FE1, xác nhận Windows trên bản tích hợp hoặc CI GitHub sau push.

Đã kiểm tra thêm shared venue.schema bằng tsx: các schema địa điểm/layout đều PASS. Docker đã build lại sau bản sửa seed. Database phát triển cloud sau seed có 3 venues và 4 layouts, không có bản ghi trùng theo name/city hoặc venueId/mapKey.
