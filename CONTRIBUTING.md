# Hướng dẫn đóng góp

Tài liệu này quy định quy trình làm việc, tiêu chuẩn mã nguồn và quy định quản lý nhánh trên kho lưu trữ TicketHub.

## 1. Nguyên tắc chung

- Hệ thống sử dụng mô hình monorepo (`pnpm workspace`).
- Mọi thay đổi kỹ thuật phải tuân thủ các nguyên tắc kiến trúc và tiêu chuẩn mã nguồn quy định tại [docs/DEVELOPMENT_STANDARDS.md](docs/DEVELOPMENT_STANDARDS.md). Mã nguồn do công cụ AI hỗ trợ hoặc tạo tự động bắt buộc phải được kiểm thử chặt chẽ trước khi đóng góp.
- Không đưa vào kho lưu trữ các tệp chứa thông tin nhạy cảm (`.env`, khóa bí mật, token xác thực), tệp cấu hình môi trường cục bộ hoặc thư mục tạm thời (`tmp/`).
- Không sử dụng biểu tượng cảm xúc (emoji và icon) trong mã nguồn, commit message, tài liệu và nội dung thảo luận Pull Request.

## 2. Mô hình phân nhánh (Branching Model)

Hệ thống quản lý mã nguồn với hai nhánh chính và các nhánh làm việc tạm thời:

- **`stable`:** Nhánh phát hành chính thức, chứa mã nguồn đã qua kiểm thử tích hợp đầy đủ. Nhánh này được áp dụng cơ chế bảo vệ nghiêm ngặt (Protected branch).
- **`unstable`:** Nhánh phát triển chính (Default branch). Toàn bộ tính năng mới sau khi hoàn thành kiểm thử và được phê duyệt sẽ được hợp nhất vào nhánh này. Nhánh này được bảo vệ nghiêm ngặt (Protected branch).
- **Nhánh tính năng và sửa lỗi (Feature / Bugfix branches):**
  - Mọi thành viên đóng góp đều phải tạo nhánh làm việc từ nhánh `unstable` mới nhất.
  - Quy ước đặt tên nhánh:
    - `feat/<ten-tinh-nang>`: Phát triển tính năng mới (ví dụ: `feat/payment-vnpay-integration`).
    - `fix/<ten-loi>`: Khắc phục sự cố kỹ thuật (ví dụ: `fix/seat-holding-race-condition`).
    - `docs/<noi-dung>`: Cập nhật hoặc bổ sung tài liệu (ví dụ: `docs/api-specs-update`).
    - `refactor/<pham-vi>`: Tái cấu trúc mã nguồn không làm thay đổi hành vi hệ thống.

## 3. Quy định về quyền hợp nhất mã (Merge Policy)

- Hai nhánh `stable` và `unstable` được bảo vệ bằng GitHub Branch Protection Rules kết hợp Repository Rulesets.
- **Chỉ có duy nhất Repository Admin (`ha1nz9vk`) có quyền phê duyệt và hợp nhất code** vào nhánh `unstable` và `stable`.
- Các cộng tác viên và thành viên đóng góp không có quyền đẩy trực tiếp (`git push`) lên nhánh `stable` và `unstable`, đồng thời không có quyền tự hợp nhất Pull Request.
- Mọi thay đổi phải đi qua quy trình Pull Request (PR) trỏ đích về nhánh `unstable`.

## 4. Thiết lập môi trường phát triển cục bộ

1. Yêu cầu công cụ:
   - Node.js phiên bản 22 LTS trở lên
   - pnpm phiên bản 9 trở lên
   - Docker hoặc Podman cùng Docker Compose

2. Cài đặt các gói phụ thuộc:

   ```bash
   pnpm install
   ```

3. Khởi chạy cơ sở hạ tầng cục bộ (PostgreSQL 16 và Redis 7):

   ```bash
   docker compose up -d
   ```

4. Thiết lập cấu hình môi trường:

   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env
   ```

5. Chạy migration lược đồ cơ sở dữ liệu và nạp dữ liệu mẫu:

   ```bash
   pnpm --filter @tickethub/api db:migrate
   pnpm --filter @tickethub/api db:seed
   ```

6. Chạy ứng dụng ở chế độ phát triển:
   ```bash
   pnpm dev
   ```

## 5. Tiêu chuẩn mã nguồn (Code Standards)

- **TypeScript nghiêm ngặt:** Kích hoạt chế độ kiểm tra toàn diện (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`). Không sử dụng kiểu `any`. Định nghĩa kiểu rõ ràng cho tham số và giá trị trả về; sử dụng kiểu `unknown` kết hợp Zod schema đối với dữ liệu từ bên ngoài.
- **Tổ chức mã dùng chung:** Toàn bộ Zod schemas, hằng số dùng chung và interface dữ liệu giữa client và server phải đặt trong package `packages/shared`.
- **An toàn giao dịch:** Logic giữ chỗ, mua vé và thanh toán phải thực thi trong database transaction của PostgreSQL với cơ chế khóa hàng (`SELECT ... FOR UPDATE` sắp xếp `id ASC`) để triệt tiêu nguy cơ tranh chấp hoặc bế tắc (deadlock).
- **Gửi thông báo phi đồng bộ:** Không gọi API bên thứ ba (email, SMS) trực tiếp trong transaction của đơn hàng; bắt buộc sử dụng bảng `outbox` (Transactional Outbox pattern).
- **Kiểm tra định dạng:** Sử dụng Prettier để kiểm tra tính nhất quán trước khi tạo commit:
  ```bash
  pnpm format:check
  ```

