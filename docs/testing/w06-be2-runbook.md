# Runbook W06-BE2 | Quyết toán UC11 và VNPay

## Bàn giao UC11

1. Trước migration 0006, kiểm tra lệnh chi trả trùng bằng truy vấn chỉ đọc:

   ```sql
   SELECT event_id, count(*)
   FROM payouts
   GROUP BY event_id
   HAVING count(*) > 1;
   ```

   Nếu có kết quả, dừng triển khai và để tài chính cùng quản trị cơ sở dữ liệu xác minh lịch sử. Migration sẽ báo lỗi thay vì tự chọn hay xóa một lệnh chi trả. Sau đó chạy `pnpm db:migrate` và kiểm tra API `/health`.

2. Admin chốt sự kiện qua `POST /api/v1/admin/events/:id/end` sau giờ kết thúc. Sự kiện `CANCELLED` đã đủ điều kiện nhập báo cáo. Chờ các đơn đang treo được xác định kết quả và chờ VNPay lập báo cáo đầy đủ. Admin kiểm tra tranh chấp đang mở trước khi duyệt.
3. Lấy báo cáo đã xác nhận từ cổng merchant VNPay qua kênh chính thức. Lưu bản gốc ở kho vận hành giới hạn quyền truy cập. Chuyển đổi thành CSV UTF-8 **bao phủ toàn bộ vòng đời của một sự kiện và một merchant**. Giữ cả giao dịch thành công chỉ thấy ở phía VNPay nếu đã xác minh thuộc sự kiện. Nếu chưa xác định được sự kiện, mở phiếu điều tra riêng và chưa chốt các sự kiện có thể liên quan. Báo cáo demo dưới đây dùng ID và số tiền minh họa:

   ```csv
   vnp_TxnRef,vnp_TransactionNo,vnp_Amount,vnp_TransactionType
   BE2EXAMPLE123,100001,10000000,01
   BE2EXAMPLE123,100002,2000000,03
   ```

   Mỗi dòng biểu diễn một giao dịch đã thành công. `vnp_Amount` là số nguyên VND nhân 100. Kiểu `01` là thanh toán, `02` là hoàn toàn bộ, `03` là hoàn một phần. Dòng hoàn tiền giữ mã thanh toán gốc và số giao dịch hoàn do VNPay trả. Giữ nguyên số giao dịch dưới dạng văn bản khi chuẩn hóa, kể cả số 0 ở đầu. Giới hạn 2 MiB và 20.000 dòng. Tệp chỉ có tiêu đề biểu diễn báo cáo đã xác nhận không có giao dịch.

4. Job lưu kết quả, mã băm của tệp và dữ liệu nội bộ. Chạy lệnh dưới đây từ workspace sau khi nhận và chuẩn hóa báo cáo:

   ```bash
   pnpm --filter @tickethub/api reconcile:vnpay <event-id> <absolute-csv-path>
   ```

   Scheduler gọi trực tiếp `node dist/jobs/vnpay-reconciliation.js <event-id> <absolute-csv-path>` trong image API đã build và gắn báo cáo dạng chỉ đọc. Entry point Node giữ nguyên mã thoát của job. Mã thoát `0` là báo cáo sạch, `2` là đã lưu và cần điều tra, `1` là lỗi nhập hoặc xử lý. Chạy lại cùng tệp và cùng dữ liệu trả về kết quả cũ. Giữ hàm băm trong log để truy ngược tệp đã nhập.

5. Mở `GET /api/v1/admin/reconciliations?eventId=<event-id>`. Với mỗi dòng sai lệch, mở phiếu điều tra và ghi loại lỗi, mã giao dịch, chênh lệch, sự kiện và `sourceHash`. Nếu phát hiện sai lệch, job tự chuyển lệnh `PENDING` sang `HOLD`. Lệnh đã `PAID_OUT` cần theo dõi điều chỉnh ngoài luồng và giữ lịch sử hiện có.
6. Sau khi sửa nguyên nhân và nhập lại báo cáo, Admin dùng `generate` hoặc `recalculate` để tính số tiền. Admin gỡ giữ qua `POST /api/v1/admin/payouts/:id/release` kèm lý do. Admin duyệt qua `approve`. API so lại báo cáo, dữ liệu hiện tại và số tiền trong lệnh. `PAID_OUT` là mốc ghi nhận mô phỏng.
7. Số liệu toàn hệ thống có tại `GET /api/v1/admin/settlement-report` theo ngày, thể loại, thành phố, BTC hoặc phương thức thanh toán. Duy trì worker báo cáo W05 làm mới materialized view. Với báo cáo lớn, thu hẹp phạm vi ngày hoặc lọc theo BTC trước khi xuất CSV.

