import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../database/db";

import {
  auditLog,
  events,
  orders,
  organizerProfiles,
  outbox,
  seats,
  ticketTypes,
  users,
} from "../database/schema";

import {
  AuditLogListData,
  AuditLogQuery,
  EventKillSwitchData,
  EventKillSwitchRequest,
  EventResumeData,
  EventResumeRequest,
  EventStatus,
  OrderStatus,
  OrganizerStatus,
  OutboxStatus,
  SeatStatus,
  UserRole,
} from "@tickethub/shared";
import { EventReadCacheService } from "../events/event-read-cache.service";

export interface ReviewOrganizerDto {
  decision: "APPROVE" | "REJECT";
  reason?: string | undefined;
  version?: number | undefined;
}

export interface ReviewEventDto {
  decision: "APPROVE" | "REJECT";
  reason?: string | undefined;
  version?: number | undefined;
}

export interface AuditRequestMeta {
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}

@Injectable()
export class AdminService {
  constructor(
    @Optional()
    @Inject(EventReadCacheService)
    private readonly eventReadCacheService?: EventReadCacheService,
  ) {}
  async getPendingOrganizers() {
    const items = await db
      .select({
        id: organizerProfiles.id,
        userId: organizerProfiles.userId,
        organizationName: organizerProfiles.organizationName,
        representativeName: organizerProfiles.representativeName,
        taxCode: organizerProfiles.taxCode,
        businessLicenseUrl: organizerProfiles.businessLicenseUrl,
        status: organizerProfiles.status,
        version: organizerProfiles.version,
        createdAt: organizerProfiles.createdAt,
        email: users.email,
      })
      .from(organizerProfiles)
      .innerJoin(users, eq(organizerProfiles.userId, users.id))
      .where(eq(organizerProfiles.status, OrganizerStatus.PENDING_VERIFICATION))
      .orderBy(desc(organizerProfiles.createdAt));

    return items;
  }

