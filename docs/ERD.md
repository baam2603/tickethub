# Thiết kế cơ sở dữ liệu

Tài liệu này đặc tả lược đồ quan hệ, các ràng buộc toàn vẹn và cơ chế kiểm soát tranh chấp dữ liệu trên PostgreSQL 16/17 cho hệ thống TicketHub.

## Sơ đồ quan hệ thực thể

```mermaid
erDiagram
    USERS ||--o{ ORGANIZER_PROFILES : "nộp hồ sơ"
    USERS ||--o{ ORDERS : "đặt hàng"
    USERS ||--o{ TICKETS : "sở hữu"
    USERS ||--o{ EVENT_STAFF : "được phân công"
    USERS ||--o{ AUDIT_LOGS : "thực hiện"

    ORGANIZER_PROFILES ||--o{ EVENTS : "sở hữu"
    ORGANIZER_PROFILES ||--o{ PAYOUTS : "nhận chi trả"

    VENUES ||--o{ VENUE_LAYOUTS : "có các sơ đồ"
    VENUES ||--o{ EVENTS : "tổ chức tại"
    VENUE_LAYOUTS ||--o{ EVENTS : "áp dụng sơ đồ"

    EVENTS ||--o{ TICKET_TYPES : "chứa hạng vé"
    EVENTS ||--o{ SEATS : "chứa ghế"
    EVENTS ||--o{ ORDERS : "thuộc sự kiện"
    EVENTS ||--o{ TICKETS : "phát hành"
    EVENTS ||--o{ GATES : "có cổng vào"
    EVENTS ||--o{ EVENT_STAFF : "phân công nhân viên"
    EVENTS ||--o{ PAYOUTS : "quyết toán"

    TICKET_TYPES ||--o{ SEATS : "phân loại ghế"
    TICKET_TYPES ||--o{ ORDER_ITEMS : "được đặt"
    TICKET_TYPES ||--o{ TICKETS : "phân loại vé"

    SEATS ||--o| ORDER_ITEMS : "gán vào đơn"
    SEATS ||--o| TICKETS : "liên kết vé"

    ORDERS ||--|{ ORDER_ITEMS : "chứa các mục"
    ORDERS ||--o{ TRANSACTIONS : "thanh toán qua"
    ORDERS ||--o{ TICKETS : "sinh vé khi thanh toán"
    ORDERS ||--o{ REFUNDS : "hoàn tiền"

    GATES ||--o{ EVENT_STAFF : "gán nhân viên trực"
    GATES ||--o{ TICKETS : "ghi nhận soát vé"

    TRANSACTIONS ||--o{ REFUNDS : "hoàn từ giao dịch"

    USERS {
        uuid id PK
        varchar email UK
        varchar phone
        varchar full_name
        varchar password_hash
        enum role "BUYER | ORGANIZER | GATE_STAFF | ADMIN"
        enum status "PENDING_EMAIL | ACTIVE | LOCKED"
        timestamptz email_verified_at
        int failed_login_attempts
        timestamptz locked_until
        timestamptz created_at
        timestamptz updated_at
    }

    ORGANIZER_PROFILES {
        uuid id PK
        uuid user_id FK,UK
        varchar organization_name
        varchar tax_code
        varchar business_license_url
        varchar representative_name
        enum status "PENDING_VERIFICATION | VERIFIED | REJECTED"
        text rejection_reason
        uuid verified_by FK
        timestamptz verified_at
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    VENUES {
        uuid id PK
        varchar name
        varchar short_name
        varchar city "TP. Hồ Chí Minh | Hà Nội | Đà Nẵng"
        varchar district
        text address
        enum category "stadium | arena | theater | sports"
        varchar total_capacity
        varchar thumbnail_url
        text description
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    VENUE_LAYOUTS {
        uuid id PK
        uuid venue_id FK
        varchar name
        varchar category_name
        text description
        varchar capacity_estimate
        varchar map_key
        text svg_content
        jsonb default_zones
        boolean is_default
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    EVENTS {
        uuid id PK
        uuid organizer_id FK
        uuid venue_id FK
        uuid venue_layout_id FK
        varchar title
        varchar slug UK
        text description
        varchar category
        varchar banner_url
        varchar venue_name
        text venue_address
        varchar city
        timestamptz start_time
        timestamptz end_time
        timestamptz gate_opening_time
        enum status "DRAFT | PENDING_APPROVAL | PUBLISHED | ENDED | CANCELLED | SUSPENDED"
        text rejection_reason
        enum refund_policy_type "STRICT | FLEXIBLE | CUSTOM | NO_REFUND"
        jsonb refund_policy_rules
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    TICKET_TYPES {
        uuid id PK
        uuid event_id FK
        varchar name
        text description
        numeric price
        int capacity
        int held_count
        int sold_count
        boolean is_seated
        timestamptz sale_start_time
        timestamptz sale_end_time
        int max_per_order
        int sort_order
        timestamptz created_at
        timestamptz updated_at
    }

    SEATS {
        uuid id PK
        uuid event_id FK
        uuid ticket_type_id FK
        varchar zone_name
        varchar row_label
        varchar seat_number
        enum status "AVAILABLE | HELD | SOLD | BLOCKED"
        uuid hold_order_id FK
        timestamptz hold_expires_at
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    ORDERS {
        uuid id PK
        varchar order_code UK
        uuid user_id FK
        uuid event_id FK
        numeric total_amount
        numeric discount_amount
        numeric final_amount
        enum status "PENDING | PAID | EXPIRED | FAILED | CANCELLED | REFUNDED | PAYMENT_EXPIRED_REFUND_PENDING"
        timestamptz expires_at
        timestamptz paid_at
        varchar voucher_code
        timestamptz created_at
        timestamptz updated_at
    }

    ORDER_ITEMS {
        uuid id PK
        uuid order_id FK
        uuid ticket_type_id FK
        uuid seat_id FK
        int quantity
        numeric unit_price
        numeric subtotal
        timestamptz created_at
    }

    TICKETS {
        uuid id PK
        varchar ticket_code UK
        uuid order_id FK
        uuid user_id FK
        uuid event_id FK
        uuid ticket_type_id FK
        uuid seat_id FK
        enum status "SOLD | CHECKED_IN | CANCELLED"
        timestamptz checked_in_at
        uuid gate_id FK
        uuid checked_in_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    TRANSACTIONS {
        uuid id PK
        uuid order_id FK
        varchar provider "VNPAY"
        varchar transaction_ref UK
        varchar provider_tx_number
        numeric amount
        varchar response_code
        varchar bank_code
        varchar vnp_create_date
        varchar payment_url
        timestamptz pay_date
        enum status "PENDING | SUCCESS | FAILED"
        jsonb raw_callback
        varchar idempotency_key UK
        timestamptz created_at
        timestamptz updated_at
    }

    REFUNDS {
        uuid id PK
        uuid order_id FK
        uuid ticket_id FK
        numeric amount
        text reason
        enum status "PENDING | PROCESSING | COMPLETED | FAILED"
        varchar provider_request_id UK
        timestamptz last_attempt_at
        timestamptz next_retry_at
        varchar provider_refund_ref
        varchar idempotency_key UK
        int retry_count
        text error_message
        timestamptz processed_at
        timestamptz created_at
        timestamptz updated_at
    }

    GATES {
        uuid id PK
        uuid event_id FK
        varchar name
        varchar location_desc
        timestamptz created_at
    }

    EVENT_STAFF {
        uuid id PK
        uuid event_id FK
        uuid user_id FK
        uuid gate_id FK
        varchar staff_role
        timestamptz created_at
    }

    PAYOUTS {
        uuid id PK
        uuid organizer_id FK
        uuid event_id FK
        numeric total_revenue
        numeric platform_fee
        numeric gateway_fee
        numeric refund_deduction
        numeric net_payout
        enum status "PENDING | HOLD | PAID_OUT"
        text hold_reason
        timestamptz paid_out_at
        uuid approved_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    AUDIT_LOGS {
        bigserial id PK
        uuid actor_id
        varchar actor_role
        varchar action
        varchar target_type
        varchar target_id
        jsonb changes
        inet ip_address
        varchar user_agent
        timestamptz created_at
    }

    OUTBOX {
        uuid id PK
        varchar event_type
        jsonb payload
        enum status "PENDING | PROCESSING | COMPLETED | FAILED"
        int retry_count
        timestamptz next_retry_at
        text error_message
        timestamptz created_at
        timestamptz updated_at
    }

    IDEMPOTENCY_KEYS {
        varchar key PK
        uuid user_id
        varchar path
        int response_status
        jsonb response_body
        timestamptz created_at
        timestamptz expires_at
    }
```

