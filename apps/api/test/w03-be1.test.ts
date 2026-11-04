import type { HttpErrorLike } from "./helpers/http-error";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JwtService } from "@nestjs/jwt";
import Redis from "ioredis";
import { eq, and, inArray } from "drizzle-orm";
import { WaitingRoomService } from "../src/waiting-room/waiting-room.service";
import { BookingService } from "../src/booking/booking.service";
import { db, sqlClient } from "../src/database/db";
import type { EventReadCacheService } from "../src/events/event-read-cache.service";
import {
  users,
  events,
  ticketTypes,
  seats,
  orders,
  orderItems,
  organizerProfiles,
} from "../src/database/schema";
import {
  UserRole,
  UserStatus,
  EventStatus,
  RefundPolicyType,
  SeatStatus,
  OrderStatus,
} from "@tickethub/shared";
import { env } from "../src/config/env.config";

const cacheStub = {
  invalidate: async (_eventId: string): Promise<void> => {},
} as EventReadCacheService;

describe("W03-BE1: Waiting Room (UC03) & Atomic Seat Hold (UC04) Verification", () => {
  let redis: Redis;
  let jwtService: JwtService;
  let waitingRoomService: WaitingRoomService;
  let bookingService: BookingService;

  let testBuyer1Id = "";
  let testBuyer2Id = "";
  let testBuyer3Id = "";
  let testBuyer4Id = "";

  let waitingRoomEventId = "";
  let regularEventId = "";
  let seatedTicketTypeId = "";
  let standingTicketTypeId = "";
  let testSeat1Id = "";
  let testSeat2Id = "";
  let testSeat3Id = "";

  // Đơn giữ 2 ghế (seat 1 + seat 2) của Người mua 1, dùng lại ở nhóm test 3
  let buyer1SeatOrderId = "";

  before(async () => {
    redis = new Redis(env.REDIS_URL);
    jwtService = new JwtService({ secret: env.JWT_SECRET });
    waitingRoomService = new WaitingRoomService(redis, jwtService);
    bookingService = new BookingService(waitingRoomService, cacheStub);

    // 1. Lấy hoặc tạo organizer profile
    let orgProfile = await db.query.organizerProfiles.findFirst();
    if (!orgProfile) {
      const [u] = await db
        .insert(users)
        .values({
          email: `org_w03_${Date.now()}@tickethub.vn`,
          fullName: "Ban Tổ Chức W03",
          passwordHash: "$argon2id$v=19$dummyhash",
          role: UserRole.ORGANIZER,
          status: UserStatus.ACTIVE,
        })
        .returning();
      const [profile] = await db
        .insert(organizerProfiles)
        .values({
          userId: u!.id,
          organizationName: "Công ty Cổ phần W03 Test",
          taxCode: "0109999999",
          businessLicenseUrl: "https://cdn.tickethub.vn/license.pdf",
          representativeName: "Giám Đốc W03",
        })
        .returning();
      orgProfile = profile;
    }

    // 2. Tạo 4 người mua để kiểm thử
    const stamp = Date.now();
    const createdUsers = await db
      .insert(users)
      .values(
        [1, 2, 3, 4].map((n) => ({
          email: `b${n}_w03_${stamp}@tickethub.vn`,
          fullName: `Người Mua ${n}`,
          passwordHash: "$argon2id$dummy",
          role: UserRole.BUYER,
          status: UserStatus.ACTIVE,
        })),
      )
      .returning();

    testBuyer1Id = createdUsers[0]!.id;
    testBuyer2Id = createdUsers[1]!.id;
    testBuyer3Id = createdUsers[2]!.id;
    testBuyer4Id = createdUsers[3]!.id;

    // 3. Tạo sự kiện CÓ hàng chờ ảo (maxActiveUsers = 2)
    const now = new Date();
    const startTime = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const endTime = new Date(startTime.getTime() + 4 * 3600 * 1000);

    const [wrEvent] = await db
      .insert(events)
      .values({
        organizerId: orgProfile!.id,
        title: "Sự Kiện Hot Bật Hàng Chờ Ảo",
        slug: `wr-event-${Date.now()}`,
        description: "Sự kiện kiểm thử hàng chờ ảo UC03",
        category: "Âm nhạc",
        bannerUrl: "https://cdn.tickethub.vn/banner.webp",
        venueName: "Sân vận động Mỹ Đình",
        venueAddress: "Đường Lê Đức Thọ, Nam Từ Liêm",
        city: "Hà Nội",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED,
        isWaitingRoomEnabled: true,
        maxActiveUsers: 2, // Ngưỡng tối đa 2 người đồng thời
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    waitingRoomEventId = wrEvent!.id;
    await db.insert(ticketTypes).values({
      eventId: waitingRoomEventId,
      name: "GA hang cho",
      price: "100000",
      capacity: 100,
      isSeated: false,
      saleStartTime: now,
      saleEndTime: startTime,
    });

    // 4. Tạo sự kiện thông thường KHÔNG hàng chờ ảo để kiểm thử giữ chỗ
    const [regEvent] = await db
      .insert(events)
      .values({
        organizerId: orgProfile!.id,
        title: "Sự Kiện Thường Bán Vé Trực Tiếp",
        slug: `reg-event-${Date.now()}`,
        description: "Sự kiện kiểm thử giữ chỗ nguyên tử UC04",
        category: "Âm nhạc",
        bannerUrl: "https://cdn.tickethub.vn/banner.webp",
        venueName: "Nhà hát Thành phố",
        venueAddress: "07 Công Trường Lam Sơn, Quận 1",
        city: "TP. Hồ Chí Minh",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED,
        isWaitingRoomEnabled: false,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    regularEventId = regEvent!.id;

    // 5. Tạo hạng vé có ghế và vé đứng
    const [ttSeated] = await db
      .insert(ticketTypes)
      .values({
        eventId: regularEventId,
        name: "Khu Ghế Ngồi VIP",
        price: "1000000.00",
        capacity: 10,
        isSeated: true,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    seatedTicketTypeId = ttSeated!.id;

    const [ttStanding] = await db
      .insert(ticketTypes)
      .values({
        eventId: regularEventId,
        name: "Khu Đứng GA",
        price: "500000.00",
        capacity: 5, // Sức chứa 5 vé
        isSeated: false,
        heldCount: 0,
        soldCount: 0,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    standingTicketTypeId = ttStanding!.id;

    // 6. Tạo 3 ghế mẫu
    const createdSeats = await db
      .insert(seats)
      .values(
        ["01", "02", "03"].map((seatNumber) => ({
          eventId: regularEventId,
          ticketTypeId: seatedTicketTypeId,
          zoneName: "Khu VIP",
          rowLabel: "A",
          seatNumber,
          status: SeatStatus.AVAILABLE,
        })),
      )
      .returning();

    testSeat1Id = createdSeats[0]!.id;
    testSeat2Id = createdSeats[1]!.id;
    testSeat3Id = createdSeats[2]!.id;
  });

  after(async () => {
    // Dọn dẹp Redis của sự kiện kiểm thử
    if (waitingRoomEventId) {
      const heartbeatKeys = [
        testBuyer1Id,
        testBuyer2Id,
        testBuyer3Id,
        testBuyer4Id,
      ]
        .filter(Boolean)
        .map((userId) => `w03:waiting-room:hb:${waitingRoomEventId}:${userId}`);

      await redis.del(
        `active_users:${waitingRoomEventId}`,
        `waiting_room:${waitingRoomEventId}`,
        ...heartbeatKeys,
      );

      await redis.srem("w03:waiting-room:events", waitingRoomEventId);
    }

    redis.disconnect();

    // Dọn dẹp dữ liệu DB
    const eventIds = [regularEventId, waitingRoomEventId].filter(Boolean);
    if (eventIds.length > 0) {
      // 1. Tháo liên kết hold_order_id trên seats để không vi phạm FK
      await db
        .update(seats)
        .set({ holdOrderId: null })
        .where(inArray(seats.eventId, eventIds));

      const orderRows = await db
        .select({ id: orders.id })
        .from(orders)
        .where(inArray(orders.eventId, eventIds));

      if (orderRows.length > 0) {
        const orderIds = orderRows.map((o) => o.id);
        await db
          .delete(orderItems)
          .where(inArray(orderItems.orderId, orderIds));
        await db.delete(orders).where(inArray(orders.id, orderIds));
      }

      await db.delete(seats).where(inArray(seats.eventId, eventIds));
      await db
        .delete(ticketTypes)
        .where(inArray(ticketTypes.eventId, eventIds));
      await db.delete(events).where(inArray(events.id, eventIds));
    }

    const buyerIds = [
      testBuyer1Id,
      testBuyer2Id,
      testBuyer3Id,
      testBuyer4Id,
    ].filter(Boolean);
    if (buyerIds.length > 0) {
      await db.delete(users).where(inArray(users.id, buyerIds));
    }

    await sqlClient.end();
  });

  describe("1. Hàng chờ ảo Waiting Room (UC03)", () => {
    let buyer1AdmissionToken = "";
    let buyer2AdmissionToken = "";

    it("Người dùng 1 và 2 gia nhập khi chưa đủ MAX_ACTIVE (2) -> Nhận ADMITTED và admissionToken", async () => {
      const res1 = await waitingRoomService.joinQueue(
        testBuyer1Id,
        waitingRoomEventId,
      );
      assert.equal(res1.status, "ADMITTED");
      assert.ok(res1.admissionToken, "Phải sinh admissionToken");
      buyer1AdmissionToken = res1.admissionToken!;

      const res2 = await waitingRoomService.joinQueue(
        testBuyer2Id,
        waitingRoomEventId,
      );
      assert.equal(res2.status, "ADMITTED");
      assert.ok(res2.admissionToken);
      buyer2AdmissionToken = res2.admissionToken!;
    });

    it("Người dùng 3 gia nhập khi đã đạt MAX_ACTIVE (2) -> Đưa vào hàng chờ QUEUED tại vị trí 1", async () => {
      const res3 = await waitingRoomService.joinQueue(
        testBuyer3Id,
        waitingRoomEventId,
      );
      assert.equal(res3.status, "QUEUED");
      assert.equal(res3.queuePosition, 1);
      assert.ok((res3.estimatedWaitSeconds ?? 0) > 0);
    });

    it("Người dùng 4 gia nhập -> QUEUED tại vị trí 2", async () => {
      const res4 = await waitingRoomService.joinQueue(
        testBuyer4Id,
        waitingRoomEventId,
      );
      assert.equal(res4.status, "QUEUED");
      assert.equal(res4.queuePosition, 2);
    });

    it("Người dùng 1 rời đi -> Người dùng 3 gửi heartbeat được cấp quyền ADMITTED", async () => {
      await waitingRoomService.leaveActive(testBuyer1Id, waitingRoomEventId);

      const heartbeatRes = await waitingRoomService.heartbeat(
        testBuyer3Id,
        waitingRoomEventId,
      );
      assert.equal(heartbeatRes.status, "ADMITTED");
      assert.ok(heartbeatRes.admissionToken);

      // Người dùng 4 gửi heartbeat sẽ lên vị trí 1
      const res4 = await waitingRoomService.heartbeat(
        testBuyer4Id,
        waitingRoomEventId,
      );
      assert.equal(res4.status, "QUEUED");
      assert.equal(res4.queuePosition, 1);
    });

    it("Kiểm tra Admission Token và phiên Redis", async () => {
      // Buyer 2 vẫn ACTIVE, token phải hợp lệ
      const isValid = await waitingRoomService.verifyAdmissionToken(
        buyer2AdmissionToken,
        waitingRoomEventId,
        testBuyer2Id,
      );
      assert.equal(isValid, true);

      // Token Buyer 2 không thể dùng cho Buyer 1
      const isInvalidUser = await waitingRoomService.verifyAdmissionToken(
        buyer2AdmissionToken,
        waitingRoomEventId,
        testBuyer1Id,
      );
      assert.equal(isInvalidUser, false);

      // Buyer 1 đã leaveActive ở bài test trước,
      // token cũ của Buyer 1 phải bị thu hồi hiệu lực
      const isRevoked = await waitingRoomService.verifyAdmissionToken(
        buyer1AdmissionToken,
        waitingRoomEventId,
        testBuyer1Id,
      );
      assert.equal(isRevoked, false);
    });
  });

  describe("2. Giữ chỗ ghế nguyên tử & Bắt buộc Admission Token (UC04)", () => {
    it("Sự kiện bật hàng chờ ảo mà thiếu X-Admission-Token -> Bị từ chối MISSING_ADMISSION_TOKEN", async () => {
      await assert.rejects(
        async () => {
          await bookingService.holdSeats(testBuyer1Id, {
            eventId: waitingRoomEventId,
            items: [
              {
                ticketTypeId: seatedTicketTypeId,
                seatId: testSeat1Id,
                quantity: 1,
              },
            ],
          });
        },
        (err: HttpErrorLike) => {
          assert.equal(err.response?.error?.code, "MISSING_ADMISSION_TOKEN");
          return true;
        },
      );
    });

    it("Giữ chỗ thành công 2 ghế ngồi trên sự kiện thường -> Trạng thái đơn PENDING 5 phút", async () => {
      const result = await bookingService.holdSeats(testBuyer1Id, {
        eventId: regularEventId,
        items: [
          {
            ticketTypeId: seatedTicketTypeId,
            seatId: testSeat1Id,
            quantity: 1,
          },
          {
            ticketTypeId: seatedTicketTypeId,
            seatId: testSeat2Id,
            quantity: 1,
          },
        ],
      });

      assert.ok(result.orderId);
      assert.equal(result.heldSeats.length, 2);
      assert.equal(result.totalAmount, 2000000);
      assert.equal(result.remainingSeconds, 300);

      // Lưu lại để nhóm test 3 giải phóng đúng đơn này
      buyer1SeatOrderId = result.orderId;

      // Kiểm tra trạng thái ghế trong database đã chuyển sang HELD
      const seatRow = await db.query.seats.findFirst({
        where: eq(seats.id, testSeat1Id),
      });
      assert.equal(seatRow?.status, SeatStatus.HELD);
      assert.equal(seatRow?.holdOrderId, result.orderId);
    });

    it("Kiểm soát tranh chấp đồng thời: 2 người giữ cùng 1 ghế -> Đúng 1 người thành công, 1 người nhận SEAT_ALREADY_HELD", async () => {
      // testSeat3Id chưa ai giữ (seat 1, 2 đã thuộc đơn của Người mua 1)
      const seatBefore = await db.query.seats.findFirst({
        where: eq(seats.id, testSeat3Id),
      });

      assert.ok(seatBefore, "Ghế test phải tồn tại");
      assert.equal(seatBefore.eventId, regularEventId);
      assert.equal(seatBefore.ticketTypeId, seatedTicketTypeId);
      assert.equal(
        seatBefore.status,
        SeatStatus.AVAILABLE,
        "Ghế phải AVAILABLE trước khi tranh chấp",
      );

      // Hai người cùng giữ ĐÚNG ghế seat 3 (đã sửa: trước đây dùng nhầm seat 1)
      const [res1, res2] = await Promise.allSettled([
        bookingService.holdSeats(testBuyer2Id, {
          eventId: regularEventId,
          items: [
            {
              ticketTypeId: seatedTicketTypeId,
              seatId: testSeat3Id,
              quantity: 1,
            },
          ],
        }),
        bookingService.holdSeats(testBuyer3Id, {
          eventId: regularEventId,
          items: [
            {
              ticketTypeId: seatedTicketTypeId,
              seatId: testSeat3Id,
              quantity: 1,
            },
          ],
        }),
      ]);

      const results = [res1, res2];

      const fulfilled = results.filter(
        (r): r is Extract<typeof r, { status: "fulfilled" }> =>
          r.status === "fulfilled",
      );
      const rejected = results.filter(
        (r): r is Extract<typeof r, { status: "rejected" }> =>
          r.status === "rejected",
      );
      assert.equal(fulfilled.length, 1, "Đúng 1 yêu cầu phải thành công");
      assert.equal(rejected.length, 1, "Đúng 1 yêu cầu phải bị xung đột");
      assert.equal(
        rejected[0]!.reason?.response?.error?.code,
        "SEAT_ALREADY_HELD",
      );

      // Ghế phải thuộc về đúng đơn của người thắng
      const seatAfter = await db.query.seats.findFirst({
        where: eq(seats.id, testSeat3Id),
      });
      assert.equal(seatAfter?.status, SeatStatus.HELD);
      assert.equal(seatAfter?.holdOrderId, fulfilled[0]!.value.orderId);
    });

    it("Giữ chỗ khu đứng cập nhật held_count; vượt sức chứa bị từ chối INSUFFICIENT_TICKET_CAPACITY", async () => {
      // Sức chứa GA là 5 vé
      const holdRes = await bookingService.holdSeats(testBuyer1Id, {
        eventId: regularEventId,
        items: [{ ticketTypeId: standingTicketTypeId, quantity: 3 }],
      });
      assert.ok(holdRes.orderId);

      const ttRow = await db.query.ticketTypes.findFirst({
        where: eq(ticketTypes.id, standingTicketTypeId),
      });
      assert.equal(ttRow?.heldCount, 3);

      // Yêu cầu thêm 3 vé nữa (tổng 3 + 3 = 6 > capacity 5) -> Phải từ chối
      await assert.rejects(
        async () => {
          await bookingService.holdSeats(testBuyer2Id, {
            eventId: regularEventId,
            items: [{ ticketTypeId: standingTicketTypeId, quantity: 3 }],
          });
        },
        (err: HttpErrorLike) => {
          assert.equal(
            err.response?.error?.code,
            "INSUFFICIENT_TICKET_CAPACITY",
          );
          return true;
        },
      );
    });
  });

  describe("3. Giải phóng ghế chủ động & Tác vụ dọn đơn hết hạn", () => {
    it("Giải phóng ghế chủ động (releaseHold) -> Ghế trở lại AVAILABLE, đơn CANCELLED", async () => {
      // Dùng đúng đơn 2 ghế đã lưu (Người mua 1 còn một đơn khu đứng PENDING nữa,
      // nên không được dùng findFirst vì có thể lấy nhầm)
      assert.ok(buyer1SeatOrderId, "Phải có đơn 2 ghế từ test trước");

      const order = await db.query.orders.findFirst({
        where: and(
          eq(orders.id, buyer1SeatOrderId),
          eq(orders.userId, testBuyer1Id),
          eq(orders.status, OrderStatus.PENDING),
        ),
      });
      assert.ok(order, "Đơn 2 ghế phải còn PENDING");

      const releaseRes = await bookingService.releaseHold(
        testBuyer1Id,
        buyer1SeatOrderId,
      );
      assert.ok(releaseRes.message);

      // Kiểm tra trạng thái đơn hàng
      const updatedOrder = await db.query.orders.findFirst({
        where: eq(orders.id, buyer1SeatOrderId),
      });
      assert.equal(updatedOrder?.status, OrderStatus.CANCELLED);

      // Kiểm tra cả 2 ghế được trả về AVAILABLE
      for (const seatId of [testSeat1Id, testSeat2Id]) {
        const seat = await db.query.seats.findFirst({
          where: eq(seats.id, seatId),
        });
        assert.equal(seat?.status, SeatStatus.AVAILABLE);
        assert.equal(seat?.holdOrderId, null);
      }
    });

    it("Tác vụ quét định kỳ (cleanExpiredOrders) tự động hủy đơn quá hạn và trả ghế về AVAILABLE", async () => {
      // 1. Tạo đơn giữ testSeat1Id
      const holdRes = await bookingService.holdSeats(testBuyer4Id, {
        eventId: regularEventId,
        items: [
          {
            ticketTypeId: seatedTicketTypeId,
            seatId: testSeat1Id,
            quantity: 1,
          },
        ],
      });

      // 2. Ép đơn hàng và ghế về quá khứ (hết hạn giữ chỗ)
      const pastTime = new Date(Date.now() - 1000);
      await db
        .update(orders)
        .set({ expiresAt: pastTime })
        .where(eq(orders.id, holdRes.orderId));
      await db
        .update(seats)
        .set({ holdExpiresAt: pastTime })
        .where(eq(seats.id, testSeat1Id));

      // 3. Thực thi tác vụ dọn dẹp
      const cleanupResult = await bookingService.cleanExpiredOrders();
      assert.ok(
        cleanupResult.expiredOrdersCount >= 1,
        "Phải dọn ít nhất 1 đơn hết hạn",
      );

      // 4. Kiểm tra đơn hàng chuyển sang EXPIRED
      const expiredOrder = await db.query.orders.findFirst({
        where: eq(orders.id, holdRes.orderId),
      });
      assert.equal(expiredOrder?.status, OrderStatus.EXPIRED);

      // 5. Kiểm tra ghế đã tự động quay về AVAILABLE
      const reclaimedSeat = await db.query.seats.findFirst({
        where: eq(seats.id, testSeat1Id),
      });
      assert.equal(reclaimedSeat?.status, SeatStatus.AVAILABLE);
      assert.equal(reclaimedSeat?.holdOrderId, null);
    });
  });
});