  async reviewOrganizer(
    profileId: string,
    adminId: string,
    dto: ReviewOrganizerDto,
    meta?: AuditRequestMeta,
  ) {
    const { decision, reason } = dto;

    const newStatus =
      decision === "APPROVE"
        ? OrganizerStatus.VERIFIED
        : OrganizerStatus.REJECTED;

    return db.transaction(async (tx) => {
      // 1. Kiểm tra tồn tại và trạng thái hồ sơ
      const [existing] = await tx
        .select({
          id: organizerProfiles.id,
          userId: organizerProfiles.userId,
          organizationName: organizerProfiles.organizationName,
          status: organizerProfiles.status,
          version: organizerProfiles.version,
        })
        .from(organizerProfiles)
        .where(eq(organizerProfiles.id, profileId))
        .limit(1);

      if (!existing) {
        throw new NotFoundException({
          success: false,
          error: {
            code: "ORGANIZER_NOT_FOUND",
            message: "Không tìm thấy hồ sơ Ban tổ chức",
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (existing.status !== OrganizerStatus.PENDING_VERIFICATION) {
        throw new ConflictException({
          success: false,
          error: {
            code: "ORGANIZER_ALREADY_PROCESSED",
            message: "Hồ sơ Ban tổ chức đã được xử lý trước đó",
            timestamp: new Date().toISOString(),
          },
        });
      }

      const expectedVersion = dto.version ?? existing.version;

      // 2. Cập nhật hồ sơ nếu trạng thái và version hợp lệ
      const [updated] = await tx
        .update(organizerProfiles)
        .set({
          status: newStatus,
          rejectionReason: decision === "REJECT" ? reason : null,
          verifiedBy: decision === "APPROVE" ? adminId : null,
          verifiedAt: decision === "APPROVE" ? new Date() : null,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizerProfiles.id, profileId),
            eq(organizerProfiles.status, OrganizerStatus.PENDING_VERIFICATION),
            eq(organizerProfiles.version, expectedVersion),
          ),
        )
        .returning();

      if (!updated) {
        throw new ConflictException({
          success: false,
          error: {
            code: "CONCURRENT_MODIFICATION",
            message: "Hồ sơ đã được xử lý hoặc version không còn hợp lệ",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // 3. Lấy tài khoản người dùng của Ban tổ chức
      const [owner] = await tx
        .select({
          userId: users.id,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, updated.userId))
        .limit(1);

      if (!owner || !owner.email) {
        throw new NotFoundException({
          success: false,
          error: {
            code: "ORGANIZER_ACCOUNT_NOT_FOUND",
            message: "Không tìm thấy tài khoản người dùng của Ban tổ chức",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // 4. Ghi nhật ký Admin (Audit Log)
      await tx.insert(auditLog).values({
        actorId: adminId,
        actorRole: UserRole.ADMIN,
        action:
          decision === "APPROVE" ? "ORGANIZER_APPROVED" : "ORGANIZER_REJECTED",
        targetType: "ORGANIZER_PROFILE",
        targetId: updated.id,
        changes: {
          oldStatus: OrganizerStatus.PENDING_VERIFICATION,
          newStatus,
          reason: reason ?? null,
        },
        ipAddress: meta?.ipAddress ?? null,
        userAgent: meta?.userAgent ?? null,
      });

      // 5. Tạo Outbox event để xử lý thông báo bất đồng bộ
      await tx.insert(outbox).values({
        eventType:
          decision === "APPROVE" ? "ORGANIZER_APPROVED" : "ORGANIZER_REJECTED",
        payload: {
          profileId: updated.id,
          userId: updated.userId,
          email: owner.email,
          organizationName: updated.organizationName,
          decision,
          reason: reason ?? null,
        },
        status: OutboxStatus.PENDING,
      });

      return updated;
    });
  }

  async getPendingEvents() {
    const items = await db
      .select({
        id: events.id,
        title: events.title,
        organizerId: events.organizerId,
        organizationName: organizerProfiles.organizationName,
        status: events.status,
        version: events.version,
        startTime: events.startTime,
        createdAt: events.createdAt,
      })
      .from(events)
      .innerJoin(
        organizerProfiles,
        eq(events.organizerId, organizerProfiles.id),
      )
      .where(eq(events.status, EventStatus.PENDING_APPROVAL))
      .orderBy(desc(events.createdAt));

    return items;
  }

  async reviewEvent(
    eventId: string,
    adminId: string,
    dto: ReviewEventDto,
    meta?: AuditRequestMeta,
  ) {
    const { decision, reason } = dto;

    const newStatus =
      decision === "APPROVE" ? EventStatus.PUBLISHED : EventStatus.DRAFT;

    return db.transaction(async (tx) => {
      // 1. Kiểm tra tồn tại và trạng thái sự kiện
      const [existing] = await tx
        .select({
          id: events.id,
          title: events.title,
          organizerId: events.organizerId,
          status: events.status,
          version: events.version,
        })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1);

      if (!existing) {
        throw new NotFoundException({
          success: false,
          error: {
            code: "EVENT_NOT_FOUND",
            message: "Không tìm thấy sự kiện",
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (existing.status !== EventStatus.PENDING_APPROVAL) {
        throw new ConflictException({
          success: false,
          error: {
            code: "EVENT_NOT_IN_REVIEW",
            message: "Sự kiện không ở trạng thái chờ phê duyệt",
            timestamp: new Date().toISOString(),
          },
        });
      }

      const expectedVersion = dto.version ?? existing.version;

      // 2. Cập nhật trạng thái và kiểm tra version
      const [updated] = await tx
        .update(events)
        .set({
          status: newStatus,
          rejectionReason: decision === "REJECT" ? reason : null,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(events.id, eventId),
            eq(events.status, EventStatus.PENDING_APPROVAL),
            eq(events.version, expectedVersion),
          ),
        )
        .returning();

      if (!updated) {
        throw new ConflictException({
          success: false,
          error: {
            code: "CONCURRENT_MODIFICATION",
            message: "Sự kiện đã được xử lý hoặc version không còn hợp lệ",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // 3. Lấy thông tin Ban tổ chức
      const [owner] = await tx
        .select({
          userId: users.id,
          email: users.email,
        })
        .from(organizerProfiles)
        .innerJoin(users, eq(organizerProfiles.userId, users.id))
        .where(eq(organizerProfiles.id, updated.organizerId))
        .limit(1);

      if (!owner || !owner.email) {
        throw new NotFoundException({
          success: false,
          error: {
            code: "ORGANIZER_ACCOUNT_NOT_FOUND",
            message: "Không tìm thấy tài khoản người dùng của Ban tổ chức",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // 4. Ghi Audit Log
      await tx.insert(auditLog).values({
        actorId: adminId,
        actorRole: UserRole.ADMIN,
        action: decision === "APPROVE" ? "EVENT_APPROVED" : "EVENT_REJECTED",
        targetType: "EVENT",
        targetId: updated.id,
        changes: {
          oldStatus: EventStatus.PENDING_APPROVAL,
          newStatus,
          reason: reason ?? null,
        },
        ipAddress: meta?.ipAddress ?? null,
        userAgent: meta?.userAgent ?? null,
      });

      // 5. Ghi Outbox để xử lý thông báo
      await tx.insert(outbox).values({
        eventType: decision === "APPROVE" ? "EVENT_APPROVED" : "EVENT_REJECTED",
        payload: {
          eventId: updated.id,
          organizerId: updated.organizerId,
          userId: owner.userId,
          email: owner.email,
          eventTitle: updated.title,
          decision,
          reason: reason ?? null,
        },
        status: OutboxStatus.PENDING,
      });

      return updated;
    });
  }

  /**
   * Kích hoạt ngắt khẩn cấp sự kiện vi phạm (Kill Switch)
   * Cascade nguyên tử: Chuyển SUSPENDED, hủy đơn PENDING, giải phóng ghế HELD, reset heldCount GA, ghi audit_log & outbox, xóa cache Redis
   */
  async activateKillSwitch(
    eventId: string,
    adminId: string,
    dto: EventKillSwitchRequest,
    meta?: AuditRequestMeta,
  ): Promise<EventKillSwitchData> {
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: events.id,
          status: events.status,
          version: events.version,
        })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1);

      if (!existing) {
        throw new NotFoundException("EVENT_NOT_FOUND: Không tìm thấy sự kiện");
      }

      if (existing.status === EventStatus.SUSPENDED) {
        throw new ConflictException(
          "EVENT_ALREADY_SUSPENDED: Sự kiện đã bị ngắt khẩn cấp trước đó",
        );
      }

      if (existing.status !== EventStatus.PUBLISHED) {
        throw new BadRequestException(
          "EVENT_NOT_PUBLISHED: Chỉ có thể ngắt khẩn cấp sự kiện đang mở bán công khai",
        );
      }

      const expectedVersion = dto.version ?? existing.version;
      if (dto.version !== undefined && dto.version !== existing.version) {
        throw new ConflictException(
          "CONCURRENT_MODIFICATION: Phiên bản sự kiện không khớp (optimistic lock)",
        );
      }

      const now = new Date();

      // 1. Cập nhật trạng thái sự kiện sang SUSPENDED
      const [updated] = await tx
        .update(events)
        .set({
          status: EventStatus.SUSPENDED,
          rejectionReason: dto.reason,
          version: expectedVersion + 1,
          updatedAt: now,
        })
        .where(and(eq(events.id, eventId), eq(events.version, expectedVersion)))
        .returning();

      if (!updated) {
        throw new ConflictException(
          "CONCURRENT_MODIFICATION: Không thể cập nhật sự kiện do xung đột đồng thời",
        );
      }

      // 2. Hủy toàn bộ đơn hàng đang ở trạng thái PENDING
      const cancelledOrders = await tx
        .update(orders)
        .set({
          status: OrderStatus.CANCELLED,
          updatedAt: now,
        })
        .where(
          and(
            eq(orders.eventId, eventId),
            eq(orders.status, OrderStatus.PENDING),
          ),
        )
        .returning({ id: orders.id });

      // 3. Giải phóng toàn bộ ghế đang bị giữ (HELD -> AVAILABLE)
      const releasedSeats = await tx
        .update(seats)
        .set({
          status: SeatStatus.AVAILABLE,
          holdOrderId: null,
          holdExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(eq(seats.eventId, eventId), eq(seats.status, SeatStatus.HELD)),
        )
        .returning({ id: seats.id });

      // 4. Lấy số lượng giữ GA trước khi reset về 0
      const [gaStandingStats] = await tx
        .select({
          totalHeld: sql<number>`COALESCE(SUM(${ticketTypes.heldCount}), 0)::int`,
        })
        .from(ticketTypes)
        .where(
          and(
            eq(ticketTypes.eventId, eventId),
            eq(ticketTypes.isSeated, false),
          ),
        );

      const releasedHeldStandingCount = gaStandingStats?.totalHeld ?? 0;

      await tx
        .update(ticketTypes)
        .set({
          heldCount: 0,
          updatedAt: now,
        })
        .where(eq(ticketTypes.eventId, eventId));

      const cancelledPendingOrdersCount = cancelledOrders.length;
      const releasedHeldSeatsCount = releasedSeats.length;
      const totalReleasedHoldsCount =
        releasedHeldSeatsCount + releasedHeldStandingCount;

      // 5. Ghi Audit Log bất biến
      await tx.insert(auditLog).values({
        actorId: adminId,
        actorRole: UserRole.ADMIN,
        action: "EVENT_KILL_SWITCH_ACTIVATED",
        targetType: "EVENT",
        targetId: eventId,
        changes: {
          oldStatus: EventStatus.PUBLISHED,
          newStatus: EventStatus.SUSPENDED,
          reason: dto.reason,
          cancelledPendingOrdersCount,
          releasedHeldSeatsCount,
          releasedHeldStandingCount,
          totalReleasedHoldsCount,
          suspendedAt: now.toISOString(),
        },
        ipAddress: meta?.ipAddress ?? null,
        userAgent: meta?.userAgent ?? null,
      });

      // 6. Ghi Outbox
      await tx.insert(outbox).values({
        eventType: "EVENT_SUSPENDED",
        payload: {
          eventId,
          reason: dto.reason,
          cancelledPendingOrdersCount,
          releasedHeldSeatsCount,
          releasedHeldStandingCount,
          suspendedAt: now.toISOString(),
        },
        status: OutboxStatus.PENDING,
      });

      return {
        eventId: updated.id,
        status: updated.status,
        rejectionReason: updated.rejectionReason || dto.reason,
        version: updated.version,
        cancelledPendingOrdersCount,
        releasedHeldSeatsCount,
        releasedHeldStandingCount,
        totalReleasedHoldsCount,
        suspendedAt: now.toISOString(),
      };
    });

    // 7. Xóa cache Redis
    await this.eventReadCacheService?.invalidate(eventId);

    return result;
  }

  /**
   * Khôi phục sự kiện bị đình chỉ trở lại mở bán (PUBLISHED)
   */
  async resumeEvent(
    eventId: string,
    adminId: string,
    dto: EventResumeRequest,
    meta?: AuditRequestMeta,
  ): Promise<EventResumeData> {
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: events.id,
          status: events.status,
          version: events.version,
          endTime: events.endTime,
        })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1);

      if (!existing) {
        throw new NotFoundException("EVENT_NOT_FOUND: Không tìm thấy sự kiện");
      }

      if (existing.status !== EventStatus.SUSPENDED) {
        throw new BadRequestException(
          "EVENT_NOT_SUSPENDED: Chỉ có thể khôi phục sự kiện đang ở trạng thái đình chỉ",
        );
      }

      const now = new Date();
      if (existing.endTime && new Date(existing.endTime) <= now) {
        throw new BadRequestException(
          "EVENT_ALREADY_ENDED: Không thể khôi phục sự kiện đã kết thúc",
        );
      }

      const expectedVersion = dto.version ?? existing.version;
      if (dto.version !== undefined && dto.version !== existing.version) {
        throw new ConflictException(
          "CONCURRENT_MODIFICATION: Phiên bản sự kiện không khớp (optimistic lock)",
        );
      }

      const [updated] = await tx
        .update(events)
        .set({
          status: EventStatus.PUBLISHED,
          rejectionReason: null,
          version: expectedVersion + 1,
          updatedAt: now,
        })
        .where(and(eq(events.id, eventId), eq(events.version, expectedVersion)))
        .returning();

      if (!updated) {
        throw new ConflictException(
          "CONCURRENT_MODIFICATION: Không thể cập nhật sự kiện do xung đột đồng thời",
        );
      }

      // Audit log
      await tx.insert(auditLog).values({
        actorId: adminId,
        actorRole: UserRole.ADMIN,
        action: "EVENT_RESUMED",
        targetType: "EVENT",
        targetId: eventId,
        changes: {
          oldStatus: EventStatus.SUSPENDED,
          newStatus: EventStatus.PUBLISHED,
          reason: dto.reason ?? null,
          resumedAt: now.toISOString(),
        },
        ipAddress: meta?.ipAddress ?? null,
        userAgent: meta?.userAgent ?? null,
      });

      // Outbox
      await tx.insert(outbox).values({
        eventType: "EVENT_RESUMED",
        payload: {
          eventId,
          reason: dto.reason ?? null,
          resumedAt: now.toISOString(),
        },
        status: OutboxStatus.PENDING,
      });

      return {
        eventId: updated.id,
        status: updated.status,
        version: updated.version,
        resumedAt: now.toISOString(),
      };
    });

    // Xóa cache Redis
    await this.eventReadCacheService?.invalidate(eventId);

    return result;
  }

  /**
   * Truy vấn nhật ký kiểm toán bất biến theo sự kiện có phân trang
   */
  async getEventAuditLogs(
    eventId: string,
    query: AuditLogQuery,
  ): Promise<AuditLogListData> {
    const [existing] = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (!existing) {
      throw new NotFoundException("EVENT_NOT_FOUND: Không tìm thấy sự kiện");
    }

    const conditions = [
      eq(auditLog.targetId, eventId),
      eq(auditLog.targetType, "EVENT"),
    ];

    if (query.action) {
      conditions.push(eq(auditLog.action, query.action));
    }

    const [totalResult] = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(auditLog)
      .where(and(...conditions));

    const total = totalResult?.count ?? 0;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const rawItems = await db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);

    const items = rawItems.map((log) => ({
      id: log.id,
      actorId: log.actorId,
      actorRole: log.actorRole,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      changes: (log.changes as Record<string, unknown>) ?? null,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt.toISOString(),
    }));

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
