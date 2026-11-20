import type {
  BookingEventRef,
  BookingOrderView,
  BookingTicketType,
  CandidateSeat,
  ExpirySweepResult,
  LockedExplicitSeat,
  NewPendingOrder,
  OrderItemDraft,
  PendingOrderForRelease,
  StandingInventory,
} from "./booking.models";

/** Thao tac ghi trong mot Database Transaction duy nhat cua luong giu cho / huy / quet het han. */
export interface BookingTransaction {
  lockEventForBooking(eventId: string): Promise<{ status: string } | null>;
  // --- Giu cho ---
  /** Khoa ghe chi dinh theo id tang dan (FOR UPDATE). */
  lockSeatsById(
    eventId: string,
    sortedIds: string[],
  ): Promise<LockedExplicitSeat[]>;
  /** Chuyen sang HELD cac ghe con trong/het han giu; tra ve id da cap nhat. */
  holdAvailableSeats(
    eventId: string,
    ids: string[],
    now: Date,
    expiresAt: Date,
  ): Promise<string[]>;
  listAvailableSeats(
    eventId: string,
    ticketTypeId: string,
    now: Date,
  ): Promise<CandidateSeat[]>;
  /** Khoa ghe duoc chon bang FOR UPDATE SKIP LOCKED, theo id tang dan. */
  lockAvailableSeatsSkipLocked(
    eventId: string,
    ids: string[],
    now: Date,
  ): Promise<CandidateSeat[]>;
  markSeatsHeld(ids: string[], now: Date, expiresAt: Date): Promise<void>;
  lockStandingTicketType(
    eventId: string,
    ticketTypeId: string,
  ): Promise<StandingInventory | null>;
  incrementHeldCount(
    ticketTypeId: string,
    qty: number,
    now: Date,
  ): Promise<void>;
  insertPendingOrder(
    order: NewPendingOrder,
  ): Promise<{ id: string; orderCode: string }>;
  assignHoldOrder(seatIds: string[], orderId: string): Promise<void>;
  insertOrderItems(orderId: string, items: OrderItemDraft[]): Promise<void>;
  enqueueOutbox(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void>;

  // --- Huy giu cho ---
  cancelPendingOrder(orderId: string, userId: string): Promise<boolean>;
  releaseSeatsOfOrder(orderId: string, now: Date): Promise<void>;
  decrementHeldCount(
    ticketTypeId: string,
    qty: number,
    now: Date,
  ): Promise<void>;

  // --- Quet het han ---
  sweepExpired(now: Date): Promise<ExpirySweepResult>;
}

export interface BookingUnitOfWork {
  run<T>(work: (tx: BookingTransaction) => Promise<T>): Promise<T>;
}

export interface BookingReader {
  findEvent(eventId: string): Promise<BookingEventRef | null>;
  findTicketTypes(
    eventId: string,
    ticketTypeIds: string[],
  ): Promise<BookingTicketType[]>;
  findPendingOrderForRelease(
    orderId: string,
    userId: string,
  ): Promise<PendingOrderForRelease | null>;
  findOwnedOrderDetail(
    orderId: string,
    userId: string,
  ): Promise<BookingOrderView | null>;
}

/** Thong bao sau commit cho context Event (xoa cache, phat SSE trang thai ghe). */
export interface InventoryNotifier {
  invalidateEvent(eventId: string): Promise<void>;
  seatsChanged(
    eventId: string,
    seatIds: string[],
    status: "HELD" | "AVAILABLE",
    expiresAt: string | null,
  ): Promise<void>;
}
