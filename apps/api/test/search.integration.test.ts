import type { HttpErrorLike } from "./helpers/http-error";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { inArray, eq } from "drizzle-orm";

import { EventStatus } from "@tickethub/shared";
import { db } from "../src/database/db";
import {
  events,
  ticketTypes,
  organizerProfiles,
  users,
} from "../src/database/schema";
import { SearchService } from "../src/search/search.service";
import { SearchController } from "../src/search/search.controller";

describe("W03-BE2: Event Full-Text Search (UC02) Integration Test Suite", () => {
  let searchService: SearchService;
  let searchController: SearchController;

  let organizerId = "";
  const createdEventIds: string[] = [];

  let event1Id = "";
  let event2Id = "";
  let event3Id = "";

  before(async () => {
    searchService = new SearchService();
    searchController = new SearchController(searchService);

    // 1. Tim hoac tao organizer profile mau
    let orgProfile = await db.query.organizerProfiles.findFirst();
    if (!orgProfile) {
      let user = await db.query.users.findFirst({
        where: eq(users.email, "organizer_search_test@tickethub.vn"),
      });
      if (!user) {
        const [u] = await db
          .insert(users)
          .values({
            email: "organizer_search_test@tickethub.vn",
            fullName: "Ban To Chuc Search Test",
            passwordHash: "test-hash",
            role: "ORGANIZER",
            status: "VERIFIED",
          })
          .returning();
        user = u;
      }

      const [p] = await db
        .insert(organizerProfiles)
        .values({
          userId: user!.id,
          organizationName: "Cong ty To Chuc Su Kien Search Test",
          taxId: "0109999888",
          businessRegistrationUrl: "https://example.com/license.pdf",
          status: "VERIFIED",
        })
        .returning();
      orgProfile = p;
    }
    organizerId = orgProfile.id;

    // 2. Tao 3 su kien Published mau
    const stamp = Date.now();

    // Event 1: Dem Nhac Trinh Cong Son Ha Noi
    const [ev1] = await db
      .insert(events)
      .values({
        organizerId,
        title: "Đêm Nhạc Trịnh Công Sơn Hà Nội",
        slug: `dem-nhac-trinh-${stamp}`,
        description:
          "Đêm nhạc tưởng nhớ nhạc sĩ Trịnh Công Sơn với các tuyệt phẩm bất hủ tại Nhà hát Lớn",
        city: "Hà Nội",
        category: "CONCERT",
        bannerUrl: "https://cdn.tickethub.vn/banner1.webp",
        venueName: "Nhà hát Lớn Hà Nội",
        venueAddress: "1 Tràng Tiền, Hoàn Kiếm, Hà Nội",
        status: EventStatus.PUBLISHED,
        startTime: new Date("2026-11-10T19:00:00.000Z"),
        endTime: new Date("2026-11-10T22:00:00.000Z"),
        gateOpeningTime: new Date("2026-11-10T18:00:00.000Z"),
      })
      .returning();
    event1Id = ev1.id;
    createdEventIds.push(event1Id);

    const saleStart = new Date("2026-10-01T00:00:00.000Z");
    const saleEnd = new Date("2026-11-09T00:00:00.000Z");

    await db.insert(ticketTypes).values([
      {
        eventId: event1Id,
        name: "Standard",
        price: "300000.00",
        capacity: 100,
        sortOrder: 1,
        isSeated: false,
        saleStartTime: saleStart,
        saleEndTime: saleEnd,
      },
      {
        eventId: event1Id,
        name: "VIP",
        price: "1000000.00",
        capacity: 50,
        sortOrder: 2,
        isSeated: false,
        saleStartTime: saleStart,
        saleEndTime: saleEnd,
      },
    ]);

    // Event 2: Hoi Thao Cong Nghe Tri Tue Nhan Tao AI
    const [ev2] = await db
      .insert(events)
      .values({
        organizerId,
        title: "Hội Thảo Công Nghệ Trí Tuệ Nhân Tạo AI",
        slug: `hoi-thao-ai-${stamp}`,
        description:
          "Diễn đàn kết nối doanh nghiệp và chuyên gia công nghệ tại Đà Nẵng",
        city: "Đà Nẵng",
        category: "CONFERENCE",
        bannerUrl: "https://cdn.tickethub.vn/banner2.webp",
        venueName: "Trung tâm Hội nghị Quốc tế",
        venueAddress: "Đường 2/9, Hải Châu, Đà Nẵng",
        status: EventStatus.PUBLISHED,
        startTime: new Date("2026-11-15T08:00:00.000Z"),
        endTime: new Date("2026-11-15T17:00:00.000Z"),
        gateOpeningTime: new Date("2026-11-15T07:30:00.000Z"),
      })
      .returning();
    event2Id = ev2.id;
    createdEventIds.push(event2Id);

    await db.insert(ticketTypes).values([
      {
        eventId: event2Id,
        name: "Free Admission",
        price: "0.00",
        capacity: 200,
        sortOrder: 1,
        isSeated: false,
        saleStartTime: saleStart,
        saleEndTime: saleEnd,
      },
      {
        eventId: event2Id,
        name: "Workshop VIP",
        price: "200000.00",
        capacity: 50,
        sortOrder: 2,
        isSeated: false,
        saleStartTime: saleStart,
        saleEndTime: saleEnd,
      },
    ]);

    // Event 3: Giai Chay Marathon Mua Thu
    const [ev3] = await db
      .insert(events)
      .values({
        organizerId,
        title: "Giải Chạy Marathon Mùa Thu Sài Gòn",
        slug: `marathon-mua-thu-${stamp}`,
        description: "Giải chạy phong trào quy mô lớn quanh khu đô thị mới",
        city: "TP Hồ Chí Minh",
        category: "SPORTS",
        bannerUrl: "https://cdn.tickethub.vn/banner3.webp",
        venueName: "Khu đô thị Sala",
        venueAddress: "Mai Chí Thọ, TP Thủ Đức, TP Hồ Chí Minh",
        status: EventStatus.PUBLISHED,
        startTime: new Date("2026-11-20T05:00:00.000Z"),
        endTime: new Date("2026-11-20T11:00:00.000Z"),
        gateOpeningTime: new Date("2026-11-20T04:30:00.000Z"),
      })
      .returning();
    event3Id = ev3.id;
    createdEventIds.push(event3Id);

    await db.insert(ticketTypes).values([
      {
        eventId: event3Id,
        name: "10KM",
        price: "500000.00",
        capacity: 300,
        sortOrder: 1,
        isSeated: false,
        saleStartTime: saleStart,
        saleEndTime: saleEnd,
      },
      {
        eventId: event3Id,
        name: "21KM",
        price: "750000.00",
        capacity: 150,
        sortOrder: 2,
        isSeated: false,
        saleStartTime: saleStart,
        saleEndTime: saleEnd,
      },
    ]);
  });

  after(async () => {
    if (createdEventIds.length > 0) {
      await db
        .delete(ticketTypes)
        .where(inArray(ticketTypes.eventId, createdEventIds));
      await db.delete(events).where(inArray(events.id, createdEventIds));
    }
  });

  describe("1. Tim kiem Full-Text tieng Viet unaccent (co dau va khong dau)", () => {
    it("Tim 'trinh cong son' khong dau -> tim thay su kien Dem Nhac", async () => {
      const res = await searchService.searchEvents({
        keyword: "trinh cong son",
        limit: 10,
      });

      const found = res.items.find((item) => item.id === event1Id);
      assert.ok(found, "Phai tim thay su kien Dem Nhac Trinh Cong Son");
      assert.equal(found.title, "Đêm Nhạc Trịnh Công Sơn Hà Nội");
    });

    it("Tim 'Trịnh Công Sơn' co dau -> tim thay su kien Dem Nhac", async () => {
      const res = await searchService.searchEvents({
        keyword: "Trịnh Công Sơn",
        limit: 10,
      });

      const found = res.items.find((item) => item.id === event1Id);
      assert.ok(found, "Phai tim thay su kien khi tim tu khoa co dau");
    });

    it("Tim tu trong mo ta 'tuyet pham bat hu' -> tim thay su kien tuong ung", async () => {
      const res = await searchService.searchEvents({
        keyword: "tuyet pham bat hu",
        limit: 10,
      });

      const found = res.items.find((item) => item.id === event1Id);
      assert.ok(found, "Phai tim thay su kien khi tim tu khoa nam trong mo ta");
    });

    it("Tim 'tri tue nhan tao' khong dau -> tim thay su kien Hoi Thao AI", async () => {
      const res = await searchService.searchEvents({
        keyword: "tri tue nhan tao",
        limit: 10,
      });

      const found = res.items.find((item) => item.id === event2Id);
      assert.ok(found, "Phai tim thay su kien Hoi thao AI");
    });

    it("Tim 'marathon' -> tim thay su kien Giai Chay", async () => {
      const res = await searchService.searchEvents({
        keyword: "marathon",
        limit: 10,
      });

      const found = res.items.find((item) => item.id === event3Id);
      assert.ok(found, "Phai tim thay su kien Giai chay marathon");
    });
  });

  describe("2. Loc da tieu chi (City, Category, Price, Date)", () => {
    it("Loc theo thanh pho co dau va khong dau: 'Hà Nội' / 'ha noi'", async () => {
      const res1 = await searchService.searchEvents({
        city: "Hà Nội",
        limit: 10,
      });
      assert.ok(res1.items.some((item) => item.id === event1Id));

      const res2 = await searchService.searchEvents({
        city: "ha noi",
        limit: 10,
      });
      assert.ok(res2.items.some((item) => item.id === event1Id));
      assert.ok(!res2.items.some((item) => item.id === event2Id));
    });

    it("Loc theo the loai category: 'CONCERT'", async () => {
      const res = await searchService.searchEvents({
        category: "CONCERT",
        limit: 10,
      });
      assert.ok(res.items.some((item) => item.id === event1Id));
      assert.ok(!res.items.some((item) => item.id === event2Id));
    });

    it("Loc theo khoang gia minPrice: 600000 -> chi tra ve su kien co ve >= 600.000", async () => {
      const res = await searchService.searchEvents({
        minPrice: 600000,
        limit: 10,
      });

      // Event 1 co ve VIP 1M, Event 3 co ve 21KM 750k -> thoa man
      assert.ok(res.items.some((item) => item.id === event1Id));
      assert.ok(res.items.some((item) => item.id === event3Id));
      // Event 2 ve cao nhat chi 200k -> khong duoc xuat hien
      assert.ok(!res.items.some((item) => item.id === event2Id));
    });

    it("Loc theo khoang gia maxPrice: 250000 -> chi tra ve su kien co ve <= 250.000", async () => {
      const res = await searchService.searchEvents({
        maxPrice: 250000,
        limit: 10,
      });

      // Event 2 co ve Free (0) va Workshop (200k) -> thoa man
      assert.ok(res.items.some((item) => item.id === event2Id));
      // Event 3 ve thap nhat la 500k -> khong duoc xuat hien
      assert.ok(!res.items.some((item) => item.id === event3Id));
    });

    it("Loc theo khoang thoi gian fromDate va toDate", async () => {
      const res = await searchService.searchEvents({
        fromDate: "2026-11-14T00:00:00.000Z",
        toDate: "2026-11-16T23:59:59.000Z",
        limit: 10,
      });

      // Chi Event 2 (ngay 15/11) nam trong khoang nay
      assert.ok(res.items.some((item) => item.id === event2Id));
      assert.ok(!res.items.some((item) => item.id === event1Id));
      assert.ok(!res.items.some((item) => item.id === event3Id));
    });
  });

  describe("3. Phan trang bang con tro (Cursor Pagination)", () => {
    it("Phan trang dung thu tu va nextCursor chinh xac", async () => {
      const page1 = await searchService.searchEvents({
        limit: 2,
      });

      assert.equal(page1.items.length, 2);
      assert.equal(page1.hasMore, true);
      assert.ok(page1.nextCursor);

      const page2 = await searchService.searchEvents({
        cursor: page1.nextCursor!,
        limit: 2,
      });

      assert.ok(page2.items.length >= 1);
      // Cac item trang 2 khong duoc trung voi trang 1
      const page1Ids = new Set(page1.items.map((i) => i.id));
      for (const item of page2.items) {
        assert.ok(
          !page1Ids.has(item.id),
          "Bản ghi trang 2 không được trùng lặp với trang 1",
        );
      }
    });

    it("Tu choi cursor khong ton tai", async () => {
      await assert.rejects(
        searchService.searchEvents({
          cursor: "00000000-0000-0000-0000-000000000000",
          limit: 10,
        }),
        /Cursor khong hop le/,
      );
    });
  });

  describe("4. Validate query & SearchController validation", () => {
    it("Controller tu choi minPrice > maxPrice voi loi VALIDATION_ERROR", async () => {
      await assert.rejects(
        searchController.searchEvents({
          minPrice: "500000",
          maxPrice: "200000",
        }),
        (err: HttpErrorLike) => {
          assert.equal(err.status, 400);
          assert.equal(err.response.error.code, "VALIDATION_ERROR");
          return true;
        },
      );
    });

    it("Controller tu choi fromDate > toDate voi loi VALIDATION_ERROR", async () => {
      await assert.rejects(
        searchController.searchEvents({
          fromDate: "2026-11-20T00:00:00.000Z",
          toDate: "2026-11-10T00:00:00.000Z",
        }),
        (err: HttpErrorLike) => {
          assert.equal(err.status, 400);
          assert.equal(err.response.error.code, "VALIDATION_ERROR");
          return true;
        },
      );
    });

    it("Controller xu ly thanh cong voi tham so hop le", async () => {
      const res = await searchController.searchEvents({
        keyword: "marathon",
        limit: "5",
      });

      assert.equal(res.success, true);
      assert.ok(res.data.items.length >= 1);
    });
  });

  describe("5. Benchmark do tre tim kiem (< 200ms theo Duty Roster)", () => {
    it("Do tre tim kiem trung binh phai duoi 200ms", async () => {
      const iterations = 10;
      let totalDuration = 0;

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await searchService.searchEvents({
          keyword: "nhac trinh",
          city: "Ha Noi",
          limit: 10,
        });
        const duration = performance.now() - start;
        totalDuration += duration;
      }

      const avgDuration = totalDuration / iterations;
      console.log(
        `[Benchmark] Thoi gian tim kiem trung binh: ${avgDuration.toFixed(2)}ms`,
      );
      assert.ok(
        avgDuration < 200,
        `Thời gian tìm kiếm trung bình (${avgDuration.toFixed(2)}ms) phải nhỏ hơn 200ms theo Duty Roster`,
      );
    });
  });
});