## Đặc tả các bảng

### users

Lưu trữ tài khoản người dùng của các vai trò trong hệ thống.

| Cột                   | Kiểu         | Ràng buộc                                                                                | Diễn giải                        |
| :-------------------- | :----------- | :--------------------------------------------------------------------------------------- | :------------------------------- |
| id                    | UUID         | PRIMARY KEY DEFAULT gen_random_uuid()                                                    | Khóa chính                       |
| email                 | VARCHAR(255) | NOT NULL UNIQUE                                                                          | Email đăng nhập                  |
| phone                 | VARCHAR(20)  | NULL                                                                                     | Số điện thoại                    |
| full_name             | VARCHAR(150) | NOT NULL                                                                                 | Họ và tên                        |
| password_hash         | VARCHAR(255) | NOT NULL                                                                                 | Mật khẩu mã hóa Argon2id         |
| role                  | VARCHAR(20)  | NOT NULL CHECK (role IN ('BUYER', 'ORGANIZER', 'GATE_STAFF', 'ADMIN'))                   | Vai trò người dùng               |
| status                | VARCHAR(25)  | NOT NULL DEFAULT 'PENDING_EMAIL' CHECK (status IN ('PENDING_EMAIL', 'ACTIVE', 'LOCKED')) | Trạng thái tài khoản             |
| email_verified_at     | TIMESTAMPTZ  | NULL                                                                                     | Thời điểm xác thực email         |
| failed_login_attempts | INT          | NOT NULL DEFAULT 0                                                                       | Số lần đăng nhập sai liên tiếp   |
| locked_until          | TIMESTAMPTZ  | NULL                                                                                     | Thời điểm hết hạn khóa tài khoản |
| created_at            | TIMESTAMPTZ  | NOT NULL DEFAULT now()                                                                   | Thời điểm tạo                    |
| updated_at            | TIMESTAMPTZ  | NOT NULL DEFAULT now()                                                                   | Thời điểm cập nhật cuối          |

Chỉ mục:

- `CREATE UNIQUE INDEX idx_users_email ON users(email);`
- `CREATE INDEX idx_users_role_status ON users(role, status);`

### organizer_profiles

Lưu hồ sơ pháp lý của ban tổ chức để quản trị viên kiểm duyệt.

| Cột                  | Kiểu         | Ràng buộc                                                                                                  | Diễn giải                                 |
| :------------------- | :----------- | :--------------------------------------------------------------------------------------------------------- | :---------------------------------------- |
| id                   | UUID         | PRIMARY KEY DEFAULT gen_random_uuid()                                                                      | Khóa chính                                |
| user_id              | UUID         | NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE                                                     | Khóa ngoại người dùng                     |
| organization_name    | VARCHAR(255) | NOT NULL                                                                                                   | Tên đơn vị tổ chức                        |
| tax_code             | VARCHAR(50)  | NOT NULL                                                                                                   | Mã số thuế                                |
| business_license_url | VARCHAR(500) | NOT NULL                                                                                                   | Đường dẫn giấy phép kinh doanh trên S3/R2 |
| representative_name  | VARCHAR(150) | NOT NULL                                                                                                   | Người đại diện theo pháp luật             |
| status               | VARCHAR(25)  | NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED')) | Trạng thái phê duyệt                      |
| rejection_reason     | TEXT         | NULL                                                                                                       | Lý do từ chối hồ sơ                       |
| verified_by          | UUID         | NULL REFERENCES users(id)                                                                                  | Quản trị viên kiểm duyệt                  |
| verified_at          | TIMESTAMPTZ  | NULL                                                                                                       | Thời điểm phê duyệt                       |
| version              | INT          | NOT NULL DEFAULT 1                                                                                         | Phiên bản dùng cho optimistic locking     |
| created_at           | TIMESTAMPTZ  | NOT NULL DEFAULT now()                                                                                     | Thời điểm tạo                             |
| updated_at           | TIMESTAMPTZ  | NOT NULL DEFAULT now()                                                                                     | Thời điểm cập nhật cuối                   |

### venues

