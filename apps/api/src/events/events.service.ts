import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { eq, and, ne, sql } from "drizzle-orm";
import { db } from "../database/db";
import {
  events,
  ticketTypes,
  seats,
  organizerProfiles,
  outbox,
  tickets,
} from "../database/schema";
import {
  CreateEventRequest,
  EventStatus,
  OrganizerStatus,
  OutboxStatus,
  SeatStatus,
  TicketStatus,
} from "@tickethub/shared";

export interface GenerateSeatsDto {
  zones: Array<{
    zoneName: string;
    ticketTypeId: string;
    rows: string[];
    seatsPerRow: number;
  }>;
}

export interface UpdateEventDto {
  title?: string;
  description?: string;
  category?: string;
  bannerUrl?: string;
  venueName?: string;
  venueAddress?: string;
  city?: string;
  startTime?: string;
  endTime?: string;
  gateOpeningTime?: string;
  version: number;
}

@Injectable()
export class EventsService {
  async getOrganizerProfileOrThrow(userId: string) {
    const profile = await db.query.organizerProfiles.findFirst({
      where: eq(organizerProfiles.userId, userId),
    });

    if (!profile) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "ORGANIZER_PROFILE_REQUIRED",
          message: "Tài khoản chưa có hồ sơ ban tổ chức",
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (profile.status !== OrganizerStatus.VERIFIED) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "ORGANIZER_NOT_VERIFIED",
          message: "Hồ sơ ban tổ chức chưa được quản trị viên phê duyệt",
          timestamp: new Date().toISOString(),
        },
      });
    }

    return profile;
  }

  async createEvent(userId: string, dto: CreateEventRequest) {
    const profile = await this.getOrganizerProfileOrThrow(userId);

    const existingSlug = await db.query.events.findFirst({
      where: eq(events.slug, dto.slug),
    });

    if (existingSlug) {
      throw new ConflictException({
        success: false,
        error: {
          code: "SLUG_ALREADY_EXISTS",
          message: `Đường dẫn định danh (slug) '${dto.slug}' đã tồn tại trong hệ thống`,
          timestamp: new Date().toISOString(),
        },
      });
    }

    return db.transaction(async (tx) => {
      const [newEvent] = await tx
        .insert(events)
        .values({
          organizerId: profile.id,
          title: dto.title,
          slug: dto.slug,
          description: dto.description,
          category: dto.category,
          bannerUrl: dto.bannerUrl,
          venueName: dto.venueName,
          venueAddress: dto.venueAddress,
          city: dto.city,
          startTime: new Date(dto.startTime),
          endTime: new Date(dto.endTime),
          gateOpeningTime: new Date(dto.gateOpeningTime),
          status: EventStatus.DRAFT,
          refundPolicyType: dto.refundPolicyType,
          refundPolicyRules: dto.refundPolicyRules,
          version: 1,
        })
        .returning();

      if (!newEvent) {
        throw new Error("Không thể khởi tạo bản ghi sự kiện");
      }

      const ticketTypeValues = dto.ticketTypes.map((tt) => ({
        eventId: newEvent.id,
        name: tt.name,
        description: tt.description,
        price: tt.price.toFixed(2),
        capacity: tt.capacity,
        isSeated: tt.isSeated,
        saleStartTime: new Date(tt.saleStartTime),
        saleEndTime: new Date(tt.saleEndTime),
        maxPerOrder: tt.maxPerOrder,
        sortOrder: tt.sortOrder,
      }));

      const insertedTicketTypes = await tx
        .insert(ticketTypes)
        .values(ticketTypeValues)
        .returning();

      await tx.insert(outbox).values({
        eventType: "EVENT_CREATED",
        payload: {
          eventId: newEvent.id,
          organizerId: profile.id,
          title: newEvent.title,
        },
        status: OutboxStatus.PENDING,
      });

      return {
        ...newEvent,
        ticketTypes: insertedTicketTypes,
      };
    });
  }

  async getOrganizerEvents(userId: string) {
    const profile = await this.getOrganizerProfileOrThrow(userId);

    const items = await db.query.events.findMany({
      where: eq(events.organizerId, profile.id),
      with: {
        ticketTypes: true,
      },
      orderBy: (events, { desc }) => [desc(events.createdAt)],
    });

    return items;
  }

  async getOrganizerEventById(userId: string, eventId: string) {
    const profile = await this.getOrganizerProfileOrThrow(userId);

    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, profile.id)),
      with: {
        ticketTypes: true,
        gates: true,
      },
    });

    if (!event) {
      throw new NotFoundException({
        success: false,
        error: {
          code: "EVENT_NOT_FOUND",
          message: "Không tìm thấy sự kiện của ban tổ chức",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Đếm tổng số ghế đã sinh
    const [seatCountResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(seats)
      .where(eq(seats.eventId, eventId));

    return {
      ...event,
      totalSeats: seatCountResult?.count ?? 0,
    };
  }

  async updateEvent(userId: string, eventId: string, dto: UpdateEventDto) {
    const profile = await this.getOrganizerProfileOrThrow(userId);

    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, profile.id)),
    });

    if (!event) {
      throw new NotFoundException({
        success: false,
        error: {
          code: "EVENT_NOT_FOUND",
          message: "Không tìm thấy sự kiện cần cập nhật",
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (event.status !== EventStatus.DRAFT) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "EVENT_CANNOT_BE_EDITED",
          message: `Chỉ sự kiện ở trạng thái DRAFT mới được phép chỉnh sửa (trạng thái hiện tại: ${event.status})`,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Kiểm tra Optimistic Locking
    if (event.version !== dto.version) {
      throw new ConflictException({
        success: false,
        error: {
          code: "CONCURRENT_MODIFICATION",
          message:
            "Dữ liệu sự kiện đã bị thay đổi bởi phiên làm việc khác. Vui lòng làm mới trang.",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const updateData: Partial<typeof events.$inferInsert> = {
      version: event.version + 1,
      updatedAt: new Date(),
    };

    if (dto.title) updateData.title = dto.title;
    if (dto.description) updateData.description = dto.description;
    if (dto.category) updateData.category = dto.category;
    if (dto.bannerUrl) updateData.bannerUrl = dto.bannerUrl;
    if (dto.venueName) updateData.venueName = dto.venueName;
    if (dto.venueAddress) updateData.venueAddress = dto.venueAddress;
    if (dto.city) updateData.city = dto.city;
    if (dto.startTime) updateData.startTime = new Date(dto.startTime);
    if (dto.endTime) updateData.endTime = new Date(dto.endTime);
    if (dto.gateOpeningTime)
      updateData.gateOpeningTime = new Date(dto.gateOpeningTime);

    const [updated] = await db
      .update(events)
      .set(updateData)
      .where(and(eq(events.id, eventId), eq(events.version, dto.version)))
      .returning();

    if (!updated) {
      throw new ConflictException({
        success: false,
        error: {
          code: "CONCURRENT_MODIFICATION",
          message: "Cập nhật thất bại do tranh chấp dữ liệu phiên bản",
          timestamp: new Date().toISOString(),
        },
      });
    }

    return updated;
  }

  async generateSeats(userId: string, eventId: string, dto: GenerateSeatsDto) {
    const profile = await this.getOrganizerProfileOrThrow(userId);

    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, profile.id)),
      with: { ticketTypes: true },
    });

    if (!event) {
      throw new NotFoundException({
        success: false,
        error: {
          code: "EVENT_NOT_FOUND",
          message: "Không tìm thấy sự kiện",
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (event.status !== EventStatus.DRAFT) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "EVENT_CANNOT_BE_EDITED",
          message: "Chỉ có thể sinh sơ đồ ghế khi sự kiện ở trạng thái DRAFT",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Chặn sửa sơ đồ ghế nếu đã có vé bán ra
    const soldTicket = await db.query.tickets.findFirst({
      where: and(
        eq(tickets.eventId, eventId),
        ne(tickets.status, TicketStatus.CANCELLED),
      ),
    });

    if (soldTicket) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "CANNOT_MODIFY_SOLD_SEATS",
          message: "Không thể sinh lại sơ đồ ghế khi đã phát sinh vé bán ra",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const ticketTypeMap = new Map(event.ticketTypes.map((tt) => [tt.id, tt]));

    // Xác thực các hạng vé yêu cầu
    for (const zone of dto.zones) {
      const tt = ticketTypeMap.get(zone.ticketTypeId);
      if (!tt) {
        throw new BadRequestException({
          success: false,
          error: {
            code: "INVALID_TICKET_TYPE",
            message: `Hạng vé ${zone.ticketTypeId} không thuộc sự kiện này`,
            timestamp: new Date().toISOString(),
          },
        });
      }
      if (!tt.isSeated) {
        throw new BadRequestException({
          success: false,
          error: {
            code: "TICKET_TYPE_NOT_SEATED",
            message: `Hạng vé '${tt.name}' là khu đứng, không áp dụng sinh ghế ngồi`,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    return db.transaction(async (tx) => {
      // Xóa các ghế hiện có của sự kiện (nếu đang ở DRAFT)
      await tx.delete(seats).where(eq(seats.eventId, eventId));

      const seatRecords: Array<typeof seats.$inferInsert> = [];
      const capacityMap = new Map<string, number>();

      for (const zone of dto.zones) {
        let countForZone = 0;
        for (const row of zone.rows) {
          for (let i = 1; i <= zone.seatsPerRow; i++) {
            const seatNumber = i < 10 ? `0${i}` : `${i}`;
            seatRecords.push({
              eventId,
              ticketTypeId: zone.ticketTypeId,
              zoneName: zone.zoneName,
              rowLabel: row,
              seatNumber,
              status: SeatStatus.AVAILABLE,
              version: 1,
            });
            countForZone++;
          }
        }
        const current = capacityMap.get(zone.ticketTypeId) ?? 0;
        capacityMap.set(zone.ticketTypeId, current + countForZone);
      }

      if (seatRecords.length > 0) {
        await tx.insert(seats).values(seatRecords);
      }

      // Cập nhật sức chứa (capacity) của các hạng vé tương ứng
      for (const [ttId, newCapacity] of capacityMap.entries()) {
        await tx
          .update(ticketTypes)
          .set({ capacity: newCapacity, updatedAt: new Date() })
          .where(eq(ticketTypes.id, ttId));
      }

      await tx
        .update(events)
        .set({ version: event.version + 1, updatedAt: new Date() })
        .where(eq(events.id, eventId));

      return {
        eventId,
        totalSeatsGenerated: seatRecords.length,
        updatedTicketTypes: Array.from(capacityMap.entries()).map(
          ([ticketTypeId, capacity]) => ({
            ticketTypeId,
            capacity,
          }),
        ),
      };
    });
  }

  async submitEventForApproval(userId: string, eventId: string) {
    const profile = await this.getOrganizerProfileOrThrow(userId);

    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, profile.id)),
      with: { ticketTypes: true },
    });

    if (!event) {
      throw new NotFoundException({
        success: false,
        error: {
          code: "EVENT_NOT_FOUND",
          message: "Không tìm thấy sự kiện",
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (event.status !== EventStatus.DRAFT) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_EVENT_STATUS",
          message: `Chỉ sự kiện DRAFT mới có thể gửi phê duyệt (trạng thái hiện tại: ${event.status})`,
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (event.ticketTypes.length === 0) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "NO_TICKET_TYPES",
          message: "Sự kiện phải có ít nhất 1 hạng vé trước khi gửi phê duyệt",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Kiểm tra xem các hạng vé có ghế đã sinh ghế chưa
    for (const tt of event.ticketTypes) {
      if (tt.isSeated) {
        const [seatCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(seats)
          .where(
            and(eq(seats.eventId, eventId), eq(seats.ticketTypeId, tt.id)),
          );

        if (!seatCount || seatCount.count === 0) {
          throw new BadRequestException({
            success: false,
            error: {
              code: "SEATS_NOT_GENERATED",
              message: `Hạng vé có số ghế '${tt.name}' chưa được sinh sơ đồ ghế`,
              timestamp: new Date().toISOString(),
            },
          });
        }
      }
    }

    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(events)
        .set({
          status: EventStatus.PENDING_APPROVAL,
          version: event.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(events.id, eventId))
        .returning();

      await tx.insert(outbox).values({
        eventType: "EVENT_SUBMITTED_FOR_APPROVAL",
        payload: {
          eventId: event.id,
          organizerId: profile.id,
          title: event.title,
        },
        status: OutboxStatus.PENDING,
      });

      return {
        eventId: updated?.id,
        status: updated?.status,
        version: updated?.version,
      };
    });
  }

  // Phương thức công khai tìm kiếm sự kiện (UC02)
  async getPublicEvents(query: {
    keyword?: string;
    city?: string;
    category?: string;
    limit?: number;
  }) {
    const limit = query.limit ?? 20;

    const items = await db.query.events.findMany({
      where: eq(events.status, EventStatus.PUBLISHED),
      with: {
        ticketTypes: true,
      },
      limit,
      orderBy: (events, { asc }) => [asc(events.startTime)],
    });

    return items;
  }

  async getPublicEventBySlug(slug: string) {
    const event = await db.query.events.findFirst({
      where: and(
        eq(events.slug, slug),
        eq(events.status, EventStatus.PUBLISHED),
      ),
      with: {
        ticketTypes: true,
      },
    });

    if (!event) {
      throw new NotFoundException({
        success: false,
        error: {
          code: "EVENT_NOT_FOUND",
          message: "Không tìm thấy thông tin sự kiện",
          timestamp: new Date().toISOString(),
        },
      });
    }

    return event;
  }

  async getEventSeatMap(eventId: string) {
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      with: {
        ticketTypes: true,
      },
    });

    if (!event) {
      throw new NotFoundException({
        success: false,
        error: {
          code: "EVENT_NOT_FOUND",
          message: "Không tìm thấy sự kiện",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const allSeats = await db.query.seats.findMany({
      where: eq(seats.eventId, eventId),
      orderBy: [seats.zoneName, seats.rowLabel, seats.seatNumber],
    });

    // Gom nhóm theo zoneName
    const zoneMap = new Map<
      string,
      {
        zoneName: string;
        ticketTypeId: string;
        isSeated: boolean;
        rows: Map<
          string,
          Array<{ id: string; seatNumber: string; status: string }>
        >;
      }
    >();

    for (const seat of allSeats) {
      if (!zoneMap.has(seat.zoneName)) {
        zoneMap.set(seat.zoneName, {
          zoneName: seat.zoneName,
          ticketTypeId: seat.ticketTypeId,
          isSeated: true,
          rows: new Map(),
        });
      }
      const zoneObj = zoneMap.get(seat.zoneName)!;
      if (!zoneObj.rows.has(seat.rowLabel)) {
        zoneObj.rows.set(seat.rowLabel, []);
      }
      zoneObj.rows.get(seat.rowLabel)!.push({
        id: seat.id,
        seatNumber: seat.seatNumber,
        status: seat.status,
      });
    }

    const formattedZones = Array.from(zoneMap.values()).map((zone) => ({
      zoneName: zone.zoneName,
      ticketTypeId: zone.ticketTypeId,
      isSeated: zone.isSeated,
      rows: Array.from(zone.rows.entries()).map(([rowLabel, seatsList]) => ({
        rowLabel,
        seats: seatsList,
      })),
    }));

    return {
      eventId,
      zones: formattedZones,
    };
  }
}
