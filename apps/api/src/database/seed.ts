import { db, sqlClient } from "./db";
import {
  users,
  organizerProfiles,
  events,
  ticketTypes,
  seats,
  gates,
  eventStaff,
  venues,
  venueLayouts,
} from "./schema";
import {
  UserRole,
  UserStatus,
  OrganizerStatus,
  EventStatus,
  RefundPolicyType,
  SeatStatus,
} from "@tickethub/shared";

async function seed() {
  console.log("Seeding initial database records...");

  // 1. Users (default password: Password123!)
  const defaultPasswordHash =
    "$argon2id$v=19$m=65536,p=4,t=3$ZizAyGaEgeq8Olc9I4nW4g$kJQV9gHwtfhN6I8kFpDZ6fIfV+VNfn9tMTB9jtyYukA";

  const [adminUser] = await db
    .insert(users)
    .values({
      email: "admin@tickethub.vn",
      fullName: "Quản trị viên Hệ thống",
      passwordHash: defaultPasswordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  const [organizerUser] = await db
    .insert(users)
    .values({
      email: "organizer@tickethub.vn",
      fullName: "Đại diện Ban tổ chức",
      passwordHash: defaultPasswordHash,
      role: UserRole.ORGANIZER,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  const [staffUser] = await db
    .insert(users)
    .values({
      email: "staff@tickethub.vn",
      fullName: "Nhân viên Soát vé Cổng",
      passwordHash: defaultPasswordHash,
      role: UserRole.GATE_STAFF,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  await db
    .insert(users)
    .values({
      email: "buyer@tickethub.vn",
      fullName: "Nguyễn Văn Người Mua",
      passwordHash: defaultPasswordHash,
      role: UserRole.BUYER,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    })
    .onConflictDoNothing();

  if (!organizerUser) {
    console.log("Seed data already present. Skipping insertion.");
    await sqlClient.end();
    return;
  }

  // 2. Organizer Profile
  const [orgProfile] = await db
    .insert(organizerProfiles)
    .values({
      userId: organizerUser.id,
      organizationName: "Công ty Cổ phần Âm nhạc và Giải trí Việt Nam",
      taxCode: "0101234567",
      businessLicenseUrl:
        "https://cdn.tickethub.vn/licenses/license-0101234567.pdf",
      representativeName: "Trần Văn Giám Đốc",
      status: OrganizerStatus.VERIFIED,
      verifiedBy: adminUser?.id,
      verifiedAt: new Date(),
    })
    .returning();

  if (!orgProfile) {
    throw new Error("Failed to create organizer profile during seed");
  }

  // 3. Event
  const now = new Date();
  const startTime = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days later
  const endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000); // +4 hours
  const gateOpeningTime = new Date(startTime.getTime() - 2 * 60 * 60 * 1000); // -2 hours
  const saleStartTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
  const saleEndTime = new Date(startTime.getTime() - 2 * 60 * 60 * 1000);

  const [sampleEvent] = await db
    .insert(events)
    .values({
      organizerId: orgProfile.id,
      title: "Liveshow Âm Nhạc Mùa Thu 2026",
      slug: "liveshow-am-nhac-mua-thu-2026",
      description:
        "Đại nhạc hội quy tụ các nghệ sĩ hàng đầu Việt Nam tại Trung tâm Hội nghị Quốc gia.",
      category: "Âm nhạc",
      bannerUrl: "https://cdn.tickethub.vn/banners/mua-thu-2026.webp",
      venueName: "Trung tâm Hội nghị Quốc gia",
      venueAddress: "Số 57 đường Phạm Hùng, Mễ Trì, Nam Từ Liêm",
      city: "Hà Nội",
      startTime,
      endTime,
      gateOpeningTime,
      status: EventStatus.PUBLISHED,
      refundPolicyType: RefundPolicyType.FLEXIBLE,
      refundPolicyRules: [
        { hoursBeforeStart: 72, refundRate: 100 },
        { hoursBeforeStart: 24, refundRate: 50 },
      ],
    })
    .returning();

  if (!sampleEvent) {
    throw new Error("Failed to create event during seed");
  }

  // 4. Ticket Types
  const [vipTicketType] = await db
    .insert(ticketTypes)
    .values({
      eventId: sampleEvent.id,
      name: "Khu VIP A",
      description: "Vị trí trực diện sân khấu, lối đi riêng, quà lưu niệm",
      price: "2500000.00",
      capacity: 20,
      isSeated: true,
      saleStartTime,
      saleEndTime,
      maxPerOrder: 6,
      sortOrder: 1,
    })
    .returning();

  if (!vipTicketType) {
    throw new Error("Failed to create VIP ticket type during seed");
  }

  await db.insert(ticketTypes).values({
    eventId: sampleEvent.id,
    name: "Khu Tiêu Chuẩn B",
    description: "Ghế ngồi khán đài tầng 1",
    price: "1200000.00",
    capacity: 30,
    isSeated: true,
    saleStartTime,
    saleEndTime,
    maxPerOrder: 6,
    sortOrder: 2,
  });

  await db.insert(ticketTypes).values({
    eventId: sampleEvent.id,
    name: "Khu Đứng GA",
    description: "Khu vực đứng gần sân khấu",
    price: "600000.00",
    capacity: 100,
    isSeated: false,
    saleStartTime,
    saleEndTime,
    maxPerOrder: 6,
    sortOrder: 3,
  });

  // 5. Seats for VIP A
  const seatRows = ["A", "B"];
  const seatRecords = [];
  for (const row of seatRows) {
    for (let i = 1; i <= 10; i++) {
      const seatNumber = i < 10 ? `0${i}` : `${i}`;
      seatRecords.push({
        eventId: sampleEvent.id,
        ticketTypeId: vipTicketType.id,
        zoneName: "Khu VIP A",
        rowLabel: row,
        seatNumber,
        status: SeatStatus.AVAILABLE,
      });
    }
  }
  await db.insert(seats).values(seatRecords);

  // 6. Gates
  const [gateA] = await db
    .insert(gates)
    .values({
      eventId: sampleEvent.id,
      name: "Cổng A (VIP)",
      locationDesc: "Tầng trệt, sảnh chính phía Tây",
    })
    .returning();

  if (!gateA) {
    throw new Error("Failed to create gate A during seed");
  }

  await db.insert(gates).values({
    eventId: sampleEvent.id,
    name: "Cổng B (Tiêu chuẩn)",
    locationDesc: "Tầng trệt, sảnh phía Đông",
  });

  // 7. Event Staff
  if (staffUser) {
    await db.insert(eventStaff).values({
      eventId: sampleEvent.id,
      userId: staffUser.id,
      gateId: gateA.id,
      staffRole: "GATE_SCANNER",
    });
  }

  // 8. Curated Venues & Layouts
  console.log("Seeding Curated Venues and SVG layouts...");
  const [myDinh] = await db
    .insert(venues)
    .values({
      name: "Sân vận động Quốc gia Mỹ Đình",
      shortName: "SVĐ Mỹ Đình",
      city: "Hà Nội",
      district: "Nam Từ Liêm",
      address: "Đường Lê Đức Thọ, Phường Mỹ Đình 1, Nam Từ Liêm, Hà Nội",
      category: "stadium",
      totalCapacity: "40,192",
      thumbnailUrl: "/images/venues/my-dinh.webp",
      description:
        "Sân vận động quốc gia trọng điểm phục vụ đại nhạc hội và thi đấu thể thao quốc tế.",
    })
    .onConflictDoNothing()
    .returning();

  const [phuTho] = await db
    .insert(venues)
    .values({
      name: "Nhà thi đấu Thể dục Thể thao Phú Thọ",
      shortName: "NTĐ Phú Thọ",
      city: "TP. Hồ Chí Minh",
      district: "Quận 11",
      address: "Số 1 Lữ Gia, Phường 15, Quận 11, TP. Hồ Chí Minh",
      category: "arena",
      totalCapacity: "8,000",
      thumbnailUrl: "/images/venues/phu-tho.webp",
      description: "Nhà thi đấu đa năng hiện đại hàng đầu khu vực phía Nam.",
    })
    .onConflictDoNothing()
    .returning();

  const [tienSon] = await db
    .insert(venues)
    .values({
      name: "Cung Thể thao Tiên Sơn",
      shortName: "Cung TT Tiên Sơn",
      city: "Đà Nẵng",
      district: "Hải Châu",
      address: "Phan Đăng Lưu, Phường Hòa Cường Bắc, Quận Hải Châu, Đà Nẵng",
      category: "sports",
      totalCapacity: "6,500",
      thumbnailUrl: "/images/venues/tien-son.webp",
      description: "Cung thể thao Đĩa Bay hiện đại bậc nhất miền Trung.",
    })
    .onConflictDoNothing()
    .returning();

  if (myDinh) {
    await db
      .insert(venueLayouts)
      .values([
        {
          venueId: myDinh.id,
          name: "Sân Khấu Chữ T (Live Concert T-Stage)",
          categoryName: "Live Concert",
          capacityEstimate: "25,000 - 30,000",
          mapKey: "my-dinh-concert-t-stage",
          svgContent:
            '<svg viewBox="0 0 1000 800"><rect width="1000" height="800" fill="#18181b"/><text x="500" y="400" fill="#fff" text-anchor="middle">Sơ đồ Sân Khấu Chữ T - Mỹ Đình</text></svg>',
          defaultZones: [
            {
              zoneName: "VVIP Khán Đài A",
              color: "#E5A93C",
              price: 3500000,
              capacity: 1500,
            },
            {
              zoneName: "VIP Khán Đài B",
              color: "#A855F7",
              price: 2500000,
              capacity: 3000,
            },
            {
              zoneName: "GA Fanzone Sân Cỏ",
              color: "#3B82F6",
              price: 1200000,
              capacity: 8000,
            },
          ],
          isDefault: true,
        },
        {
          venueId: myDinh.id,
          name: "Mega Concert Sân Vận Động (Toàn Sân)",
          categoryName: "Mega Concert",
          capacityEstimate: "35,000 - 40,000",
          mapKey: "my-dinh-mega-stadium",
          svgContent:
            '<svg viewBox="0 0 1000 800"><rect width="1000" height="800" fill="#18181b"/><text x="500" y="400" fill="#fff" text-anchor="middle">Sơ đồ Toàn Sân - Mỹ Đình</text></svg>',
          defaultZones: [
            {
              zoneName: "VIP Khán Đài",
              color: "#E5A93C",
              price: 3000000,
              capacity: 5000,
            },
            {
              zoneName: "Standard Tầng 2",
              color: "#10B981",
              price: 1500000,
              capacity: 15000,
            },
          ],
          isDefault: false,
        },
      ])
      .onConflictDoNothing();
  }

  if (phuTho) {
    await db
      .insert(venueLayouts)
      .values([
        {
          venueId: phuTho.id,
          name: "Live Concert Sân Khấu Trung Tâm (360 Arena)",
          categoryName: "Live Concert",
          capacityEstimate: "6,000 - 7,500",
          mapKey: "phu-tho-center-stage",
          svgContent:
            '<svg viewBox="0 0 800 600"><rect width="800" height="600" fill="#18181b"/><text x="400" y="300" fill="#fff" text-anchor="middle">Sơ đồ 360 Arena - Phú Thọ</text></svg>',
          defaultZones: [
            {
              zoneName: "VIP Sàn Đấu",
              color: "#E5A93C",
              price: 2200000,
              capacity: 1000,
            },
            {
              zoneName: "Khán Đài Tầng 1",
              color: "#3B82F6",
              price: 1200000,
              capacity: 3500,
            },
          ],
          isDefault: true,
        },
      ])
      .onConflictDoNothing();
  }

  if (tienSon) {
    await db
      .insert(venueLayouts)
      .values([
        {
          venueId: tienSon.id,
          name: "Đêm Nhạc Hội Khán Phòng Arena",
          categoryName: "Arena Concert",
          capacityEstimate: "5,000",
          mapKey: "tien-son-arena",
          svgContent:
            '<svg viewBox="0 0 800 600"><rect width="800" height="600" fill="#18181b"/><text x="400" y="300" fill="#fff" text-anchor="middle">Sơ đồ Arena - Tiên Sơn</text></svg>',
          defaultZones: [
            {
              zoneName: "VIP A",
              color: "#E5A93C",
              price: 1800000,
              capacity: 800,
            },
            {
              zoneName: "Khán Đài B",
              color: "#3B82F6",
              price: 900000,
              capacity: 2500,
            },
          ],
          isDefault: true,
        },
      ])
      .onConflictDoNothing();
  }

  console.log("Database seeded successfully.");
  await sqlClient.end();
}

seed().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