Lưu thông tin các địa điểm tổ chức sự kiện tiêu chuẩn (Curated Venues) đã được quản trị viên kiểm duyệt tại 3 thành phố lớn: TP. Hồ Chí Minh, Hà Nội và Đà Nẵng.

| Cột            | Kiểu         | Ràng buộc                                                              | Diễn giải                               |
| :------------- | :----------- | :--------------------------------------------------------------------- | :-------------------------------------- |
| id             | UUID         | PRIMARY KEY DEFAULT gen_random_uuid()                                  | Khóa chính                              |
| name           | VARCHAR(255) | NOT NULL                                                               | Tên đầy đủ của địa điểm                 |
| short_name     | VARCHAR(100) | NOT NULL                                                               | Tên gọi rút gọn hoặc viết tắt           |
| city           | VARCHAR(50)  | NOT NULL CHECK (city IN ('TP. Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng'))      | Thành phố trực thuộc trung ương         |
| district       | VARCHAR(100) | NOT NULL                                                               | Quận / Huyện                            |
| address        | TEXT         | NOT NULL                                                               | Địa chỉ số nhà và tên đường             |
| category       | VARCHAR(50)  | NOT NULL CHECK (category IN ('stadium', 'arena', 'theater', 'sports')) | Loại hình không gian                    |
| total_capacity | VARCHAR(50)  | NOT NULL                                                               | Sức chứa tổng thể ước tính              |
| thumbnail_url  | VARCHAR(500) | NULL                                                                   | Đường dẫn ảnh đại diện địa điểm         |
| description    | TEXT         | NULL                                                                   | Giới thiệu cơ sở vật chất và tiện ích   |
| is_active      | BOOLEAN      | NOT NULL DEFAULT true                                                  | Trạng thái khả dụng để ban tổ chức chọn |
| created_at     | TIMESTAMPTZ  | NOT NULL DEFAULT now()                                                 | Thời điểm tạo                           |
| updated_at     | TIMESTAMPTZ  | NOT NULL DEFAULT now()                                                 | Thời điểm cập nhật cuối                 |

Chỉ mục:

```sql
CREATE INDEX idx_venues_city_category ON venues(city, category) WHERE is_active = true;
CREATE INDEX idx_venues_fts ON venues USING gin (
    to_tsvector('simple', unaccent(name || ' ' || short_name || ' ' || district || ' ' || address))
);
```

### venue_layouts

Lưu trữ các cấu hình sân khấu và sơ đồ khán đài kiến trúc chuẩn dạng SVG (Live Concert T-stage, Mega Concert, Sân bóng đá, Sàn thi đấu thể thao, Khán phòng nhà hát) liên kết với từng địa điểm tổ chức.

| Cột               | Kiểu         | Ràng buộc                                        | Diễn giải                                                |
| :---------------- | :----------- | :----------------------------------------------- | :------------------------------------------------------- |
| id                | UUID         | PRIMARY KEY DEFAULT gen_random_uuid()            | Khóa chính                                               |
| venue_id          | UUID         | NOT NULL REFERENCES venues(id) ON DELETE CASCADE | Khóa ngoại tham chiếu địa điểm                           |
| name              | VARCHAR(255) | NOT NULL                                         | Tên cấu hình sân khấu (VD: Live Concert Sân Khấu Chữ T)  |
| category_name     | VARCHAR(100) | NOT NULL                                         | Phân loại mục đích sử dụng                               |
| description       | TEXT         | NULL                                             | Chi tiết góc nhìn, vị trí sân khấu và tầm quan sát       |
| capacity_estimate | VARCHAR(50)  | NOT NULL                                         | Phạm vi sức chứa dự kiến                                 |
| map_key           | VARCHAR(100) | NOT NULL                                         | Mã định danh sơ đồ SVG tương thích trong hệ thống        |
| svg_content       | TEXT         | NULL                                             | Mã nguồn SVG đã được admin tối ưu hóa và sanitize        |
| default_zones     | JSONB        | NOT NULL DEFAULT '[]'::jsonb                     | Cấu hình mặc định các phân khu, giá tham chiếu và vị trí |
| is_default        | BOOLEAN      | NOT NULL DEFAULT false                           | Sơ đồ mặc định ưu tiên hiển thị                          |
| is_active         | BOOLEAN      | NOT NULL DEFAULT true                            | Trạng thái cho phép áp dụng                              |
| created_at        | TIMESTAMPTZ  | NOT NULL DEFAULT now()                           | Thời điểm tạo                                            |
| updated_at        | TIMESTAMPTZ  | NOT NULL DEFAULT now()                           | Thời điểm cập nhật cuối                                  |

Chỉ mục:

```sql
CREATE INDEX idx_venue_layouts_venue_id ON venue_layouts(venue_id) WHERE is_active = true;
CREATE INDEX idx_venue_layouts_map_key ON venue_layouts(map_key);
```

### events

Lưu thông tin sự kiện, địa điểm và chính sách hoàn vé.

