# Kế Hoạch Triển Khai Phân Hệ Đối Soát Giao Dịch & Quyết Toán Doanh Thu Ban Tổ Chức (Reconciliations & Payouts)

> **Dành cho kỹ sư thực thi (Agentic Workers):** KỸ NĂNG BẮT BUỘC: Sử dụng `superpowers:subagent-driven-development` (khuyến nghị) hoặc `superpowers:executing-plans` để triển khai kế hoạch này theo từng tác vụ. Các bước sử dụng cú pháp checkbox (`- [ ]`) để theo dõi tiến độ.

**Mục tiêu:** Xây dựng hoàn chỉnh mô đun Backend độc lập `PayoutsModule` xử lý nghiệp vụ đối soát giao dịch thanh toán VNPay (`GET /api/v1/admin/reconciliations`) và chu trình tính toán, phê duyệt quyết toán chi trả doanh thu cho Ban tổ chức (`/admin/payouts`, `/organizer/payouts`).

**Kiến trúc:** Kiến trúc NestJS phân tầng sạch sẽ (`PayoutsModule`) tích hợp trực tiếp PostgreSQL qua Drizzle ORM (`payouts`, `orders`, `transactions`, `refunds`, `audit_log`), áp dụng thuật toán tính toán tài chính chống khấu trừ trùng (No Double-Deduction), bảo vệ kiểm soát truy cập RBAC (`ADMIN` vs `ORGANIZER`) và phòng chống IDOR triệt để.

**Công nghệ:** NestJS, TypeScript, Drizzle ORM, PostgreSQL, Zod, Vitest / Jest, Supertest.

