# Runbook W04-BE2 trên unstable

## Cấu hình Sandbox

- Đặt `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` qua cấu hình bí mật của tiến trình API và worker. Dùng mã merchant và khóa Sandbox đã được cấp.
- Dùng `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` cho `VNPAY_URL` và endpoint merchant Sandbox cho `VNPAY_API_URL`. Bật hỗ trợ proxy theo cấu hình Node của môi trường nếu cần.
- `VNPAY_RETURN_URL` trỏ vào web tại `/checkout/vnpay-return`. Đăng ký IPN HTTPS có thể truy cập từ VNPay tại `/api/v1/payments/vnpay/ipn` và bật `ENABLE_VNPAY_IPN_PROCESSING=true`.
- Đặt `VNPAY_REFUND_IP` theo IP đã đăng ký cho merchant. Bật `ENABLE_VNPAY_REFUND_PROCESSING=true` và chạy định kỳ `pnpm --filter @tickethub/api start:refund-processor`.
- Dùng cấu hình Resend riêng. Bật `ENABLE_PAYMENT_EMAIL=true`, đặt `RESEND_API_KEY` và `EMAIL_FROM`, rồi chạy định kỳ `pnpm --filter @tickethub/api start:payment-email`. Khóa idempotency của email được lấy từ ID outbox.

## Kiểm tra

1. Tạo đơn riêng cho mỗi tình huống. Checkout lấy giá và chiết khấu từ đơn lưu trên server. Áp mã voucher mới cần nguồn voucher phía server.
2. Thanh toán bằng thẻ thử nghiệm NCB. Trên trang quay về, so sánh trạng thái TicketHub với merchant. Dùng QueryDR khi giao dịch còn chờ xác nhận.
3. Thử giao dịch thất bại và callback lặp. Với IPN muộn, kiểm tra cấp lại vé khi còn kho hoặc tạo hoàn tiền đầy đủ khi mất kho.
4. Thử hoàn tiền trên đơn đã thanh toán. Sau kết quả không xác định, worker chỉ gọi QueryDR. Sau ba lượt không xác minh được, xem `VNPAY_REFUND_MANUAL_REVIEW` và đối chiếu merchant. Không xóa dấu vết giao dịch hoặc đặt yêu cầu về PENDING để gửi lại khi chưa biết tiền đã hoàn hay chưa.
5. Xác nhận người mua nhận email. Bằng chứng được lưu với thời điểm, mã tham chiếu và số tiền. Che chữ ký, khóa, số thẻ và OTP.

Bộ kiểm thử HTTP cục bộ dùng PostgreSQL thật và VNPay mô phỏng. Nghiệm thu Sandbox thật cần merchant, URL IPN công khai và kết nối được tới VNPay.
