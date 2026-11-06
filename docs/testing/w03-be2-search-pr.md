# PR W03: Search

Nền: newtab64/tickethub unstable 1964f85. Tên nhánh giữ nguyên để bảo toàn PR/lịch sử cũ;
không còn module Waiting Room trong code. Chỉ giữ Search TC15/TC16 và cấu hình timeout Redis.
Keyword dưới 2 ký tự bỏ full-text, keyword hợp lệ ưu tiên ts_rank; cursor cùng thứ tự và có tie-break startTime/id.
HTTP regression dùng PostgreSQL/Redis thật. Schema giữ 18 bảng, không thêm migration.

PR đầu tiên trỏ vào unstable bản gốc. Sau khi merge W03 mới mở/chuyển base PR W04 vào unstable,
rồi thực hiện tương tự W05. Không PR cả ba cùng base unstable khi PR trước chưa merge vì sẽ hiển thị diff kế thừa.