| Cột                 | Kiểu         | Ràng buộc                                                                                                                | Diễn giải                                              |
| :------------------ | :----------- | :----------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------- |
| id                  | UUID         | PRIMARY KEY DEFAULT gen_random_uuid()                                                                                    | Khóa chính                                             |
| organizer_id        | UUID         | NOT NULL REFERENCES organizer_profiles(id)                                                                               | Ban tổ chức sự kiện                                    |
| venue_id            | UUID         | NULL REFERENCES venues(id)                                                                                               | Khóa ngoại địa điểm chuẩn (nếu chọn từ Curated Venues) |
| venue_layout_id     | UUID         | NULL REFERENCES venue_layouts(id)                                                                                        | Khóa ngoại mẫu sơ đồ khán đài SVG tương ứng            |
| title               | VARCHAR(255) | NOT NULL                                                                                                                 | Tên sự kiện                                            |
| slug                | VARCHAR(255) | NOT NULL UNIQUE                                                                                                          | Định danh đường dẫn                                    |
| description         | TEXT         | NOT NULL                                                                                                                 | Nội dung mô tả sự kiện                                 |
| category            | VARCHAR(50)  | NOT NULL                                                                                                                 | Thể loại sự kiện                                       |
| banner_url          | VARCHAR(500) | NOT NULL                                                                                                                 | Đường dẫn ảnh sự kiện                                  |
| venue_name          | VARCHAR(255) | NOT NULL                                                                                                                 | Tên địa điểm tổ chức                                   |
| venue_address       | TEXT         | NOT NULL                                                                                                                 | Địa chỉ địa điểm                                       |
| city                | VARCHAR(100) | NOT NULL                                                                                                                 | Tỉnh hoặc thành phố                                    |
| start_time          | TIMESTAMPTZ  | NOT NULL                                                                                                                 | Thời gian bắt đầu sự kiện                              |
| end_time            | TIMESTAMPTZ  | NOT NULL CHECK (end_time > start_time)                                                                                   | Thời gian kết thúc sự kiện                             |
| gate_opening_time   | TIMESTAMPTZ  | NOT NULL CHECK (gate_opening_time <= start_time)                                                                         | Thời gian mở cổng soát vé                              |
| status              | VARCHAR(25)  | NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'ENDED', 'CANCELLED', 'SUSPENDED')) | Trạng thái sự kiện                                     |
| rejection_reason    | TEXT         | NULL                                                                                                                     | Lý do quản trị viên từ chối                            |
| refund_policy_type  | VARCHAR(25)  | NOT NULL DEFAULT 'FLEXIBLE' CHECK (refund_policy_type IN ('STRICT', 'FLEXIBLE', 'CUSTOM', 'NO_REFUND'))                  | Loại chính sách hoàn vé                                |
| refund_policy_rules | JSONB        | NOT NULL DEFAULT '[]'::jsonb                                                                                             | Các mốc thời gian và tỷ lệ hoàn tiền                   |
| version             | INT          | NOT NULL DEFAULT 1                                                                                                       | Phiên bản dùng cho optimistic locking                  |
| created_at          | TIMESTAMPTZ  | NOT NULL DEFAULT now()                                                                                                   | Thời điểm tạo                                          |
| updated_at          | TIMESTAMPTZ  | NOT NULL DEFAULT now()                                                                                                   | Thời điểm cập nhật cuối                                |

Chỉ mục:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE INDEX idx_events_fts ON events USING gin (
    to_tsvector('simple', unaccent(title || ' ' || description || ' ' || venue_name || ' ' || city))
);
CREATE INDEX idx_events_search_filters ON events(city, category, start_time, status);
CREATE INDEX idx_events_venue_id ON events(venue_id);
CREATE INDEX idx_events_venue_layout_id ON events(venue_layout_id);
```

### ticket_types

Phân hạng vé, định giá và kiểm soát số lượng phát hành.

| Cột             | Kiểu          | Ràng buộc                                        | Diễn giải                              |
| :-------------- | :------------ | :----------------------------------------------- | :------------------------------------- |
| id              | UUID          | PRIMARY KEY DEFAULT gen_random_uuid()            | Khóa chính                             |
| event_id        | UUID          | NOT NULL REFERENCES events(id) ON DELETE CASCADE | Khóa ngoại sự kiện                     |
| name            | VARCHAR(100)  | NOT NULL                                         | Tên hạng vé                            |
| description     | TEXT          | NULL                                             | Mô tả quyền lợi                        |
| price           | NUMERIC(14,2) | NOT NULL CHECK (price >= 0)                      | Giá vé đơn vị VNĐ                      |
| capacity        | INT           | NOT NULL CHECK (capacity > 0)                    | Số lượng vé phát hành                  |
| held_count      | INT           | NOT NULL DEFAULT 0 CHECK (held_count >= 0)       | Số vé đang được giữ tạm thời           |
| sold_count      | INT           | NOT NULL DEFAULT 0 CHECK (sold_count >= 0)       | Số vé đã thanh toán thành công         |
| is_seated       | BOOLEAN       | NOT NULL DEFAULT true                            | true nếu có số ghế, false nếu khu đứng |
| sale_start_time | TIMESTAMPTZ   | NOT NULL                                         | Thời điểm bắt đầu bán                  |
| sale_end_time   | TIMESTAMPTZ   | NOT NULL CHECK (sale_end_time > sale_start_time) | Thời điểm kết thúc bán                 |
| max_per_order   | INT           | NOT NULL DEFAULT 6 CHECK (max_per_order > 0)     | Giới hạn vé trên mỗi đơn hàng          |
| sort_order      | INT           | NOT NULL DEFAULT 0                               | Thứ tự hiển thị                        |
| created_at      | TIMESTAMPTZ   | NOT NULL DEFAULT now()                           | Thời điểm tạo                          |
| updated_at      | TIMESTAMPTZ   | NOT NULL DEFAULT now()                           | Thời điểm cập nhật cuối                |

Ràng buộc sức chứa:

```sql
ALTER TABLE ticket_types ADD CONSTRAINT chk_ticket_capacity
CHECK (sold_count + held_count <= capacity);
```

### seats

Lưu thông tin vị trí ghế trên sơ đồ.

| Cột             | Kiểu        | Ràng buộc                                                                               | Diễn giải                             |
| :-------------- | :---------- | :-------------------------------------------------------------------------------------- | :------------------------------------ |
| id              | UUID        | PRIMARY KEY DEFAULT gen_random_uuid()                                                   | Khóa chính                            |
| event_id        | UUID        | NOT NULL REFERENCES events(id) ON DELETE CASCADE                                        | Khóa ngoại sự kiện                    |
| ticket_type_id  | UUID        | NOT NULL REFERENCES ticket_types(id)                                                    | Khóa ngoại hạng vé                    |
| zone_name       | VARCHAR(50) | NOT NULL                                                                                | Tên khu vực hoặc khán đài             |
| row_label       | VARCHAR(20) | NOT NULL                                                                                | Ký hiệu hàng ghế                      |
| seat_number     | VARCHAR(20) | NOT NULL                                                                                | Số ghế                                |
| status          | VARCHAR(20) | NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'HELD', 'SOLD', 'BLOCKED')) | Trạng thái ghế                        |
| hold_order_id   | UUID        | NULL                                                                                    | Đơn hàng đang giữ ghế                 |
| hold_expires_at | TIMESTAMPTZ | NULL                                                                                    | Thời điểm hết hạn giữ ghế             |
| version         | INT         | NOT NULL DEFAULT 1                                                                      | Phiên bản dùng cho optimistic locking |
| created_at      | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                  | Thời điểm tạo                         |
| updated_at      | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                  | Thời điểm cập nhật cuối               |

Chỉ mục và ràng buộc:

```sql
CREATE UNIQUE INDEX idx_seats_unique_position
ON seats(event_id, zone_name, row_label, seat_number);

