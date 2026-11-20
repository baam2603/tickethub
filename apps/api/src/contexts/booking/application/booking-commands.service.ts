import type {
  AllocatedSeatItem,
  BookingTicketType,
  CandidateSeat,
  HoldItem,
  HoldResult,
  HoldSeatsRequest,
  OrderItemDraft,
} from "../domain/booking.models";
import {
  HOLD_DURATION_MS,
  HOLD_DURATION_SECONDS,
  assertEventOnSale,
  assertExplicitSeatsMatch,
  assertNoDuplicateSeats,
  assertReleasable,
  assertStandingAvailable,
  assertTicketTypesExist,
  assertWithinTicketLimit,
  classifyItems,
  generateOrderCode,
  quantityOf,
  seatedLine,
  standingLine,
} from "../domain/booking-rules";
import { bookingErrors } from "../domain/booking.errors";
import {
  findContiguousSeats,
  sortAllocatedSeats,
} from "../domain/seat-allocation";
import type {
  BookingReader,
  BookingTransaction,
  BookingUnitOfWork,
  InventoryNotifier,
} from "../domain/booking.ports";

/** Ket qua tich luy trong mot lan giu cho (nam trong transaction). */
class HoldDraft {
  readonly heldSeatIds: string[] = [];
  readonly heldSeatIdSet = new Set<string>();
  readonly allocated: AllocatedSeatItem[] = [];
  readonly lines: OrderItemDraft[] = [];
  totalAmount = 0;

  addSeat(seat: CandidateSeat, price: number): void {
    this.heldSeatIds.push(seat.id);
    this.heldSeatIdSet.add(seat.id);
    this.allocated.push({
      id: seat.id,
      zoneName: seat.zoneName,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
    });
    this.totalAmount += price;
    this.lines.push(seatedLine(seat.ticketTypeId, seat.id, price));
  }
}

/**
 * Lenh cua nguoi mua: giu cho (tu dong phan bo ghe lien ke hoac khu dung),
 * huy giu cho va thu hoi don het han.
 */
export class BookingCommands {
  constructor(
    private readonly reader: BookingReader,
    private readonly unitOfWork: BookingUnitOfWork,
    private readonly notifier: InventoryNotifier,
  ) {}

  async holdSeats(userId: string, dto: HoldSeatsRequest): Promise<HoldResult> {
    assertEventOnSale(await this.reader.findEvent(dto.eventId));
    assertWithinTicketLimit(dto.items);

    const typeIds = Array.from(new Set(dto.items.map((i) => i.ticketTypeId)));
    const typeRows = await this.reader.findTicketTypes(dto.eventId, typeIds);
    const types = new Map(typeRows.map((tt) => [tt.id, tt]));
    assertTicketTypesExist(dto.items, types);

    const { explicitSeated, autoSeated, standing } = classifyItems(
      dto.items,
      types,
    );
    const explicitSeatIds = explicitSeated.map((i) => i.seatId!);
    assertNoDuplicateSeats(explicitSeatIds);
    const sortedExplicitSeatIds = [...explicitSeatIds].sort();

    const result = await this.unitOfWork.run(async (tx) => {
      assertEventOnSale(await tx.lockEventForBooking(dto.eventId));
      const now = new Date();
      const expiresAt = new Date(now.getTime() + HOLD_DURATION_MS);
      const draft = new HoldDraft();

      if (sortedExplicitSeatIds.length > 0) {
        await this.holdExplicitSeats(
          tx,
          dto.eventId,
          explicitSeated,
          sortedExplicitSeatIds,
          types,
          draft,
          now,
          expiresAt,
        );
      }
      for (const item of autoSeated) {
        await this.holdAutoSeats(
          tx,
          dto.eventId,
          item,
          types,
          draft,
          now,
          expiresAt,
        );
      }
      for (const item of standing) {
        await this.holdStanding(tx, dto.eventId, item, types, draft, now);
      }

      const order = await tx.insertPendingOrder({
        orderCode: generateOrderCode(now),
        userId,
        eventId: dto.eventId,
        totalAmount: draft.totalAmount.toFixed(2),
        expiresAt,
      });

      if (draft.heldSeatIds.length > 0) {
        await tx.assignHoldOrder(draft.heldSeatIds, order.id);
      }
      await tx.insertOrderItems(order.id, draft.lines);

      const allocatedSeats = sortAllocatedSeats(draft.allocated);
      await tx.enqueueOutbox("ORDER_HOLD_CREATED", {
        orderId: order.id,
        orderCode: order.orderCode,
        userId,
        eventId: dto.eventId,
        heldSeats: draft.heldSeatIds,
        allocatedSeats,
        totalAmount: draft.totalAmount,
        expiresAt: expiresAt.toISOString(),
      });

      return {
        orderId: order.id,
        orderCode: order.orderCode,
        heldSeats: draft.heldSeatIds,
        allocatedSeats,
        totalAmount: draft.totalAmount,
        holdExpiresAt: expiresAt.toISOString(),
        remainingSeconds: HOLD_DURATION_SECONDS,
      } satisfies HoldResult;
    });

    // Chi xoa cache va phat SSE sau khi PostgreSQL commit thanh cong
    await this.notifier.invalidateEvent(dto.eventId);
    if (result.heldSeats.length > 0) {
      await this.notifier.seatsChanged(
        dto.eventId,
        result.heldSeats,
        "HELD",
        result.holdExpiresAt,
      );
    }
    return result;
  }

