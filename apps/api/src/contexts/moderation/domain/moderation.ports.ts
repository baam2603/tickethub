import type {
  EventControlListData,
  EventControlQuery,
} from "@tickethub/shared";
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
} from "./moderation.models";

/** Thao tac ghi trong mot Database Transaction duy nhat cua cac luong kiem duyet. */
export interface ModerationTransaction {
  // --- KYC ---
  findOrganizer(profileId: string): Promise<OrganizerForReview | null>;
  /** Cap nhat co dieu kien PENDING_VERIFICATION va dung version; null neu khong khop. */
  updateOrganizerIfPending(input: {
    profileId: string;
    expectedVersion: number;
    newStatus: string;
    rejectionReason: string | null;
    verifiedBy: string | null;
    verifiedAt: Date | null;
  }): Promise<UpdatedOrganizer | null>;
  findUserContact(userId: string): Promise<OwnerContact | null>;

  // --- Phe duyet su kien ---
  findEventForReview(eventId: string): Promise<EventForReview | null>;
  updateEventIfPending(input: {
    eventId: string;
    expectedVersion: number;
    newStatus: string;
    rejectionReason: string | null;
  }): Promise<UpdatedEvent | null>;
  findOrganizerOwnerContact(organizerId: string): Promise<OwnerContact | null>;

  // --- Kill Switch / khoi phuc ---
  findEventForSuspension(eventId: string): Promise<EventForSuspension | null>;
  suspendEventIfVersion(input: {
    eventId: string;
    expectedVersion: number;
    reason: string;
    now: Date;
  }): Promise<UpdatedEvent | null>;
  resumeEventIfVersion(input: {
    eventId: string;
    expectedVersion: number;
    now: Date;
  }): Promise<UpdatedEvent | null>;
  cancelPendingOrders(eventId: string, now: Date): Promise<number>;
  releaseHeldSeats(eventId: string, now: Date): Promise<number>;
  /** Tong held_count cua ve dung roi dat toan bo held_count cua su kien ve 0. */
  releaseStandingHolds(eventId: string, now: Date): Promise<number>;

  // --- Dung chung ---
  writeAudit(entry: AuditEntry): Promise<void>;
  enqueueOutbox(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
}

export interface ModerationUnitOfWork {
  run<T>(work: (tx: ModerationTransaction) => Promise<T>): Promise<T>;
}

export interface ModerationQueryPort {
  listEventControls(query: EventControlQuery): Promise<EventControlListData>;
  listPendingOrganizers(): Promise<Array<Record<string, unknown>>>;
  listPendingEvents(): Promise<Array<Record<string, unknown>>>;
  eventExists(eventId: string): Promise<boolean>;
  listEventAuditLogs(
    eventId: string,
    query: AuditLogQuery,
  ): Promise<AuditLogListData>;
}

/** Xoa cache doc cua context Event sau khi trang thai su kien thay doi. */
export interface EventCacheInvalidator {
  invalidate(eventId: string): Promise<void>;
}