CREATE INDEX idx_seats_event_status ON seats(event_id, status);
CREATE INDEX idx_seats_hold_expiry ON seats(status, hold_expires_at) WHERE status = 'HELD';
```

### orders

Lưu thông tin đơn hàng và thời hạn thanh toán.

| Cột             | Kiểu          | Ràng buộc                                                                                                      | Diễn giải                          |
| :-------------- | :------------ | :------------------------------------------------------------------------------------------------------------- | :--------------------------------- |
| id              | UUID          | PRIMARY KEY DEFAULT gen_random_uuid()                                                                          | Khóa chính                         |
| order_code      | VARCHAR(32)   | NOT NULL UNIQUE                                                                                                | Mã đơn hàng hiển thị               |
| user_id         | UUID          | NOT NULL REFERENCES users(id)                                                                                  | Người mua (Bắt buộc vai trò BUYER) |
| event_id        | UUID          | NOT NULL REFERENCES events(id)                                                                                 | Sự kiện                            |
| total_amount    | NUMERIC(14,2) | NOT NULL CHECK (total_amount >= 0)                                                                             | Tổng tiền gốc                      |
| discount_amount | NUMERIC(14,2) | NOT NULL DEFAULT 0 CHECK (discount_amount >= 0)                                                                | Số tiền giảm                       |
| final_amount    | NUMERIC(14,2) | NOT NULL CHECK (final_amount >= 0)                                                                             | Số tiền thực trả                   |
| status          | VARCHAR(32)   | NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'CANCELLED', 'REFUNDED')) | Trạng thái đơn                     |
| expires_at      | TIMESTAMPTZ   | NOT NULL                                                                                                       | Thời điểm hết hạn giữ chỗ          |
| paid_at         | TIMESTAMPTZ   | NULL                                                                                                           | Thời điểm hoàn tất thanh toán      |
| voucher_code    | VARCHAR(50)   | NULL                                                                                                           | Mã giảm giá                        |
| created_at      | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                                                         | Thời điểm tạo                      |
| updated_at      | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                                                         | Thời điểm cập nhật cuối            |

> **Ràng buộc nghiệp vụ toàn vẹn (Integrity Constraint)**: Cột `user_id` chỉ liên kết với bản ghi người dùng có `role = 'BUYER'`. Các tài khoản có vai trò `ADMIN`, `ORGANIZER` hoặc `GATE_STAFF` bị cấm tạo đơn hàng và sở hữu vé cá nhân nhằm ngăn ngừa xung đột lợi ích và găm vé nội bộ.

Chỉ mục:

```sql
CREATE INDEX idx_orders_user_pending
ON orders(user_id, event_id, status) WHERE status = 'PENDING';
```

### order_items

Chi tiết từng hạng vé hoặc vị trí ghế trong đơn hàng.

| Cột            | Kiểu          | Ràng buộc                                        | Diễn giải                          |
| :------------- | :------------ | :----------------------------------------------- | :--------------------------------- |
| id             | UUID          | PRIMARY KEY DEFAULT gen_random_uuid()            | Khóa chính                         |
| order_id       | UUID          | NOT NULL REFERENCES orders(id) ON DELETE CASCADE | Khóa ngoại đơn hàng                |
| ticket_type_id | UUID          | NOT NULL REFERENCES ticket_types(id)             | Khóa ngoại hạng vé                 |
| seat_id        | UUID          | NULL REFERENCES seats(id)                        | Khóa ngoại ghế (NULL nếu khu đứng) |
| quantity       | INT           | NOT NULL CHECK (quantity > 0)                    | Số lượng vé                        |
| unit_price     | NUMERIC(14,2) | NOT NULL CHECK (unit_price >= 0)                 | Đơn giá tại thời điểm đặt          |
| subtotal       | NUMERIC(14,2) | NOT NULL CHECK (subtotal >= 0)                   | Thành tiền                         |
| created_at     | TIMESTAMPTZ   | NOT NULL DEFAULT now()                           | Thời điểm tạo                      |

### tickets

Bản ghi vé điện tử được cấp sau khi thanh toán thành công.

| Cột            | Kiểu        | Ràng buộc                                                                     | Diễn giải                         |
| :------------- | :---------- | :---------------------------------------------------------------------------- | :-------------------------------- |
| id             | UUID        | PRIMARY KEY DEFAULT gen_random_uuid()                                         | Định danh vé (mã `sub` trong JWT) |
| ticket_code    | VARCHAR(32) | NOT NULL UNIQUE                                                               | Mã vé tra cứu thủ công            |
| order_id       | UUID        | NOT NULL REFERENCES orders(id)                                                | Khóa ngoại đơn hàng               |
| user_id        | UUID        | NOT NULL REFERENCES users(id)                                                 | Chủ sở hữu vé                     |
| event_id       | UUID        | NOT NULL REFERENCES events(id)                                                | Khóa ngoại sự kiện                |
| ticket_type_id | UUID        | NOT NULL REFERENCES ticket_types(id)                                          | Khóa ngoại hạng vé                |
| seat_id        | UUID        | NULL REFERENCES seats(id)                                                     | Khóa ngoại vị trí ghế             |
| status         | VARCHAR(20) | NOT NULL DEFAULT 'SOLD' CHECK (status IN ('SOLD', 'CHECKED_IN', 'CANCELLED')) | Trạng thái vé                     |
| checked_in_at  | TIMESTAMPTZ | NULL                                                                          | Thời điểm soát vé thành công      |
| gate_id        | UUID        | NULL REFERENCES gates(id)                                                     | Cổng soát vé                      |
| checked_in_by  | UUID        | NULL REFERENCES users(id)                                                     | Nhân viên thực hiện soát vé       |
| created_at     | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                        | Thời điểm tạo                     |
| updated_at     | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                        | Thời điểm cập nhật cuối           |

Chỉ mục đảm bảo mỗi ghế chỉ có một vé còn hiệu lực:

```sql
CREATE UNIQUE INDEX idx_tickets_unique_active_seat
ON tickets(event_id, seat_id)
WHERE seat_id IS NOT NULL AND status != 'CANCELLED';
```

### transactions

Lưu vết các giao dịch thanh toán qua cổng VNPay.

| Cột                | Kiểu          | Ràng buộc                                                                     | Diễn giải                                     |
| :----------------- | :------------ | :---------------------------------------------------------------------------- | :-------------------------------------------- |
| id                 | UUID          | PRIMARY KEY DEFAULT gen_random_uuid()                                         | Khóa chính                                    |
| order_id           | UUID          | NOT NULL REFERENCES orders(id)                                                | Khóa ngoại đơn hàng                           |
| provider           | VARCHAR(20)   | NOT NULL DEFAULT 'VNPAY'                                                      | Cổng thanh toán                               |
| transaction_ref    | VARCHAR(100)  | NOT NULL UNIQUE                                                               | Mã tham chiếu gửi sang cổng (`vnp_TxnRef`)    |
| provider_tx_number | VARCHAR(100)  | NULL                                                                          | Mã giao dịch phía VNPay (`vnp_TransactionNo`) |
| amount             | NUMERIC(14,2) | NOT NULL CHECK (amount > 0)                                                   | Số tiền giao dịch                             |
| response_code      | VARCHAR(10)   | NULL                                                                          | Mã kết quả trả về từ cổng                     |
| bank_code          | VARCHAR(20)   | NULL                                                                          | Ngân hàng thanh toán                          |
| vnp_create_date    | VARCHAR(14)   | NULL                                                                          | Ngày tạo URL VNPay GMT+7, dùng QueryDR/Refund |
| payment_url        | VARCHAR(4000) | NULL                                                                          | URL đã ký được lưu để tái sử dụng khi retry   |
| pay_date           | TIMESTAMPTZ   | NULL                                                                          | Thời điểm thanh toán tại cổng                 |
| status             | VARCHAR(20)   | NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')) | Trạng thái giao dịch                          |
| raw_callback       | JSONB         | NULL                                                                          | Dữ liệu IPN nguyên bản để đối soát            |
| idempotency_key    | VARCHAR(100)  | NOT NULL UNIQUE                                                               | Khóa chống xử lý trùng lặp                    |
| created_at         | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                        | Thời điểm tạo                                 |
| updated_at         | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                        | Thời điểm cập nhật cuối                       |

Chỉ mục chống trùng callback:

```sql
CREATE UNIQUE INDEX idx_transactions_provider_unique
ON transactions(provider, provider_tx_number)
WHERE provider_tx_number IS NOT NULL;
```

### refunds

Lưu các bản ghi yêu cầu hoàn tiền.

| Cột                 | Kiểu          | Ràng buộc                                                                                     | Diễn giải                                                             |
| :------------------ | :------------ | :-------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| id                  | UUID          | PRIMARY KEY DEFAULT gen_random_uuid()                                                         | Khóa chính                                                            |
| order_id            | UUID          | NOT NULL REFERENCES orders(id)                                                                | Khóa ngoại đơn hàng                                                   |
| ticket_id           | UUID          | NULL REFERENCES tickets(id)                                                                   | Vé bị hủy                                                             |
| amount              | NUMERIC(14,2) | NOT NULL CHECK (amount > 0)                                                                   | Số tiền hoàn lại                                                      |
| reason              | TEXT          | NOT NULL                                                                                      | Lý do hoàn tiền                                                       |
| status              | VARCHAR(20)   | NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')) | Trạng thái hoàn tiền                                                  |
| provider_request_id | VARCHAR(32)   | UNIQUE, NULL                                                                                  | Mã yêu cầu lưu trước khi gọi VNPay; không gửi lại khi kết quả chưa rõ |
| last_attempt_at     | TIMESTAMPTZ   | NULL                                                                                          | Thời điểm dành quyền gửi yêu cầu hoàn tiền                            |
| next_retry_at       | TIMESTAMPTZ   | NOT NULL, DEFAULT NOW()                                                                       | Thời điểm đối soát tiếp theo sau lỗi                                  |
| provider_refund_ref | VARCHAR(100)  | NULL                                                                                          | Mã phản hồi hoàn tiền từ VNPay                                        |
| idempotency_key     | VARCHAR(100)  | NOT NULL UNIQUE                                                                               | Khóa chống trùng lặp                                                  |
| retry_count         | INT           | NOT NULL DEFAULT 0                                                                            | Số lần thử lại qua worker                                             |
| error_message       | TEXT          | NULL                                                                                          | Chi tiết lỗi nếu thất bại                                             |
| processed_at        | TIMESTAMPTZ   | NULL                                                                                          | Thời điểm hoàn tất                                                    |
| created_at          | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                                        | Thời điểm tạo                                                         |
| updated_at          | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                                        | Thời điểm cập nhật cuối                                               |

### gates và event_staff

Quản lý cổng vào và phân công nhân viên soát vé.

Bảng `gates`:

- `id` (UUID PK), `event_id` (UUID FK), `name` (VARCHAR), `location_desc` (VARCHAR), `created_at` (TIMESTAMPTZ).

Bảng `event_staff`:

- `id` (UUID PK), `event_id` (UUID FK), `user_id` (UUID FK), `gate_id` (UUID FK), `staff_role` (VARCHAR), `created_at` (TIMESTAMPTZ).
- `CREATE UNIQUE INDEX idx_staff_event_user ON event_staff(event_id, user_id);`

### payouts

Ghi nhận các khoản quyết toán chi trả cho ban tổ chức sau sự kiện.

| Cột              | Kiểu          | Ràng buộc                                                                    | Diễn giải                    |
| :--------------- | :------------ | :--------------------------------------------------------------------------- | :--------------------------- |
| id               | UUID          | PRIMARY KEY DEFAULT gen_random_uuid()                                        | Khóa chính                   |
| organizer_id     | UUID          | NOT NULL REFERENCES organizer_profiles(id)                                   | Khóa ngoại ban tổ chức       |
| event_id         | UUID          | NOT NULL REFERENCES events(id)                                               | Khóa ngoại sự kiện           |
| total_revenue    | NUMERIC(14,2) | NOT NULL                                                                     | Tổng doanh thu vé            |
| platform_fee     | NUMERIC(14,2) | NOT NULL                                                                     | Phí nền tảng khấu trừ        |
| gateway_fee      | NUMERIC(14,2) | NOT NULL                                                                     | Phí cổng thanh toán khấu trừ |
| refund_deduction | NUMERIC(14,2) | NOT NULL                                                                     | Số tiền hoàn vé khấu trừ     |
| net_payout       | NUMERIC(14,2) | NOT NULL                                                                     | Số tiền thực chi trả         |
| status           | VARCHAR(20)   | NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'HOLD', 'PAID_OUT')) | Trạng thái chi trả           |
| hold_reason      | TEXT          | NULL                                                                         | Lý do tạm giữ chi trả        |
| paid_out_at      | TIMESTAMPTZ   | NULL                                                                         | Thời điểm chuyển khoản       |
| approved_by      | UUID          | NULL REFERENCES users(id)                                                    | Quản trị viên duyệt          |
| created_at       | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                       | Thời điểm tạo                |
| updated_at       | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                       | Thời điểm cập nhật cuối      |

### audit_log

Nhật ký kiểm toán ghi nhận thao tác của người dùng và quản trị viên. Bảng chỉ cho phép thao tác ghi mới (`INSERT`).

```sql
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID NULL,
    actor_role VARCHAR(20) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(100) NOT NULL,
    changes JSONB NULL,
    ip_address INET NULL,
    user_agent VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