  async releaseHold(userId: string, orderId: string) {
    const order = await this.reader.findPendingOrderForRelease(orderId, userId);
    assertReleasable(order);
    const pending = order!;

    const result = await this.unitOfWork.run(async (tx) => {
      if (!(await tx.cancelPendingOrder(orderId, userId))) {
        throw bookingErrors.orderStatusChanged();
      }
      await tx.releaseSeatsOfOrder(orderId, new Date());

      for (const item of pending.items) {
        if (!item.seatId) {
          await tx.decrementHeldCount(
            item.ticketTypeId,
            item.quantity,
            new Date(),
          );
        }
      }

      await tx.enqueueOutbox("ORDER_HOLD_RELEASED", {
        orderId,
        userId,
        releasedAt: new Date().toISOString(),
      });
      return { message: "Đã giải phóng ghế thành công" };
    });

    await this.notifier.invalidateEvent(pending.eventId);
    const seatIds = pending.items
      .map((item) => item.seatId)
      .filter((id): id is string => id !== null && id !== undefined);
    if (seatIds.length > 0) {
      await this.notifier.seatsChanged(
        pending.eventId,
        seatIds,
        "AVAILABLE",
        null,
      );
    }
    return result;
  }

  /** Quet thu hoi don PENDING het han va ghe HELD qua han. */
  async cleanExpiredOrders(): Promise<{ expiredOrdersCount: number }> {
    const sweep = await this.unitOfWork.run((tx) =>
      tx.sweepExpired(new Date()),
    );

    await Promise.all(
      sweep.affectedEventIds.map((id) => this.notifier.invalidateEvent(id)),
    );

    const seatsByEvent = new Map<string, string[]>();
    for (const s of sweep.releasedSeatRecords) {
      const list = seatsByEvent.get(s.eventId) ?? [];
      list.push(s.id);
      seatsByEvent.set(s.eventId, list);
    }
    for (const [eventId, seatIds] of seatsByEvent) {
      await this.notifier.seatsChanged(eventId, seatIds, "AVAILABLE", null);
    }

    return { expiredOrdersCount: sweep.expiredOrdersCount };
  }

  // Ghe chi dinh: tuong thich nguoc, frontend khong duoc gui seatId.
  private async holdExplicitSeats(
    tx: BookingTransaction,
    eventId: string,
    items: HoldItem[],
    sortedSeatIds: string[],
    types: Map<string, BookingTicketType>,
    draft: HoldDraft,
    now: Date,
    expiresAt: Date,
  ) {
    const locked = await tx.lockSeatsById(eventId, sortedSeatIds);
    if (locked.length < sortedSeatIds.length)
      throw bookingErrors.seatNotFound();

    assertExplicitSeatsMatch(
      items,
      new Map(locked.map((s) => [s.id, s.ticketTypeId])),
    );

    const updated = await tx.holdAvailableSeats(
      eventId,
      sortedSeatIds,
      now,
      expiresAt,
    );
    if (updated.length < sortedSeatIds.length) {
      throw bookingErrors.seatAlreadyHeld();
    }

    for (const seat of locked) {
      draft.addSeat(seat, Number(types.get(seat.ticketTypeId)!.price));
    }
  }

  /**
   * Tu dong phan bo: chon ghe lien ke, khoa bang SKIP LOCKED roi chon lai tu
   * cac ghe con lai neu bi giao dich khac chiem. Moi vong that bai loai them it
   * nhat 1 ghe nen vong lap luon ket thuc (du ghe hoac INSUFFICIENT_TICKET_CAPACITY).
   */
  private async holdAutoSeats(
    tx: BookingTransaction,
    eventId: string,
    item: HoldItem,
    types: Map<string, BookingTicketType>,
    draft: HoldDraft,
    now: Date,
    expiresAt: Date,
  ) {
    const qty = quantityOf(item);
    const unavailable = new Set<string>();
    let chosen: CandidateSeat[];

    for (;;) {
      const candidates = await tx.listAvailableSeats(
        eventId,
        item.ticketTypeId,
        now,
      );
      const available = candidates.filter(
        (s) => !draft.heldSeatIdSet.has(s.id) && !unavailable.has(s.id),
      );

      const picked = findContiguousSeats(available, qty);
      if (picked.length < qty) throw bookingErrors.insufficientSeats();

      const pickedIds = picked.map((s) => s.id).sort();
      const locked = await tx.lockAvailableSeatsSkipLocked(
        eventId,
        pickedIds,
        now,
      );
      if (locked.length === pickedIds.length) {
        chosen = locked;
        break;
      }

      const lockedIds = new Set(locked.map((s) => s.id));
      for (const id of pickedIds) {
        if (!lockedIds.has(id)) unavailable.add(id);
      }
    }

    await tx.markSeatsHeld(chosen.map((s) => s.id).sort(), now, expiresAt);

    const price = Number(types.get(item.ticketTypeId)!.price);
    for (const seat of chosen) draft.addSeat(seat, price);
  }

  private async holdStanding(
    tx: BookingTransaction,
    eventId: string,
    item: HoldItem,
    types: Map<string, BookingTicketType>,
    draft: HoldDraft,
    now: Date,
  ) {
    const qty = quantityOf(item);
    assertStandingAvailable(
      await tx.lockStandingTicketType(eventId, item.ticketTypeId),
      qty,
    );
    await tx.incrementHeldCount(item.ticketTypeId, qty, now);

    const price = Number(types.get(item.ticketTypeId)!.price);
    draft.totalAmount += price * qty;
    draft.lines.push(standingLine(item.ticketTypeId, qty, price));
  }
}
