import {
  EventStatus,
  UserRole,
  type EventControlQuery,
} from "@tickethub/shared";
import {
  assertCanResume,
  assertCanSuspend,
  assertEventReviewable,
  decideEvent,
  expectedVersionOf,
  totalReleasedHolds,
} from "../domain/moderation-rules";
import { moderationErrors } from "../domain/moderation.errors";
import type {
  AuditRequestMeta,
  EventKillSwitchData,
  EventKillSwitchRequest,
  EventResumeData,
  EventResumeRequest,
  ReviewDto,
} from "../domain/moderation.models";
import type {
  EventCacheInvalidator,
  ModerationQueryPort,
  ModerationUnitOfWork,
} from "../domain/moderation.ports";

/**
 * Lop 2: phe duyet su kien mo ban, cong tac ngat khan cap (Kill Switch) va khoi
 * phuc su kien. Moi thay doi trang thai ghi audit log bat bien va outbox.
 */
export class EventModerationService {
  constructor(
    private readonly query: ModerationQueryPort,
    private readonly unitOfWork: ModerationUnitOfWork,
    private readonly cache?: EventCacheInvalidator,
  ) {}

  getPendingEvents() {
    return this.query.listPendingEvents();
  }

  getEventControls(query: EventControlQuery) {
    return this.query.listEventControls(query);
  }

  reviewEvent(
    eventId: string,
    adminId: string,
    dto: ReviewDto,
    meta?: AuditRequestMeta,
  ) {
    const outcome = decideEvent(dto);

    return this.unitOfWork.run(async (tx) => {
      const existing = assertEventReviewable(
        await tx.findEventForReview(eventId),
      );

      const updated = await tx.updateEventIfPending({
        eventId,
        expectedVersion: expectedVersionOf(dto.version, existing.version),
        newStatus: outcome.newStatus,
        rejectionReason: outcome.rejectionReason,
      });
      if (!updated) throw moderationErrors.eventReviewConcurrent();

      const owner = await tx.findOrganizerOwnerContact(updated.organizerId);
      if (!owner || !owner.email) throw moderationErrors.ownerAccountNotFound();

      await tx.writeAudit({
        actorId: adminId,
        actorRole: UserRole.ADMIN,
        action: outcome.action,
        targetType: "EVENT",
        targetId: updated.id,
        changes: {
          oldStatus: EventStatus.PENDING_APPROVAL,
          newStatus: outcome.newStatus,
          reason: dto.reason ?? null,
        },
        meta,
      });

      await tx.enqueueOutbox(outcome.action, {
        eventId: updated.id,
        organizerId: updated.organizerId,
        userId: owner.userId,
        email: owner.email,
        eventTitle: updated.title,
        decision: dto.decision,
        reason: dto.reason ?? null,
      });

      return updated;
    });
  }

  /**
   * Ngat khan cap: chuyen SUSPENDED, huy don PENDING, giai phong ghe HELD,
   * dua held_count ve khu dung ve 0, ghi audit log va outbox nguyen tu, roi xoa cache.
   */
  async activateKillSwitch(
    eventId: string,
    adminId: string,
    dto: EventKillSwitchRequest,
    meta?: AuditRequestMeta,
  ): Promise<EventKillSwitchData> {
    const result = await this.unitOfWork.run(async (tx) => {
      const existing = assertCanSuspend(
        await tx.findEventForSuspension(eventId),
        dto.version,
      );
      const now = new Date();

      const updated = await tx.suspendEventIfVersion({
        eventId,
        expectedVersion: expectedVersionOf(dto.version, existing.version),
        reason: dto.reason,
        now,
      });
      if (!updated) throw moderationErrors.updateConflict();

      const cascade = {
        cancelledPendingOrdersCount: await tx.cancelPendingOrders(eventId, now),
        releasedHeldSeatsCount: await tx.releaseHeldSeats(eventId, now),
        releasedHeldStandingCount: await tx.releaseStandingHolds(eventId, now),
      };
      const totalReleasedHoldsCount = totalReleasedHolds(cascade);

      await tx.writeAudit({
        actorId: adminId,
        actorRole: UserRole.ADMIN,
        action: "EVENT_KILL_SWITCH_ACTIVATED",
        targetType: "EVENT",
        targetId: eventId,
        changes: {
          oldStatus: EventStatus.PUBLISHED,
          newStatus: EventStatus.SUSPENDED,
          reason: dto.reason,
          ...cascade,
          totalReleasedHoldsCount,
          suspendedAt: now.toISOString(),
        },
        meta,
      });

      await tx.enqueueOutbox("EVENT_SUSPENDED", {
        eventId,
        reason: dto.reason,
        ...cascade,
        suspendedAt: now.toISOString(),
      });

      return {
        eventId: updated.id,
        status: updated.status,
        rejectionReason: updated.rejectionReason || dto.reason,
        version: updated.version,
        ...cascade,
        totalReleasedHoldsCount,
        suspendedAt: now.toISOString(),
      } as EventKillSwitchData;
    });

    await this.cache?.invalidate(eventId);
    return result;
  }

  async resumeEvent(
    eventId: string,
    adminId: string,
    dto: EventResumeRequest,
    meta?: AuditRequestMeta,
  ): Promise<EventResumeData> {
    const result = await this.unitOfWork.run(async (tx) => {
      const now = new Date();
      const existing = assertCanResume(
        await tx.findEventForSuspension(eventId),
        dto.version,
        now,
      );

      const updated = await tx.resumeEventIfVersion({
        eventId,
        expectedVersion: expectedVersionOf(dto.version, existing.version),
        now,
      });
      if (!updated) throw moderationErrors.updateConflict();

      await tx.writeAudit({
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
        meta,
      });

      await tx.enqueueOutbox("EVENT_RESUMED", {
        eventId,
        reason: dto.reason ?? null,
        resumedAt: now.toISOString(),
      });

      return {
        eventId: updated.id,
        status: updated.status,
        version: updated.version,
        resumedAt: now.toISOString(),
      } as EventResumeData;
    });

    await this.cache?.invalidate(eventId);
    return result;
  }
}
