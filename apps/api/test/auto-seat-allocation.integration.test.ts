import type { HttpErrorLike } from "./helpers/http-error";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
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
} from "@tickethub/shared";

const cacheStub = {
  invalidate: async (_eventId: string): Promise<void> => {},
} as EventReadCacheService;

describe("Auto Seat Allocation (UC04) Integration Tests", () => {
  let bookingService: BookingService;

  let testBuyerIds: string[] = [];
  let testEventId = "";
  let seatedTicketTypeId = "";
  let smallTicketTypeId = "";
  let concurrencyTicketTypeId = "";

  before(async () => {
    bookingService = new BookingService(cacheStub);

    // 1. Tao organizer profile
    let orgProfile = await db.query.organizerProfiles.findFirst();
    if (!orgProfile) {
      const [u] = await db
        .insert(users)
        .values({
          email: `org_auto_seat_${Date.now()}@tickethub.vn`,
          fullName: "Ban To Chuc Auto Seat",
          passwordHash: "$argon2id$v=19$dummyhash",
          role: UserRole.ORGANIZER,
          status: UserStatus.ACTIVE,
        })
        .returning();

      const [profile] = await db
        .insert(organizerProfiles)
        .values({
          userId: u!.id,
          organizationName: "Cong ty Co phan Auto Seat Test",
          taxCode: "0108888888",
          businessLicenseUrl: "https://cdn.tickethub.vn/license.pdf",
          representativeName: "Giam Doc Auto Seat",
        })
        .returning();
      orgProfile = profile;
    }

    // 2. Tao 10 nguoi mua dung cho concurrency test
    const stamp = Date.now();
    const createdUsers = await db
      .insert(users)
      .values(
        Array.from({ length: 10 }).map((_, idx) => ({
          email: `buyer_auto_${idx}_${stamp}@tickethub.vn`,
          fullName: `Nguoi Mua Auto ${idx + 1}`,
          passwordHash: "$argon2id$dummy",
          role: UserRole.BUYER,
          status: UserStatus.ACTIVE,
        })),
      )
      .returning();

    testBuyerIds = createdUsers.map((u) => u.id);

    // 3. Tao su kien thu nghiem
    const now = new Date();
    const startTime = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const endTime = new Date(startTime.getTime() + 4 * 3600 * 1000);

    const [testEvt] = await db
      .insert(events)
      .values({
        organizerId: orgProfile!.id,
        title: "Su Kien Thu Nghiem Auto Seat Allocation",
        slug: `auto-seat-evt-${Date.now()}`,
        description: "Kiem tra tinh nang tu dong phan bo ghe lien ke",
        category: "Am nhac",
        bannerUrl: "https://cdn.tickethub.vn/banner.webp",
        venueName: "San van dong Test",
        venueAddress: "123 Duong Test, Quan 1",
        city: "TP. Ho Chi Minh",
        startTime,
        endTime,
        gateOpeningTime: startTime,
        status: EventStatus.PUBLISHED,
        refundPolicyType: RefundPolicyType.FLEXIBLE,
      })
      .returning();
    testEventId = testEvt!.id;

    // 4. Tao hang ve VIP thuong (co 2 hang A va B)
    const [tt1] = await db
      .insert(ticketTypes)
      .values({
        eventId: testEventId,
        name: "Hang Ve VIP A",
        price: "1200000.00",
        capacity: 20,
        isSeated: true,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    seatedTicketTypeId = tt1!.id;

    // Tao cac ghe cho VIP A:
    // Hang A: A01, A02, A03, A04 (AVAILABLE)
    // Hang B: B01 (HELD), B02 (AVAILABLE), B03 (HELD) -> phan manh
    // Hang C: C01, C02, C03, C04 (AVAILABLE) -> lien ke
    const seatsToInsert: Array<typeof seats.$inferInsert> = [
      ...["01", "02", "03", "04"].map((seatNum) => ({
        eventId: testEventId,
        ticketTypeId: seatedTicketTypeId,
        zoneName: "Khu VIP A",
        rowLabel: "A",
        seatNumber: seatNum,
        status: SeatStatus.AVAILABLE,
      })),
      {
        eventId: testEventId,
        ticketTypeId: seatedTicketTypeId,
        zoneName: "Khu VIP A",
        rowLabel: "B",
        seatNumber: "01",
        status: SeatStatus.HELD,
        holdExpiresAt: new Date(now.getTime() + 300000),
      },
      {
        eventId: testEventId,
        ticketTypeId: seatedTicketTypeId,
        zoneName: "Khu VIP A",
        rowLabel: "B",
        seatNumber: "02",
        status: SeatStatus.AVAILABLE,
      },
      {
        eventId: testEventId,
        ticketTypeId: seatedTicketTypeId,
        zoneName: "Khu VIP A",
        rowLabel: "B",
        seatNumber: "03",
        status: SeatStatus.HELD,
        holdExpiresAt: new Date(now.getTime() + 300000),
      },
      ...["01", "02", "03", "04"].map((seatNum) => ({
        eventId: testEventId,
        ticketTypeId: seatedTicketTypeId,
        zoneName: "Khu VIP A",
        rowLabel: "C",
        seatNumber: seatNum,
        status: SeatStatus.AVAILABLE,
      })),
    ];
    await db.insert(seats).values(seatsToInsert);

    // 5. Tao hang ve chi co 1 ghe de test thieu ghe (small capacity)
    const [ttSmall] = await db
      .insert(ticketTypes)
      .values({
        eventId: testEventId,
        name: "Hang Ve Gioi Han 1 Ghe",
        price: "2000000.00",
        capacity: 1,
        isSeated: true,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    smallTicketTypeId = ttSmall!.id;

    await db.insert(seats).values([
      {
        eventId: testEventId,
        ticketTypeId: smallTicketTypeId,
        zoneName: "Khu Gioi Han",
        rowLabel: "S",
        seatNumber: "01",
        status: SeatStatus.AVAILABLE,
      },
    ]);

    // 6. Tao hang ve danh cho Concurrency Test (10 ghe lien tiep)
    const [ttConc] = await db
      .insert(ticketTypes)
      .values({
        eventId: testEventId,
        name: "Hang Ve Concurrency 10 Ghe",
        price: "800000.00",
        capacity: 10,
        isSeated: true,
        saleStartTime: now,
        saleEndTime: startTime,
      })
      .returning();
    concurrencyTicketTypeId = ttConc!.id;

    await db.insert(seats).values(
      Array.from({ length: 10 }).map((_, idx) => ({
        eventId: testEventId,
        ticketTypeId: concurrencyTicketTypeId,
        zoneName: "Khu Concurrency",
        rowLabel: "D",
        seatNumber: idx + 1 < 10 ? `0${idx + 1}` : `${idx + 1}`,
        status: SeatStatus.AVAILABLE,
      })),
    );
  });

  after(async () => {

    // Don dep database
    if (testEventId) {
      await db
        .update(seats)
        .set({ holdOrderId: null })
        .where(eq(seats.eventId, testEventId));

      const orderRows = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.eventId, testEventId));

      if (orderRows.length > 0) {
        const orderIds = orderRows.map((o) => o.id);
        await db
          .delete(orderItems)
          .where(inArray(orderItems.orderId, orderIds));
        await db.delete(orders).where(inArray(orders.id, orderIds));
      }

      await db.delete(seats).where(eq(seats.eventId, testEventId));
      await db.delete(ticketTypes).where(eq(ticketTypes.eventId, testEventId));
      await db.delete(events).where(eq(events.id, testEventId));
    }

    if (testBuyerIds.length > 0) {
      await db.delete(users).where(inArray(users.id, testBuyerIds));
    }

    await sqlClient.end();
  });

  it("1. Auto-allocation 2 ghe lien ke trong cung hang A (A01, A02)", async () => {
    const buyerId = testBuyerIds[0]!;
    const res = await bookingService.holdSeats(buyerId, {
      eventId: testEventId,
      items: [
        {
          ticketTypeId: seatedTicketTypeId,
          quantity: 2,
        },
      ],
    });

    assert.ok(res.orderId, "Phai tao orderId");
    assert.equal(res.heldSeats.length, 2, "Phai giu dung 2 ghe");
    assert.equal(
      res.allocatedSeats.length,
      2,
      "Phai tra ve thong tin 2 ghe da phan bo",
    );

    // Kiem tra 2 ghe phan bo la cung hang va lien tiep
    const [s1, s2] = res.allocatedSeats;
    assert.equal(s1!.rowLabel, "A");
    assert.equal(s2!.rowLabel, "A");
    assert.equal(s1!.seatNumber, "01");
    assert.equal(s2!.seatNumber, "02");

    // Kiem tra DB status da thanh HELD
    const dbSeats = await db.query.seats.findMany({
      where: inArray(seats.id, res.heldSeats),
    });
    for (const s of dbSeats) {
      assert.equal(s.status, SeatStatus.HELD);
      assert.equal(s.holdOrderId, res.orderId);
    }
  });

  it("2. Tu dong nhay sang hang C co ghe lien ke khi hang B bi phan manh", async () => {
    // Hang A hien con A03, A04 (2 ghe). Chung ta chiem them A03, A04 bang buyer 1:
    await bookingService.holdSeats(testBuyerIds[1]!, {
      eventId: testEventId,
      items: [
        {
          ticketTypeId: seatedTicketTypeId,
          quantity: 2,
        },
      ],
    });

    // Gio Hang A da het ghe. Hang B chi co B02 Available (khong du 2 ghe lien ke).
    // Hang C co C01, C02, C03, C04 lien ke.
    // Buyer 2 dat 2 ve -> He thong phai tu dong bo qua hang B va phan bo C01, C02!
    const res = await bookingService.holdSeats(testBuyerIds[2]!, {
      eventId: testEventId,
      items: [
        {
          ticketTypeId: seatedTicketTypeId,
          quantity: 2,
        },
      ],
    });

    assert.equal(res.allocatedSeats.length, 2);
    const [s1, s2] = res.allocatedSeats;
    assert.equal(s1!.rowLabel, "C");
    assert.equal(s2!.rowLabel, "C");
    assert.equal(s1!.seatNumber, "01");
    assert.equal(s2!.seatNumber, "02");
  });

  it("3. Tu choi INSUFFICIENT_TICKET_CAPACITY khi khong du so ghe trong", async () => {
    // smallTicketTypeId chi co 1 ghe duy nhat
    await assert.rejects(
      async () => {
        await bookingService.holdSeats(testBuyerIds[3]!, {
          eventId: testEventId,
          items: [
            {
              ticketTypeId: smallTicketTypeId,
              quantity: 2, // Yeu cau 2 ve trong khi chi con 1
            },
          ],
        });
      },
      (err: HttpErrorLike) => {
        assert.equal(err.response?.error?.code, "INSUFFICIENT_TICKET_CAPACITY");
        return true;
      },
    );
  });

  it("4. Kiem tra tranh chap dong thoi (Concurrency): 5 nguoi dung giu 2 ve tren 10 ghe -> 0 trung lap", async () => {
    // 5 nguoi mua: testBuyerIds[4] den testBuyerIds[8]
    const buyers = testBuyerIds.slice(4, 9);
    assert.equal(buyers.length, 5);

    const promises = buyers.map((buyerId) =>
      bookingService.holdSeats(buyerId, {
        eventId: testEventId,
        items: [
          {
            ticketTypeId: concurrencyTicketTypeId,
            quantity: 2,
          },
        ],
      }),
    );

    const results = await Promise.all(promises);

    const allAssignedSeatIds: string[] = [];
    for (const r of results) {
      assert.ok(r.orderId);
      assert.equal(r.allocatedSeats.length, 2);
      for (const seat of r.allocatedSeats) {
        allAssignedSeatIds.push(seat.id);
      }
    }

    // Tong cong 5 don * 2 ghe = 10 ghe
    assert.equal(allAssignedSeatIds.length, 10);
    // Tat ca 10 ghe phai hoan toan duy nhat (khong trung lap)
    const uniqueIds = new Set(allAssignedSeatIds);
    assert.equal(
      uniqueIds.size,
      10,
      "Tat ca 10 ghe duoc phan bo phai khong trung lap",
    );

    // Kiem tra trong DB: tat ca 10 ghe deu o trang thai HELD
    const dbSeats = await db.query.seats.findMany({
      where: eq(seats.ticketTypeId, concurrencyTicketTypeId),
    });
    assert.equal(dbSeats.length, 10);
    for (const s of dbSeats) {
      assert.equal(s.status, SeatStatus.HELD);
      assert.ok(s.holdOrderId);
    }
  });

  it("5. Thu hoi ghe tu dong phan bo khi don hang het han 5 phut", async () => {
    // Buyer 9 giu ghe cuoi cung con lai trong smallTicketTypeId (1 ghe)
    const holdRes = await bookingService.holdSeats(testBuyerIds[9]!, {
      eventId: testEventId,
      items: [
        {
          ticketTypeId: smallTicketTypeId,
          quantity: 1,
        },
      ],
    });

    assert.equal(holdRes.allocatedSeats.length, 1);
    const allocatedSeatId = holdRes.allocatedSeats[0]!.id;

    // Ep het han giu cho
    const past = new Date(Date.now() - 1000);
    await db
      .update(orders)
      .set({ expiresAt: past })
      .where(eq(orders.id, holdRes.orderId));
    await db
      .update(seats)
      .set({ holdExpiresAt: past })
      .where(eq(seats.id, allocatedSeatId));

    // Chay don dep
    const cleanup = await bookingService.cleanExpiredOrders();
    assert.ok(cleanup.expiredOrdersCount >= 1);

    // Kiem tra ghe da tro lai AVAILABLE va holdOrderId bi go bo
    const seatRow = await db.query.seats.findFirst({
      where: eq(seats.id, allocatedSeatId),
    });
    assert.equal(seatRow?.status, SeatStatus.AVAILABLE);
    assert.equal(seatRow?.holdOrderId, null);
  });
});
