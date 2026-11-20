import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  EventStatus,
  OrderStatus,
  OrganizerStatus,
  OutboxStatus,
  SeatStatus,
  type EventControlQuery,
} from "@tickethub/shared";
import { db } from "../../../database/db";
import {
  auditLog,
  events,
  orders,
  organizerProfiles,
  outbox,
  seats,
  ticketTypes,
  users,
} from "../../../database/schema";
import type {
  AuditEntry,
  AuditLogListData,
  AuditLogQuery,
  EventForReview,
  EventForSuspension,
  OrganizerForReview,
  OwnerContact,
  UpdatedEvent,
  UpdatedOrganizer,
} from "../domain/moderation.models";
import type {
  ModerationQueryPort,
  ModerationTransaction,
  ModerationUnitOfWork,
} from "../domain/moderation.ports";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class DrizzleModerationTransaction implements ModerationTransaction {
  constructor(private readonly tx: DbTx) {}

  async findOrganizer(profileId: string): Promise<OrganizerForReview | null> {
    const [row] = await this.tx
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
    return row ?? null;
  }

  async updateOrganizerIfPending(input: {
    profileId: string;
    expectedVersion: number;
    newStatus: string;
    rejectionReason: string | null;
    verifiedBy: string | null;
    verifiedAt: Date | null;
  }): Promise<UpdatedOrganizer | null> {
    const [updated] = await this.tx
      .update(organizerProfiles)
      .set({
        status: input.newStatus as OrganizerStatus,
        rejectionReason: input.rejectionReason,
        verifiedBy: input.verifiedBy,
        verifiedAt: input.verifiedAt,
        version: input.expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizerProfiles.id, input.profileId),
          eq(organizerProfiles.status, OrganizerStatus.PENDING_VERIFICATION),
          eq(organizerProfiles.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated ?? null;
  }

  async findUserContact(userId: string): Promise<OwnerContact | null> {
    const [row] = await this.tx
      .select({ userId: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

  async findEventForReview(eventId: string): Promise<EventForReview | null> {
    const [row] = await this.tx
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
    return row ?? null;
  }

  async updateEventIfPending(input: {
    eventId: string;
    expectedVersion: number;
    newStatus: string;
    rejectionReason: string | null;
  }): Promise<UpdatedEvent | null> {
    const [updated] = await this.tx
      .update(events)
      .set({
        status: input.newStatus as EventStatus,
        rejectionReason: input.rejectionReason,
        version: input.expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(events.id, input.eventId),
          eq(events.status, EventStatus.PENDING_APPROVAL),
          eq(events.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated ?? null;
  }

  async findOrganizerOwnerContact(
    organizerId: string,
  ): Promise<OwnerContact | null> {
    const [row] = await this.tx
      .select({ userId: users.id, email: users.email })
      .from(organizerProfiles)
      .innerJoin(users, eq(organizerProfiles.userId, users.id))
      .where(eq(organizerProfiles.id, organizerId))
      .limit(1);
    return row ?? null;
  }

  async findEventForSuspension(
    eventId: string,
  ): Promise<EventForSuspension | null> {
    const [row] = await this.tx
      .select({
        id: events.id,
        status: events.status,
        version: events.version,
        endTime: events.endTime,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);
    return row ?? null;
  }

  async suspendEventIfVersion(input: {
    eventId: string;
    expectedVersion: number;
    reason: string;
    now: Date;
  }): Promise<UpdatedEvent | null> {
    const [updated] = await this.tx
      .update(events)
      .set({
        status: EventStatus.SUSPENDED,
        rejectionReason: input.reason,
        version: input.expectedVersion + 1,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(events.id, input.eventId),
          eq(events.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated ?? null;
  }

  async resumeEventIfVersion(input: {
    eventId: string;
    expectedVersion: number;
    now: Date;
  }): Promise<UpdatedEvent | null> {
    const [updated] = await this.tx
      .update(events)
      .set({
        status: EventStatus.PUBLISHED,
        rejectionReason: null,
        version: input.expectedVersion + 1,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(events.id, input.eventId),
          eq(events.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated ?? null;
  }

  async cancelPendingOrders(eventId: string, now: Date) {
    const rows = await this.tx
      .update(orders)
      .set({ status: OrderStatus.CANCELLED, updatedAt: now })
      .where(
        and(
          eq(orders.eventId, eventId),
          eq(orders.status, OrderStatus.PENDING),
        ),
      )
      .returning({ id: orders.id });
    return rows.length;
  }

  async releaseHeldSeats(eventId: string, now: Date) {
    const rows = await this.tx
      .update(seats)
      .set({
        status: SeatStatus.AVAILABLE,
        holdOrderId: null,
        holdExpiresAt: null,
        updatedAt: now,
      })
      .where(and(eq(seats.eventId, eventId), eq(seats.status, SeatStatus.HELD)))
      .returning({ id: seats.id });
    return rows.length;
  }

  async releaseStandingHolds(eventId: string, now: Date) {
    const [stats] = await this.tx
      .select({
        totalHeld: sql<number>`COALESCE(SUM(${ticketTypes.heldCount}), 0)::int`,
      })
      .from(ticketTypes)
      .where(
        and(eq(ticketTypes.eventId, eventId), eq(ticketTypes.isSeated, false)),
      );

    await this.tx
      .update(ticketTypes)
      .set({ heldCount: 0, updatedAt: now })
      .where(eq(ticketTypes.eventId, eventId));

    return stats?.totalHeld ?? 0;
  }

  async writeAudit(entry: AuditEntry) {
    await this.tx.insert(auditLog).values({
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      changes: entry.changes,
      ipAddress: entry.meta?.ipAddress ?? null,
      userAgent: entry.meta?.userAgent ?? null,
    });
  }

  async enqueueOutbox(eventType: string, payload: Record<string, unknown>) {
    await this.tx
      .insert(outbox)
      .values({ eventType, payload, status: OutboxStatus.PENDING });
  }
}

export class DrizzleModerationUnitOfWork implements ModerationUnitOfWork {
  run<T>(work: (tx: ModerationTransaction) => Promise<T>): Promise<T> {
    return db.transaction((tx) => work(new DrizzleModerationTransaction(tx)));
  }
}

export class DrizzleModerationQuery implements ModerationQueryPort {
  listPendingOrganizers() {
    return db
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
  }

  listPendingEvents() {
    return db
      .select({
        id: events.id,
        title: events.title,
        bannerUrl: events.bannerUrl,
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
  }

  async listEventControls({ eventId, status, page }: EventControlQuery) {
    const limit = 20;
    const statusFilter = status
      ? eq(events.status, status)
      : inArray(events.status, [EventStatus.PUBLISHED, EventStatus.SUSPENDED]);
    const rows = await db
      .select({
        id: events.id,
        title: events.title,
        bannerUrl: events.bannerUrl,
        status: events.status,
        version: events.version,
        endTime: events.endTime,
        rejectionReason: events.rejectionReason,
      })
      .from(events)
      .where(eventId ? eq(events.id, eventId) : statusFilter)
      .orderBy(desc(events.updatedAt), desc(events.id))
      .limit(limit + 1)
      .offset((page - 1) * limit);
    return {
      items: rows.slice(0, limit).map((row) => ({
        ...row,
        endTime: row.endTime.toISOString(),
      })),
      hasMore: rows.length > limit,
    };
  }

  async eventExists(eventId: string) {
    const [row] = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);
    return Boolean(row);
  }

  async listEventAuditLogs(
    eventId: string,
    query: AuditLogQuery,
  ): Promise<AuditLogListData> {
    const conditions = [
      eq(auditLog.targetId, eventId),
      eq(auditLog.targetType, "EVENT"),
    ];
    if (query.action) conditions.push(eq(auditLog.action, query.action));

    const [totalResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(and(...conditions));
    const total = totalResult?.count ?? 0;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const rawItems = await db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      items: rawItems.map((log) => ({
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
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
