# Tuần 4 BE2: thanh toán và hoàn tiền VNPay

## Phạm vi

- Tạo URL thanh toán theo đơn của người dùng, kiểm tra tổng tiền và giảm giá đã lưu bởi server, tái sử dụng transaction/URL khi retry.
- Xử lý IPN và QueryDR đã xác minh chữ ký, số tiền, merchant và mã tham chiếu; khóa PostgreSQL chống xử lý trùng.
- IPN muộn: khôi phục nguyên tử toàn bộ vé nếu còn trống; nếu đã mất kho thì lưu yêu cầu hoàn 100% và outbox trong cùng transaction.
- Worker transactional outbox gửi xác nhận vé, gọi Refund và đối soát khi chưa rõ kết quả; gọi HTTP sau khi đã commit transaction.

API hủy vé và chính sách hoàn tiền tự nguyện của BE1 đã có trên unstable và được nối với worker này. BE1 cần thu hồi vé và trả kho trong transaction trước khi tạo refund PENDING và outbox REFUND_REQUESTED. Worker từ chối refund tự nguyện nếu vé liên quan chưa CANCELLED. API này không tạo module voucher mới: discount và voucher phải được quy trình server phê duyệt trước khi gọi thanh toán.

## Cài đặt và vận hành

Từ thư mục gốc repository, dùng Node >=22 và pnpm đúng phiên bản trong package.json:

```bash
pnpm install --frozen-lockfile
pnpm --filter @tickethub/shared build
pnpm --filter @tickethub/api db:migrate
pnpm --filter @tickethub/api build
pnpm --filter @tickethub/api start
```

Cấu hình an toàn trong môi trường hoặc tệp .env được Git bỏ qua:

- VNPAY_TMN_CODE, VNPAY_HASH_SECRET: thông tin merchant sandbox thật. Hash secret cần là giá trị cục bộ để ký HMAC, không dùng placeholder thay thế ở HTTP proxy.
- VNPAY_URL: URL payment của sandbox. VNPAY_RETURN_URL: trang kết quả của web.
- VNPAY_API_URL: mặc định https://sandbox.vnpayment.vn/merchant_webapi/api/transaction.
- VNPAY_REFUND_IP: địa chỉ IP đúng với cấu hình merchant. VNPAY_API_TIMEOUT_MS mặc định 5000.
- ENABLE_VNPAY_IPN_PROCESSING=true: mở endpoint IPN; khai báo URL API công khai với VNPay. Return URL không thay thế IPN.
- ENABLE_VNPAY_REFUNDS=true: cho phép worker gọi refund. RESEND_API_KEY, EMAIL_FROM và ENABLE_PAYMENT_EMAIL=true: cho phép gửi email thật.
- Giữ proxy và CA của môi trường; HTTP client hỗ trợ proxy và không tắt xác minh TLS.

Chạy worker riêng; worker này chỉ lấy ORDER_PAID, REFUND_REQUESTED, REFUND_COMPLETED nên không lấy sự kiện đăng ký/duyệt của worker email cũ:

```bash
pnpm --filter @tickethub/api start:payment-worker
```

Chạy một lượt xử lý sự kiện đến hạn:

```bash
pnpm --filter @tickethub/api start:payment-worker --once
```

## Retry và đối soát

- Handler chưa được bật hoặc thiếu cấu hình không lấy sự kiện, không tiêu hao retry budget. Worker yêu cầu bật ít nhất một handler khi khởi động.
- Claim outbox bằng FOR UPDATE SKIP LOCKED. Sự kiện PROCESSING bị bỏ dở được lấy lại sau 5 phút.
- Lỗi được lên lịch exponential backoff, tối đa 8 lượt; hết số lượt thì outbox FAILED để người vận hành kiểm tra.
- Worker ghi provider_request_id và PROCESSING trước khi gửi Refund. Sau timeout, lỗi chữ ký hoặc crash, các lượt sau chỉ gọi QueryDR, không gửi Refund lần hai.
- Chỉ phản hồi đã ký đúng, đúng mã tham chiếu, đúng số tiền, đúng loại refund 02/03 và trạng thái thành công mới chuyển refund sang COMPLETED.
- Với hoàn tiền một phần (03), QueryDR còn phải khớp OrderInfo chứa request ID đã gửi, để không nhầm với một lần hoàn cùng số tiền trước đó.
- QueryDR trả giao dịch thanh toán loại 01, trạng thái đang xử lý hoặc không có bằng chứng hoàn tiền là chưa đủ để kết luận. Giữ PROCESSING và yêu cầu đối soát khi hết retry.
- Nếu crash sau khi dành quyền gửi nhưng trước khi thực sự gửi, QueryDR có thể chưa chứng minh được refund. Kiểm tra merchant portal trước khi thao tác thủ công; không tự xóa provider_request_id hoặc reset refund để gửi lại.
- Email dùng idempotency key theo outbox ID. Chỉ hoàn thành outbox sau khi provider chấp nhận. Việc provider chấp nhận không chứng minh email đã đến inbox.

## Kiểm thử

```bash
NODE_ENV=test DATABASE_URL=postgresql://tickethub:tickethub_secret@localhost:5432/tickethub_ipn_test REDIS_URL=redis://localhost:6379/5 pnpm test
pnpm lint
pnpm typecheck
pnpm format:check
node scripts/audit-doc-parity.mjs
pnpm --filter @tickethub/api db:generate
pnpm build
```

Bộ w04-payment.integration.test.ts dùng HTTP API thật, PostgreSQL và Redis thật; chỉ mô phỏng giao thức VNPay/Resend bằng máy chủ HTTP cục bộ. Nó không chứng minh merchant sandbox thật đã chấp nhận giao dịch. Phải chạy thêm một giao dịch sandbox, IPN thật, QueryDR và refund thật trước khi nghiệm thu tích hợp ngoài.

Không sao chép dist từ file ZIP vào repository để thay thế mã nguồn. Migration 0003 lưu metadata truy vấn/hoàn tiền và mở rộng trạng thái đơn, không thay đổi dữ liệu thanh toán cũ; các bản ghi cũ thiếu metadata cần đối soát thủ công.

## PR W04 đã tách riêng

Nộp sau PR W03; nền nhánh gồm W03 và unstable bản gốc 1964f85. Không có ReportingModule hoặc ba bảng W05.
Migration 0005_w04-provider-integration.sql chỉ mở rộng schema thanh toán/refund; tổng vẫn 18 bảng nền.
Migration giữ lại các MV/index báo cáo legacy nếu có khi mở rộng orders.status. Với MV tùy biến owner/grant hoặc view phụ thuộc,
transaction sẽ từ chối/rollback để không làm mất cấu hình. Không reset metadata hoặc xóa bảng nghiệp vụ.

Đã mang các sửa tích hợp: payload refundId/refundIds, đơn đã hủy hết vé ở trạng thái REFUNDED,
giá mua snapshot, validation request, clock/fencing worker, SSE không báo còn ghế khi IPN cũ bị hoàn tiền,
seed venues/layouts chạy lặp. Test W04 chỉ kiểm tra thanh toán/hủy/refund, không import module W05.
Sau khi W04 được merge, cập nhật W05 theo đúng lịch sử này; W05 bổ sung migration 0006 riêng.