```

### outbox

Lưu trữ các sự kiện cần gửi thông báo hoặc xử lý nền (Transactional Outbox).

```sql
CREATE TABLE outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_fetch ON outbox(status, next_retry_at) WHERE status IN ('PENDING', 'PROCESSING');
```

### idempotency_keys

Kiểm soát và ngăn ngừa xử lý trùng lặp các yêu cầu gửi lại.

```sql
CREATE TABLE idempotency_keys (
    key VARCHAR(100) PRIMARY KEY,
    user_id UUID NOT NULL,
    path VARCHAR(255) NOT NULL,
    response_status INT NULL,
    response_body JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_idempotency_expiry ON idempotency_keys(expires_at);
```

## Các truy vấn xử lý tranh chấp đồng thời

### Giữ chỗ ghế và Tự động phân bổ liền kề (Auto Contiguous Allocation)

Khi người dùng gửi yêu cầu giữ chỗ cho hạng vé có chỗ ngồi (`is_seated = true`) mà không truyền `seat_id`, backend truy vấn các ghế khả dụng, tự động tìm chuỗi ghế liền kề trong cùng hàng ghế, và thực thi khóa giao dịch:

```sql
BEGIN;

-- 1. Tìm các ứng viên ghế trống (AVAILABLE hoặc HELD quá hạn 5 phút) thuộc hạng vé
SELECT id, row_label, seat_number, status, hold_expires_at
FROM seats
WHERE event_id = $1 AND ticket_type_id = $2
  AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at < now()))