## Cấu hình production

- Nhận `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, URL thanh toán `VNPAY_URL` và API `VNPAY_API_URL` từ hồ sơ merchant đã duyệt. Đặt `VNPAY_RETURN_URL` thành URL HTTPS web của môi trường. Cấp secret qua hệ thống quản lý bí mật của môi trường.
- Đăng ký IPN HTTPS `/api/v1/payments/vnpay/ipn` với VNPay. Giới hạn nguồn tại ingress và đặt `VNPAY_IPN_ALLOWED_CIDRS` theo dải IP VNPay xác nhận. Nếu có reverse proxy, giới hạn đường truy cập trực tiếp vào API, chuẩn hóa `X-Forwarded-For` tại biên và khai báo đúng các hop nội bộ trong `TRUSTED_PROXY_CIDRS`.
- Bật `ENABLE_VNPAY_IPN_PROCESSING=true` sau kiểm tra merchant và ingress. Bật `ENABLE_VNPAY_REFUNDS=true` khi đã xác nhận quyền API hoàn tiền, `VNPAY_REFUND_IP` và payment worker. Xác nhận chữ ký, số tiền, callback lặp và QueryDR ở sandbox trước buổi nghiệm thu merchant production.
- Cấu hình `SENTRY_DSN` cho API và job/worker. Tạo cảnh báo theo tag `component=payments`, ưu tiên `vnpay.ipn.processing_failed`, `vnpay.reconciliation.discrepancy`, `vnpay.reconciliation.failed`, `payment.outbox.manual_review` và `payment.worker.failed`. Gửi tới kênh đã đăng ký của trực vận hành.
- Chạy `pnpm --filter @tickethub/api check:payment-monitoring` hoặc `node dist/jobs/check-payment-monitoring.js` trong image. Xác nhận sự kiện `payment.monitoring.smoke_test` xuất hiện trong đúng Sentry project và cảnh báo thử đến kênh trực. Giữ đường thu log JSON như kênh chẩn đoán tại môi trường triển khai.

## Xử lý sự cố thanh toán

| Dấu hiệu                                     | Thao tác                                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IPN bị từ chối nguồn                         | Đối chiếu IP thực với danh sách từ VNPay và cấu hình các hop ingress. Kiểm tra lại bằng callback hợp lệ từ merchant.                                                   |
| Số tiền hoặc mã giao dịch lệch               | Giữ lệnh chi trả, kiểm tra dữ liệu đã ký qua QueryDR và báo cáo merchant. Lưu mã giao dịch và `sourceHash` trong phiếu điều tra.                                       |
| Gateway timeout hoặc hoàn tiền chưa xác định | Tra cứu giao dịch theo quy trình QueryDR và kiểm tra trạng thái worker/outbox. Tránh phát lệnh hoàn mới khi lần gửi trước có thể đã được VNPay ghi nhận.               |
| API hoặc worker lỗi liên tục                 | Kiểm tra Sentry, log JSON, PostgreSQL và queue. Khi cần và được vận hành phê duyệt, tạm tắt handler qua feature flag. Sau khôi phục, đối soát lại trước khi gỡ `HOLD`. |
| Báo cáo sai sau `PAID_OUT`                   | Mở phiếu điều tra và lưu lịch sử audit. Đối soát lại để ghi nhận sai lệch, sau đó xử lý điều chỉnh theo quy trình tài chính.                                           |

Giữ `VNPAY_HASH_SECRET`, chữ ký và nội dung callback đầy đủ ngoài log và phiếu điều tra. Báo cáo chứa thông tin tài chính cần hạn chế quyền đọc.