**Tài liệu thiết kế:** [docs/superpowers/specs/2026-11-06-reconciliations-payouts-design.md](file:///home/user/Downloads/Projects/tickethub/docs/superpowers/specs/2026-11-06-reconciliations-payouts-design.md)

---

## Ràng Buộc Toàn Cục (Global Constraints)

- Tuân thủ Hiến chương dự án [AGENTS.md](file:///home/user/Downloads/Projects/tickethub/AGENTS.md): 0 emoji, không dùng en-dash (`–`) hoặc em-dash (`—`), sử dụng tiếng Việt kỹ thuật chuẩn, liên kết tệp dạng `file://`.
- Kiểm soát truy cập RBAC: Chỉ vai trò `ADMIN` mới có quyền truy cập các endpoint `/api/v1/admin/payouts/*` và `/api/v1/admin/reconciliations`. Ban tổ chức (`ORGANIZER`) chỉ được xem các bản ghi quyết toán của chính sự kiện mình quản lý (chặn triệt để IDOR).
- Bất biến Audit Log: Mọi hành động phê duyệt (`APPROVE_PAYOUT`) hoặc tạm giữ (`HOLD_PAYOUT`) bắt buộc ghi mới vào bảng `audit_log` (append-only), không chỉnh sửa hoặc xóa dữ liệu kiểm toán.
- Chính xác tài chính: Số tiền làm tròn nguyên vẹn bằng `Math.round()`, không để phát sinh số thập phân lẻ trong các phép tính tiền tệ VND.

---

## Trọng Tâm Rà Soát (Review Focus)

1. Sự kiện có đơn hàng bị hoàn tiền 100% (chuyển sang `REFUNDED`): Thuật toán phải cộng `finalAmount` vào `grossRevenue` trước khi trừ `refundDeduction` để không bị double-deduction.
2. Cố gắng phê duyệt lại một lệnh quyết toán đã ở trạng thái `PAID_OUT`: Hệ thống phải trả về lỗi `ConflictException` (409) hoặc `BadRequestException` (400) để ngăn chặn double-approval.
3. Ban tổ chức A cố gắng đọc lệnh chi trả của Ban tổ chức B: API `GET /api/v1/organizer/payouts` phải lọc nghiêm ngặt theo `organizerId` của tài khoản đang đăng nhập, không để rò rỉ dữ liệu.
4. Lệnh quyết toán đang ở trạng thái `HOLD`: Quản trị viên có thể kích hoạt tính toán lại (`recalculate`) hoặc phê duyệt trực tiếp (`approve`) sau khi các khiếu nại hoàn tiền được giải quyết.
5. Giao dịch mồ côi (Orphan Transaction): Phản hồi đối soát phải chấp nhận `orderId: null` và `orderCode: null` khi bản ghi giao dịch không khớp với đơn hàng nào trong hệ thống.

---

### Tác Vụ 1: Định Nghĩa Schemas & Types Trong `@tickethub/shared`

**Tệp tin:**
- Tạo mới: `packages/shared/src/schemas/payout.schema.ts`
- Chỉnh sửa: `packages/shared/src/index.ts`
- Kiểm thử: `packages/shared` build verification

**Giao diện:**
- Cung cấp:
  - `ReconciliationStatus`: Enum / const object `('MATCHED', 'AMOUNT_MISMATCH', 'MISSING_TRANSACTION', 'ORPHAN_TRANSACTION')`
  - `ReconciliationQuerySchema`: `{ eventId?: string; status?: ReconciliationStatus | 'ALL'; page?: number; limit?: number }`
  - `GeneratePayoutSchema`: `{ eventId: string }`
  - `HoldPayoutSchema`: `{ reason: string }`
  - `ApprovePayoutResponseSchema`: `{ id: string; status: 'PAID_OUT'; approvedBy: string; paidOutAt: string; message: string }`

- [ ] **Bước 1: Viết Zod schemas trong `packages/shared/src/schemas/payout.schema.ts`**
- [ ] **Bước 2: Export schema và type trong `packages/shared/src/index.ts`**
- [ ] **Bước 3: Biên dịch `@tickethub/shared`**
  - Chạy lệnh: `pnpm --filter @tickethub/shared build`
  - Kết quả mong đợi: Biên dịch thành công 0 lỗi.
- [ ] **Bước 4: Commit Git**
  - Chạy lệnh:
    ```bash
    git add packages/shared/src/schemas/payout.schema.ts packages/shared/src/index.ts
    git commit -m "feat(shared): add validation schemas and types for reconciliations and payouts"
    ```

---

### Tác Vụ 2: Thuật Toán Tính Toán Quyết Toán Tài Chính (Payout Calculator) & Unit Test

**Tệp tin:**
- Tạo mới: `apps/api/src/payouts/payout-calculator.ts`
- Tạo mới: `apps/api/src/payouts/payout-calculator.spec.ts`

**Giao diện:**
- Nhận:
  - `calculatePayout(grossRevenue: number, refundDeduction: number, platformFeeRate = 0.05, gatewayFeeRate = 0.015)`
- Trả về:
  - `{ grossRevenue: number; refundDeduction: number; retainedRevenue: number; platformFee: number; gatewayFee: number; netPayout: number }`

- [ ] **Bước 1: Viết ca kiểm thử đơn vị thất bại trong `payout-calculator.spec.ts`**
  - Kiểm tra tính toán tiêu chuẩn: Doanh thu 100.000.000 VND, hoàn tiền 2.000.000 VND -> Doanh thu thực giữ 98.000.000 VND, phí sàn (5%) 4.900.000 VND, phí cổng (1.5%) 1.500.000 VND -> netPayout = 91.600.000 VND.
  - Kiểm tra biên: Doanh thu 0 VND, hoàn tiền 100%, làm tròn tiền tệ VND không có số thập phân.
- [ ] **Bước 2: Chạy kiểm thử để xác nhận thất bại**
  - Chạy lệnh: `pnpm --filter api test apps/api/src/payouts/payout-calculator.spec.ts`
  - Kết quả: Thất bại do chưa có file `payout-calculator.ts`.
- [ ] **Bước 3: Cài đặt logic trong `apps/api/src/payouts/payout-calculator.ts`**
- [ ] **Bước 4: Chạy kiểm thử xác nhận thành công**
  - Chạy lệnh: `pnpm --filter api test apps/api/src/payouts/payout-calculator.spec.ts`
  - Kết quả: PASS tất cả các ca kiểm thử.
- [ ] **Bước 5: Commit Git**
  - Chạy lệnh:
    ```bash
    git add apps/api/src/payouts/payout-calculator.ts apps/api/src/payouts/payout-calculator.spec.ts
    git commit -m "feat(api): implement payout financial calculator with unit tests"
    ```

---

### Tác Vụ 3: Triển Khai `PayoutsService` Và `ReconciliationsService`

**Tệp tin:**
- Tạo mới: `apps/api/src/payouts/payouts.service.ts`
- Tạo mới: `apps/api/src/payouts/reconciliations.service.ts`

**Giao diện:**
- `PayoutsService`:
  - `generatePayout(eventId: string, adminUserId: string)`: Tính toán và tạo/cập nhật bản ghi `payouts` ở trạng thái `PENDING` (chặn nếu đã `PAID_OUT`).
  - `approvePayout(payoutId: string, adminUserId: string, ip?: string, userAgent?: string)`: Chuyển `PAID_OUT`, lưu `approvedBy`, `paidOutAt`, ghi `audit_log`.
  - `holdPayout(payoutId: string, reason: string, adminUserId: string, ip?: string, userAgent?: string)`: Chuyển `HOLD`, lưu `holdReason`, ghi `audit_log`.
  - `recalculatePayout(payoutId: string, adminUserId: string)`: Tính toán lại số liệu cho payout đang ở `PENDING` hoặc `HOLD`.
  - `getAdminPayouts(query: { status?: string; organizerId?: string; eventId?: string; page?: number; limit?: number })`
  - `getOrganizerPayouts(organizerProfileId: string, query: { page?: number; limit?: number })`
- `ReconciliationsService`:
  - `getReconciliations(query: { eventId?: string; status?: string; page?: number; limit?: number })`: Đối soát dữ liệu giữa `orders`, `transactions` và `refunds`, trả về `summary` và `items`.

- [ ] **Bước 1: Viết `PayoutsService` với đầy đủ nghiệp vụ truy vấn Drizzle ORM, tính toán và ghi audit_log**
- [ ] **Bước 2: Viết `ReconciliationsService` với thuật toán đối soát 4 trạng thái (`MATCHED`, `AMOUNT_MISMATCH`, `MISSING_TRANSACTION`, `ORPHAN_TRANSACTION`) và khối thống kê `summary`**
- [ ] **Bước 3: Kiểm tra biên dịch TypeScript**
  - Chạy lệnh: `pnpm --filter api build`
- [ ] **Bước 4: Commit Git**
  - Chạy lệnh:
    ```bash
    git add apps/api/src/payouts/payouts.service.ts apps/api/src/payouts/reconciliations.service.ts
    git commit -m "feat(api): implement payouts and reconciliations database services"
    ```

---

### Tác Vụ 4: Triển Khai Controllers, Module Và Đăng Ký Ứng Dụng

**Tệp tin:**
- Tạo mới: `apps/api/src/payouts/admin-payouts.controller.ts`
- Tạo mới: `apps/api/src/payouts/organizer-payouts.controller.ts`
- Tạo mới: `apps/api/src/payouts/payouts.module.ts`
- Chỉnh sửa: `apps/api/src/app.module.ts`

**Giao diện:**
- `AdminPayoutsController`:
  - `GET /api/v1/admin/reconciliations`
  - `GET /api/v1/admin/payouts`
  - `POST /api/v1/admin/payouts/generate`
  - `POST /api/v1/admin/payouts/:id/approve`
  - `POST /api/v1/admin/payouts/:id/hold`
  - `POST /api/v1/admin/payouts/:id/recalculate`
- `OrganizerPayoutsController`:
  - `GET /api/v1/organizer/payouts`
- Bảo vệ: `JwtAuthGuard`, `RolesGuard` với `UserRole.ADMIN` hoặc `UserRole.ORGANIZER`.

- [ ] **Bước 1: Tạo `AdminPayoutsController` với đầy đủ decorators và xử lý request/response**
- [ ] **Bước 2: Tạo `OrganizerPayoutsController` lấy `organizerProfileId` từ `CurrentUser` để chặn IDOR**
- [ ] **Bước 3: Tạo `PayoutsModule` và import vào `AppModule`**
- [ ] **Bước 4: Kiểm tra lint và build**
  - Chạy lệnh: `pnpm --filter api lint && pnpm --filter api build`
- [ ] **Bước 5: Commit Git**
  - Chạy lệnh:
    ```bash
    git add apps/api/src/payouts/admin-payouts.controller.ts apps/api/src/payouts/organizer-payouts.controller.ts apps/api/src/payouts/payouts.module.ts apps/api/src/app.module.ts
    git commit -m "feat(api): add admin and organizer payouts controllers and module"
    ```

---

### Tác Vụ 5: Xây Dựng Bộ Kiểm Thử Tích Hợp Đầy Đủ (Integration Tests)

**Tệp tin:**
- Tạo mới: `apps/api/test/payouts.integration.test.ts`

**Nội dung kiểm thử:**
1. Khởi tạo lệnh chi trả qua `POST /api/v1/admin/payouts/generate` tính toán chính xác số dư.
2. Tạm giữ lệnh chi trả qua `POST /api/v1/admin/payouts/:id/hold` với lý do tranh chấp.
3. Tính toán lại qua `POST /api/v1/admin/payouts/:id/recalculate`.
4. Phê duyệt chi trả qua `POST /api/v1/admin/payouts/:id/approve`, kiểm chứng chuyển `PAID_OUT` và ghi vết `audit_log`.
5. Chặn phê duyệt kép (trả về 400 hoặc 409 khi lệnh đã `PAID_OUT`).
6. Đối soát `GET /api/v1/admin/reconciliations` phân loại chính xác các giao dịch khớp và lệch tiền.
7. Chặn IDOR: Ban tổ chức chỉ xem được quyết toán của sự kiện mình quản lý.

- [ ] **Bước 1: Viết test suite tích hợp trong `apps/api/test/payouts.integration.test.ts`**
- [ ] **Bước 2: Chạy test suite tích hợp**
  - Chạy lệnh: `pnpm --filter api test apps/api/test/payouts.integration.test.ts`
  - Kết quả: PASS 100%.
- [ ] **Bước 3: Commit Git**
  - Chạy lệnh:
    ```bash
    git add apps/api/test/payouts.integration.test.ts
    git commit -m "test(api): add comprehensive integration test suite for reconciliations and payouts"
    ```

---

### Tác Vụ 6: Đồng Bộ Hóa Hợp Đồng API & Kiểm Định Toàn Hệ Thống

**Tệp tin:**
- Chỉnh sửa: `docs/API_CONTRACT.md`
- Chỉnh sửa: `docs/TEAM_REALIGNMENT_W03_W04.md` (nếu cần)

- [ ] **Bước 1: Gỡ bỏ nhãn `[PLANNED]` tại `GET /api/v1/admin/reconciliations` và `POST /api/v1/admin/payouts/:id/approve`, bổ sung chi tiết hợp đồng của `generate`, `hold`, `recalculate` và `GET /api/v1/organizer/payouts` trong `docs/API_CONTRACT.md`**
- [ ] **Bước 2: Chạy kiểm tra tính đồng bộ tài liệu**
  - Chạy lệnh: `export PATH="/home/user/.local/node/bin:$PATH" && node scripts/audit-doc-parity.mjs`
  - Kết quả mong đợi: `XÁC NHẬN: Mã nguồn và Tài liệu đồng bộ hoàn toàn 100%!`.
- [ ] **Bước 3: Chạy toàn bộ kiểm tra hệ thống**
  - Chạy lệnh: `pnpm lint && pnpm build && pnpm test`
- [ ] **Bước 4: Commit Git hoàn tất**
  - Chạy lệnh:
    ```bash
    git add docs/API_CONTRACT.md docs/TEAM_REALIGNMENT_W03_W04.md
    git commit -m "docs: sync api contract for reconciliations and payouts module completion"
    ```