ORDER BY row_label ASC, seat_number ASC;
-- (Thuật toán findContiguousSeats gom nhóm theo row_label và chọn quantity ghế liền kề)

-- 2. Khóa các ghế được chọn theo thứ tự ID tăng dần để ngăn ngừa deadlock
SELECT id, status, hold_expires_at
FROM seats
WHERE id = ANY($3::uuid[]) AND event_id = $1
ORDER BY id ASC
FOR UPDATE;

-- 3. Cập nhật trạng thái ghế còn trống hoặc đã quá hạn giữ chỗ
UPDATE seats
SET status = 'HELD',
    hold_order_id = $4,
    hold_expires_at = now() + interval '5 minutes',
    version = version + 1,
    updated_at = now()
WHERE id = ANY($3::uuid[])
  AND event_id = $1
  AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at < now()))
RETURNING id;

-- 4. Kiểm tra số dòng được cập nhật:
-- Nếu số dòng trả về < số ghế yêu cầu: hủy transaction (ROLLBACK) và kích hoạt vòng lặp thử lại (tối đa 10 lần) để chọn bộ ghế liền kề khác. Nếu vượt quá số lần thử hoặc không đủ sức chứa: báo lỗi SEAT_ALREADY_HELD hoặc INSUFFICIENT_TICKET_CAPACITY.
-- Nếu số dòng trả về = số ghế yêu cầu: tạo đơn hàng PENDING và hoàn tất transaction (COMMIT).
```

### Giữ chỗ khu đứng không đánh số

```sql
UPDATE ticket_types
SET held_count = held_count + $2,
    updated_at = now()
WHERE id = $1
  AND sold_count + held_count + $2 <= capacity
RETURNING id;
```

Nếu lệnh trả về 0 dòng, yêu cầu giữ chỗ bị từ chối do không đủ số lượng còn lại.

### Soát vé nguyên tử tại cổng

```sql
UPDATE tickets
SET status = 'CHECKED_IN',
    checked_in_at = now(),
    gate_id = $2,
    checked_in_by = $3,
    updated_at = now()
WHERE id = $1
  AND status = 'SOLD'
RETURNING id, ticket_code, seat_id;
```

Chỉ khi câu lệnh trả về đúng 1 dòng, vé mới được xác nhận hợp lệ. Nếu trả về 0 dòng, hệ thống cảnh báo vé đã được sử dụng hoặc đã bị hủy.

## Bảng tổng hợp báo cáo

Bảng tổng hợp được làm mới định kỳ qua worker để không ảnh hưởng đến hiệu năng bảng giao dịch:

```sql
CREATE MATERIALIZED VIEW mv_event_sales_summary AS
WITH revenue AS (
 SELECT event_id, sum(total_amount) AS gross_revenue, sum(final_amount) AS paid_revenue
 FROM orders WHERE status IN ('PAID','REFUNDED') OR paid_at IS NOT NULL GROUP BY event_id
), refunded AS (
 SELECT o.event_id, sum(r.amount) AS total_refunded_amount
 FROM refunds r JOIN orders o ON o.id=r.order_id WHERE r.status='COMPLETED' GROUP BY o.event_id
), ticket_counts AS (
 SELECT event_id,
 count(*) FILTER(WHERE status IN ('SOLD','CHECKED_IN')) AS total_sold_tickets,
 count(*) FILTER(WHERE status='CHECKED_IN') AS total_checked_in_tickets,
 count(*) FILTER(WHERE status='CANCELLED') AS total_cancelled_tickets
 FROM tickets GROUP BY event_id
)
SELECT e.id AS event_id,e.organizer_id,e.title,
 COALESCE(t.total_sold_tickets,0) AS total_sold_tickets,
 COALESCE(t.total_checked_in_tickets,0) AS total_checked_in_tickets,
 COALESCE(t.total_cancelled_tickets,0) AS total_cancelled_tickets,
 COALESCE(r.gross_revenue,0)::numeric AS gross_revenue,
 COALESCE(r.paid_revenue,0)::numeric AS paid_revenue,
 COALESCE(f.total_refunded_amount,0)::numeric AS total_refunded_amount,
 (COALESCE(r.paid_revenue,0)-COALESCE(f.total_refunded_amount,0))::numeric AS net_revenue,
 CASE WHEN COALESCE(t.total_sold_tickets,0)=0 THEN 0 ELSE round(t.total_checked_in_tickets::numeric*100/t.total_sold_tickets,2) END AS checkin_percentage,
 now() AS refreshed_at