## 6. Quy chuẩn Commit (Conventional Commits)

- Thông điệp commit tuân thủ quy chuẩn Conventional Commits:
  ```
  <type>(<scope>): <mo ta ngan gon>
  ```
- **Các giá trị type hợp lệ:**
  - `feat`: Tính năng mới.
  - `fix`: Sửa lỗi hệ thống.
  - `docs`: Cập nhật tài liệu kỹ thuật.
  - `refactor`: Tái cấu trúc mã nguồn.
  - `test`: Thêm hoặc sửa đổi bài kiểm thử.
  - `chore`: Cấu hình phụ thuộc, công cụ phát triển hoặc tác vụ bảo trì.
- **Scope thường dùng:** `api`, `web`, `shared`, `auth`, `booking`, `events`, `config`.
- **Quy định quan trọng:** Không chèn biểu tượng cảm xúc hoặc ký tự tượng hình vào tiêu đề và nội dung commit.

## 7. Tiêu chuẩn kiểm thử (Testing Guidelines)

- Toàn bộ bài kiểm thử phải vượt qua thành công trước khi gửi Pull Request:
  ```bash
  pnpm test
  ```
- Kiểm thử logic xử lý tranh chấp ghế, thanh toán và kiểm soát vé phải chạy trực tiếp với cơ sở dữ liệu PostgreSQL và Redis thật (không dùng mock cho các giao dịch trạng thái cốt lõi).
- Các thay đổi liên quan đến tồn kho vé phải có ca kiểm thử đồng thời (tối thiểu 50 yêu cầu song song).
- Đối với mã nguồn có sự hỗ trợ của AI, bài kiểm thử phải bao quát các trường hợp biên (edge cases), kiểm tra tính toàn vẹn dữ liệu và xác minh hành vi thực tế trước khi gửi Pull Request.

## 8. Quy định về mã nguồn do AI hỗ trợ (AI-Generated Code)

- **Trách nhiệm của người đóng góp:** Người gửi Pull Request chịu trách nhiệm kỹ thuật đối với toàn bộ mã nguồn được gửi lên, bao gồm cả mã do các công cụ AI tạo hoặc hỗ trợ viết. Người đóng góp phải đọc hiểu từng dòng mã và giải thích được chi tiết logic khi được yêu cầu trong quá trình xem xét mã nguồn.
- **Yêu cầu kiểm thử bắt buộc:** Mọi đoạn mã do AI sinh ra phải được kiểm thử trực tiếp trên môi trường chạy thực tế và có bộ kiểm thử tự động (unit test, integration test) đi kèm để xác minh hành vi trước khi gửi đóng góp. Không chấp nhận mã nguồn chưa qua kiểm thử thực tế hoặc chỉ dựa vào suy đoán của mô hình AI.
- **Kiểm soát tính chính xác của phụ thuộc:** Không sử dụng các hàm, API hoặc gói phụ thuộc (dependency) không tồn tại do mô hình AI tự tạo. Mọi gói phụ thuộc mới phải được xác thực nguồn gốc và kiểm tra trước khi thêm vào `package.json`.
- **Tuân thủ chuẩn mã nguồn và kiến trúc:** Mã nguồn do AI tạo phải tuân thủ đầy đủ quy chuẩn TypeScript nghiêm ngặt (không sử dụng `any`), đúng các mẫu kiến trúc quy định tại [docs/DEVELOPMENT_STANDARDS.md](docs/DEVELOPMENT_STANDARDS.md), không chứa mã thừa không sử dụng và không làm suy giảm hiệu năng hoặc tính bảo mật của hệ thống.

## 9. Quy trình gửi Pull Request (PR Process)

1. Cập nhật nhánh làm việc với trạng thái mới nhất của nhánh `unstable`:
   ```bash
   git fetch origin
   git rebase origin/unstable
   ```
2. Đẩy nhánh làm việc lên kho lưu trữ cá nhân hoặc remote.
3. Tạo Pull Request với nhánh đích là `unstable`.
4. Điền đầy đủ thông tin vào mô tả PR:
   - Mục đích và phạm vi kỹ thuật của thay đổi.
   - Danh sách các ca kiểm thử đã thực thi cùng kết quả đạt được.
   - Các lưu ý về di chuyển dữ liệu (nếu có migration mới).
5. Phối hợp giải quyết phản hồi từ Maintainer (`ha1nz9vk`) trong quá trình xem xét mã nguồn. Nhánh chỉ được hợp nhất sau khi Maintainer phê duyệt.
