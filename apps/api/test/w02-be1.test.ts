import type { ExecutionContext } from "@nestjs/common";
import type { HttpErrorLike } from "./helpers/http-error";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import { AuthService } from "../src/auth/auth.service";
import { EventsService } from "../src/events/events.service";
import { RolesGuard } from "../src/auth/guards/roles.guard";
import { Reflector } from "@nestjs/core";
import { db, sqlClient } from "../src/database/db";
import { users, outbox } from "../src/database/schema";
import {
  UserRole,
  UserStatus,
  EventStatus,
  RefundPolicyType,
} from "@tickethub/shared";
import { env } from "../src/config/env.config";

describe("W02-BE1: Auth (UC01) & Event Management (UC07) Verification", () => {
  let authService: AuthService;
  let eventsService: EventsService;
  let jwtService: JwtService;
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  const testUserEmail = `test_w02_${Date.now()}@tickethub.vn`;
  let createdUserId = "";
  let verificationToken = "";
  let validRefreshToken = "";

  before(() => {
    jwtService = new JwtService({
      secret: env.JWT_SECRET,
      signOptions: { expiresIn: 900 },
    });
    authService = new AuthService(jwtService);
    eventsService = new EventsService();
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);
  });

  after(async () => {
    // Dọn dẹp dữ liệu kiểm thử
    if (createdUserId) {
      await db.delete(users).where(eq(users.id, createdUserId));
    }
    await sqlClient.end();
  });

  describe("1. Mật khẩu Argon2id", () => {
    it("Phải băm mật khẩu theo chuẩn Argon2id", async () => {
      const hash = await authService.hashPassword("SecretPassword123!");
      assert.ok(
        hash.startsWith("$argon2id$"),
        "Chuỗi băm phải có định dạng argon2id",
      );

      const isMatch = await authService.verifyPassword(
        hash,
        "SecretPassword123!",
      );
      assert.equal(isMatch, true, "Mật khẩu đúng phải khớp");

      const isWrong = await authService.verifyPassword(hash, "WrongPassword");
      assert.equal(isWrong, false, "Mật khẩu sai không được khớp");
    });
  });

  describe("2. Đăng ký & Kích hoạt Email qua Outbox (UC01)", () => {
    it("Phải đăng ký thành công và tạo bản ghi Transactional Outbox", async () => {
      const result = await authService.register({
        email: testUserEmail,
        password: "Password123!",
        fullName: "Người Dùng Kiểm Thử",
        phone: "0901234567",
        role: UserRole.BUYER,
      });

      assert.ok(result.userId, "Phải có userId");
      assert.equal(result.email, testUserEmail);
      assert.equal(result.status, UserStatus.PENDING_EMAIL);
      assert.ok(result.verificationToken, "Phải sinh token xác thực");

      createdUserId = result.userId;
      verificationToken = result.verificationToken;

      // Kiểm tra bản ghi outbox được tạo
      const outboxEvent = await db.query.outbox.findFirst({
        where: eq(outbox.eventType, "USER_REGISTERED"),
        orderBy: (outbox, { desc }) => [desc(outbox.createdAt)],
      });

      assert.ok(outboxEvent, "Phải tìm thấy sự kiện outbox");
      assert.equal(
        (outboxEvent.payload as { email?: string }).email,
        testUserEmail,
      );
    });

    it("Phải từ chối đăng ký trùng email với lỗi EMAIL_ALREADY_EXISTS", async () => {
      await assert.rejects(
        async () => {
          await authService.register({
            email: testUserEmail,
            password: "Password123!",
            fullName: "Người Dùng Trùng",
            role: UserRole.BUYER,
          });
        },
        (err: HttpErrorLike) => {
          assert.equal(err.response?.error?.code, "EMAIL_ALREADY_EXISTS");
          return true;
        },
      );
    });

    it("Chưa xác thực email thì không được phép đăng nhập (EMAIL_NOT_VERIFIED)", async () => {
      await assert.rejects(
        async () => {
          await authService.login({
            email: testUserEmail,
            password: "Password123!",
          });
        },
        (err: HttpErrorLike) => {
          assert.equal(err.response?.error?.code, "EMAIL_NOT_VERIFIED");
          return true;
        },
      );
    });

    it("Xác thực email thành công và chuyển trạng thái ACTIVE", async () => {
      const res = await authService.verifyEmail(verificationToken);
      assert.equal(res.status, UserStatus.ACTIVE);

      const user = await db.query.users.findFirst({
        where: eq(users.id, createdUserId),
      });
      assert.equal(user?.status, UserStatus.ACTIVE);
      assert.ok(user?.emailVerifiedAt !== null);
    });
  });

  describe("3. Đăng nhập, Khóa tài khoản & Xoay vòng Refresh Token (UC01)", () => {
    it("Phải khóa tài khoản 15 phút sau 5 lần nhập sai mật khẩu", async () => {
      for (let i = 1; i <= 4; i++) {
        await assert.rejects(
          async () => {
            await authService.login({
              email: testUserEmail,
              password: "WrongPassword",
            });
          },
          (err: HttpErrorLike) => {
            assert.equal(err.response?.error?.code, "INVALID_CREDENTIALS");
            return true;
          },
        );
      }

      // Lần thứ 5 sai -> Phải bị khóa tài khoản
      await assert.rejects(
        async () => {
          await authService.login({
            email: testUserEmail,
            password: "WrongPassword",
          });
        },
        (err: HttpErrorLike) => {
          assert.equal(err.response?.error?.code, "ACCOUNT_LOCKED");
          return true;
        },
      );

      // Lần thứ 6 (dù đúng mật khẩu) vẫn bị từ chối vì đang trong thời gian khóa
      await assert.rejects(
        async () => {
          await authService.login({
            email: testUserEmail,
            password: "Password123!",
          });
        },
        (err: HttpErrorLike) => {
          assert.equal(err.response?.error?.code, "ACCOUNT_LOCKED");
          return true;
        },
      );

      // Mở khóa thủ công để kiểm tra luồng đăng nhập thành công
      await db
        .update(users)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(users.id, createdUserId));
    });

    it("Đăng nhập thành công và cấp Access Token + Refresh Token", async () => {
      const res = await authService.login({
        email: testUserEmail,
        password: "Password123!",
      });

      assert.ok(res.accessToken, "Phải có accessToken");
      assert.ok(res.refreshToken, "Phải có refreshToken");
      assert.equal(res.expiresIn, 900);
      assert.equal(res.user.email, testUserEmail);

      validRefreshToken = res.refreshToken;
    });

    it("Xoay vòng Refresh Token (Token Rotation) thành công", async () => {
      const res = await authService.refreshToken(validRefreshToken);

      assert.ok(res.accessToken, "Phải cấp accessToken mới");
      assert.ok(res.refreshToken, "Phải cấp refreshToken mới");
      assert.notEqual(
        res.refreshToken,
        validRefreshToken,
        "RefreshToken mới phải khác token cũ",
      );
    });
  });

  describe("4. RBAC Guards & Quyền truy cập", () => {
    it("Chặn người dùng vai trò BUYER truy cập tài nguyên ORGANIZER", () => {
      const mockContext = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: createdUserId, role: UserRole.BUYER },
          }),
        }),
      } as unknown as ExecutionContext;

      reflector.getAllAndOverride = () => [UserRole.ORGANIZER, UserRole.ADMIN];

      assert.throws(
        () => {
          rolesGuard.canActivate(mockContext);
        },
        (err: HttpErrorLike) => {
          assert.equal(err.response?.error?.code, "FORBIDDEN_RESOURCE");
          return true;
        },
      );
    });

    it("Cho phép người dùng vai trò ORGANIZER truy cập tài nguyên ORGANIZER", () => {
      const mockContext = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: createdUserId, role: UserRole.ORGANIZER },
          }),
        }),
      } as unknown as ExecutionContext;

      reflector.getAllAndOverride = () => [UserRole.ORGANIZER, UserRole.ADMIN];

      const allowed = rolesGuard.canActivate(mockContext);
      assert.equal(allowed, true);
    });

    it("Chặn người dùng vai trò ORGANIZER và ADMIN mua vé (tài nguyên BUYER)", () => {
      reflector.getAllAndOverride = () => [UserRole.BUYER];

      const orgContext = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: createdUserId, role: UserRole.ORGANIZER },
          }),
        }),
      } as unknown as ExecutionContext;

      assert.throws(
        () => {
          rolesGuard.canActivate(orgContext);
        },
        (err: HttpErrorLike) => {
          assert.equal(err.response?.error?.code, "FORBIDDEN_RESOURCE");
          return true;
        },
      );

      const adminContext = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: createdUserId, role: UserRole.ADMIN },
          }),
        }),
      } as unknown as ExecutionContext;

      assert.throws(
        () => {
          rolesGuard.canActivate(adminContext);
        },
        (err: HttpErrorLike) => {
          assert.equal(err.response?.error?.code, "FORBIDDEN_RESOURCE");
          return true;
        },
      );
    });

    it("Cho phép người dùng vai trò BUYER mua vé (tài nguyên BUYER)", () => {
      reflector.getAllAndOverride = () => [UserRole.BUYER];

      const buyerContext = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: createdUserId, role: UserRole.BUYER },
          }),
        }),
      } as unknown as ExecutionContext;

      const allowed = rolesGuard.canActivate(buyerContext);
      assert.equal(allowed, true);
    });
  });

  describe("5. Quản lý Sự kiện & Sinh Sơ đồ Ghế (UC07)", () => {
    let organizerUserId = "";
    let createdEventId = "";
    let vipTicketTypeId = "";

    before(async () => {
      const orgUser = await db.query.users.findFirst({
        where: eq(users.email, "organizer@tickethub.vn"),
      });
      assert.ok(orgUser, "Tài khoản organizer mẫu phải tồn tại");
      organizerUserId = orgUser.id;
    });

    it("Tạo sự kiện DRAFT kèm hạng vé thành công", async () => {
      const slug = `w02-show-${Date.now()}`;
      const now = new Date();
      const startTime = new Date(
        now.getTime() + 10 * 24 * 3600 * 1000,
      ).toISOString();
      const endTime = new Date(
        now.getTime() + 10 * 24 * 3600 * 1000 + 4 * 3600 * 1000,
      ).toISOString();
      const gateTime = new Date(
        now.getTime() + 10 * 24 * 3600 * 1000 - 2 * 3600 * 1000,
      ).toISOString();

      const event = await eventsService.createEvent(organizerUserId, {
        title: "Hòa Nhạc Giai Điệu Trẻ",
        slug,
        description: "Chương trình hòa nhạc đặc biệt thử nghiệm UC07.",
        category: "Âm nhạc",
        bannerUrl: "https://cdn.tickethub.vn/banners/young-melody.webp",
        venueName: "Nhà hát Hòa Bình",
        venueAddress: "240 đường 3/2, Quận 10",
        city: "TP. Hồ Chí Minh",
        startTime,
        endTime,
        gateOpeningTime: gateTime,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
        refundPolicyRules: [],
        ticketTypes: [
          {
            name: "Khu VIP 1",
            price: 1500000,
            capacity: 10,
            isSeated: true,
            saleStartTime: now.toISOString(),
            saleEndTime: startTime,
            maxPerOrder: 6,
            sortOrder: 1,
          },
          {
            name: "Khu GA Đứng",
            price: 500000,
            capacity: 50,
            isSeated: false,
            saleStartTime: now.toISOString(),
            saleEndTime: startTime,
            maxPerOrder: 6,
            sortOrder: 2,
          },
        ],
      });

      assert.ok(event.id);
      assert.equal(event.status, EventStatus.DRAFT);
      assert.equal(event.version, 1);
      assert.equal(event.ticketTypes.length, 2);

      createdEventId = event.id;
      vipTicketTypeId = event.ticketTypes.find((t) => t.isSeated)!.id;
    });

    it("Sinh sơ đồ ghế tự động cho hạng vé có số ghế", async () => {
      const res = await eventsService.generateSeats(
        organizerUserId,
        createdEventId,
        {
          zones: [
            {
              zoneName: "Khu VIP 1",
              ticketTypeId: vipTicketTypeId,
              rows: ["A", "B"],
              seatsPerRow: 5,
            },
          ],
        },
      );

      assert.equal(
        res.totalSeatsGenerated,
        10,
        "Phải sinh đúng 10 ghế (2 hàng x 5 ghế)",
      );

      const detail = await eventsService.getOrganizerEventById(
        organizerUserId,
        createdEventId,
      );
      assert.equal(detail.totalSeats, 10);
    });

    it("Kiểm tra Optimistic Locking: version không khớp bị từ chối CONCURRENT_MODIFICATION", async () => {
      await assert.rejects(
        async () => {
          await eventsService.updateEvent(organizerUserId, createdEventId, {
            title: "Tiêu đề sửa đổi",
            version: 999, // Sai version
          });
        },
        (err: HttpErrorLike) => {
          assert.equal(err.response?.error?.code, "CONCURRENT_MODIFICATION");
          return true;
        },
      );
    });

    it("Cập nhật sự kiện với đúng version thành công và tăng version", async () => {
      const detailBefore = await eventsService.getOrganizerEventById(
        organizerUserId,
        createdEventId,
      );
      const currentVersion = detailBefore.version;

      const updated = await eventsService.updateEvent(
        organizerUserId,
        createdEventId,
        {
          title: "Hòa Nhạc Giai Điệu Trẻ - Đã Cập Nhật",
          version: currentVersion,
        },
      );

      assert.equal(updated.title, "Hòa Nhạc Giai Điệu Trẻ - Đã Cập Nhật");
      assert.equal(updated.version, currentVersion + 1);
    });

    it("Gửi phê duyệt sự kiện (submit): chuyển trạng thái DRAFT -> PENDING_APPROVAL", async () => {
      const submitRes = await eventsService.submitEventForApproval(
        organizerUserId,
        createdEventId,
      );
      assert.equal(submitRes.status, EventStatus.PENDING_APPROVAL);

      // Sau khi PENDING_APPROVAL, không được chỉnh sửa tiếp
      await assert.rejects(
        async () => {
          await eventsService.updateEvent(organizerUserId, createdEventId, {
            title: "Cố tình sửa khi đang chờ duyệt",
            version: submitRes.version!,
          });
        },
        (err: HttpErrorLike) => {
          assert.equal(err.response?.error?.code, "EVENT_CANNOT_BE_EDITED");
          return true;
        },
      );
    });
  });
});