FROM events e LEFT JOIN revenue r ON r.event_id=e.id LEFT JOIN refunded f ON f.event_id=e.id LEFT JOIN ticket_counts t ON t.event_id=e.id;

CREATE UNIQUE INDEX idx_mv_event_sales_id ON mv_event_sales_summary(event_id);
```

## Bổ sung schema tuần 5

### organizer_staff

Sở hữu tài khoản nhân viên theo BTC, không cho BTC nhận quản lý tài khoản tùy ý chỉ bằng email/userId.

| Cột          | Kiểu        | Ràng buộc                       | Ý nghĩa                  |
| ------------ | ----------- | ------------------------------- | ------------------------ |
| user_id      | UUID        | PK, FK users                    | Nhân viên do BTC quản lý |
| organizer_id | UUID        | NOT NULL, FK organizer_profiles | BTC sở hữu               |
| created_at   | TIMESTAMPTZ | NOT NULL                        | Thời điểm tạo            |

### gate_checkin_logs

Nhật ký append-only cho cả QR và thủ công. ID lịch sử không có FK cascade, cùng nguyên tắc với audit_log, để không sửa hoặc mất log khi tài nguyên thay đổi.

| Cột           | Kiểu         | Ràng buộc | Ý nghĩa                                  |
| ------------- | ------------ | --------- | ---------------------------------------- |
| id            | UUID         | PK        | Mã log                                   |
| event_id      | UUID         | NULL      | Sự kiện, null nếu QR không xác định được |
| ticket_id     | UUID         | NULL      | Vé đã xác định                           |
| gate_id       | UUID         | NULL      | Cổng đã xác định                         |
| staff_id      | UUID         | NOT NULL  | Nhân viên thực hiện                      |
| method        | VARCHAR(20)  | NOT NULL  | QR hoặc MANUAL                           |
| outcome       | VARCHAR(20)  | NOT NULL  | SUCCESS hoặc REJECTED                    |
| reason        | TEXT         | NULL      | Lý do tra cứu thủ công                   |
| error_code    | VARCHAR(100) | NULL      | Mã từ chối                               |
| checked_in_at | TIMESTAMPTZ  | NOT NULL  | Thời điểm thao tác                       |

### report_exports

Hàng đợi xuất báo cáo bền vững trong PostgreSQL; dữ liệu file nằm ngoài thư mục public.

| Cột           | Kiểu         | Ràng buộc                       | Ý nghĩa                            |
| ------------- | ------------ | ------------------------------- | ---------------------------------- |
| id            | UUID         | PK                              | Mã job                             |
| requested_by  | UUID         | NOT NULL, FK users              | Người yêu cầu                      |
| organizer_id  | UUID         | NOT NULL, FK organizer_profiles | BTC sở hữu                         |
| event_id      | UUID         | NOT NULL, FK events             | Sự kiện                            |
| format        | VARCHAR(10)  | NOT NULL                        | csv/xlsx                           |
| status        | VARCHAR(20)  | NOT NULL                        | Trạng thái job                     |
| attempt_id    | UUID         | NULL                            | Fencing token mỗi lần claim        |
| file_name     | VARCHAR(100) | NULL                            | Tên file nội bộ do worker tạo      |
| retry_count   | INTEGER      | NOT NULL                        | Số lần lỗi                         |
| error_message | TEXT         | NULL                            | Thông báo lỗi công khai đã rút gọn |
| next_retry_at | TIMESTAMPTZ  | NOT NULL                        | Thời điểm thử lại                  |
| expires_at    | TIMESTAMPTZ  | NULL                            | Hạn tải file                       |
| created_at    | TIMESTAMPTZ  | NOT NULL                        | Ngày tạo                           |
| updated_at    | TIMESTAMPTZ  | NOT NULL                        | Ngày cập nhật/lease                |

Migration 0006_w05-staff-reporting.sql tạo MV thực tế: mv_event_sales_summary và mv_event_ticket_sales. Migration tổng hợp riêng orders, refunds, tickets trước khi join, tránh nhân doanh thu khi đơn có nhiều vé hoặc nhiều refund. Worker refresh hai MV bằng CONCURRENTLY dưới advisory lock để tránh nhiều worker refresh trùng. MV không được ánh xạ thành pgTable vì chỉ đọc qua SQL tĩnh.

### Mở rộng report_exports và MV báo cáo (0004, 0005)

| Cột            | Kiểu        | Ràng buộc | Ý nghĩa                                                    |
| -------------- | ----------- | --------- | ---------------------------------------------------------- |
| from_date      | DATE        | NULL      | Ngày đầu kỳ theo giờ Việt Nam                              |
| to_date        | DATE        | NULL      | Ngày cuối kỳ, bao gồm trọn ngày                            |
| ticket_type_id | UUID        | NULL      | Bộ lọc hạng vé snapshot, không FK để không mất lịch sử job |
| voucher_code   | VARCHAR(50) | NULL      | Bộ lọc mã giảm giá chuẩn hóa chữ hoa                       |

CHECK report_exports_period_check yêu cầu hai ngày cùng null hoặc cùng có giá trị và from_date <= to_date.
Migration 0004 tạo mv_event_report_daily, tổng hợp độc lập tiền thu/ngày thanh toán, hoàn/ngày hoàn tất và vé/nhóm ngày thanh toán.
Migration 0005 tạo mv_event_report_facts theo đơn/hạng vé/ngày/loại dòng tiền, kèm thông tin người mua và voucher.
Phân bổ giữ tổng tiền chính xác đến cent; hoàn theo vé không nhân tiền theo số vé của đơn.
Worker refresh cả bốn MV trong cùng transaction repeatable read/advisory lock; unique index hỗ trợ CONCURRENTLY.
MV chỉ đọc qua SQL, không ánh xạ thành pgTable. Hoàn tất file ghi outbox REPORT_EXPORT_COMPLETED trong cùng transaction;
không thêm PII vào payload outbox, chỉ exportId.

Bản PR W05 kế thừa W04 dùng journal 0000-0004 upstream, 0005 W04 và 0006 W05. Tổng 21 bảng public, gồm đủ venues/venue_layouts và ba bảng W05; MV không tính như BASE TABLE.
