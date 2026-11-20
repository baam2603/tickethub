import {
  TicketingDomainError,
  ticketingErrors,
} from "../domain/ticketing.errors";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import {
  EventStatus,
  TicketStatus,
  UserRole,
  type GateScanResponse,
} from "@tickethub/shared";
import { db } from "../../../database/db";
import {
  auditLog,
  gateCheckinLogs,
  eventStaff,
  events,
  gates,
  orders,
  seats,
  ticketTypes,
  tickets,
  users,
} from "../../../database/schema";
import type {
  MyTicketsPage,
  MyTicketsQuery,
  QrTicketRecord,
} from "../domain/ticketing.models";
import type {
  GateRepository,
  GateCheckInInput,
  MyTicketsReader,
  TicketQrReader,
} from "../domain/ticketing.ports";

export class DrizzleTicketQrReader implements TicketQrReader {
  async findForQr(ticketId: string): Promise<QrTicketRecord | null> {
    const [ticket] = await db
      .select({
        id: tickets.id,
        userId: tickets.userId,
        orderId: tickets.orderId,
        eventId: tickets.eventId,
        status: tickets.status,
        eventStatus: events.status,
      })
      .from(tickets)
      .innerJoin(events, eq(tickets.eventId, events.id))
      .where(eq(tickets.id, ticketId))
      .limit(1);
    return ticket ?? null;
  }
}

function alreadyCheckedIn(
  ticket: Pick<
    typeof tickets.$inferSelect,
    "checkedInAt" | "gateId" | "checkedInBy"
  >,
) {
  return new TicketingDomainError(
    "CONFLICT",
    "TICKET_ALREADY_USED",
    "TICKET_ALREADY_USED: Vé đã được soát",
    {
      checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
      gateId: ticket.gateId,
      staffId: ticket.checkedInBy,
    },
  );
}

export class DrizzleGateRepository implements GateRepository {
  async recordInvalidQr(staffUserId: string) {
    const actor = await db.query.users.findFirst({
      columns: { fullName: true },
      where: eq(users.id, staffUserId),
    });
    await db.insert(gateCheckinLogs).values({
      staffId: staffUserId,
      staffName: actor?.fullName ?? null,
      method: "QR",
      outcome: "REJECTED",
      errorCode: "INVALID_QR",
    });
  }

  async checkIn(
    staffUserId: string,
    staffRole: string,
    input: GateCheckInInput,
  ): Promise<GateScanResponse> {
    const method = input.manual ? "MANUAL" : "QR";
    let resolvedGate: string | null = null;
    let loggedEvent: string | null = null;
    let foundTicket: string | null = null;
    let staffName: string | null = null;
    try {
      return await db.transaction(async (tx) => {
        const [actor] = await tx
          .select()
          .from(users)
          .where(eq(users.id, staffUserId))
          .for("share");
        staffName = actor?.fullName ?? null;
        if (
          !actor ||
          actor.status !== "ACTIVE" ||
          actor.role !== staffRole ||
          ![UserRole.GATE_STAFF, UserRole.ADMIN].some((r) => r === actor.role)
        )
          throw new TicketingDomainError(
            "FORBIDDEN",
            "STAFF_INACTIVE",
            "STAFF_INACTIVE",
          );
        let assignedGate: string | null = null;
        if (staffRole !== UserRole.ADMIN) {
          const [assignment] = await tx
            .select()
            .from(eventStaff)
            .where(
              and(
                eq(eventStaff.eventId, input.eventId),
                eq(eventStaff.userId, staffUserId),
              ),
            )
            .for("share");
          if (!assignment)
            throw new TicketingDomainError(
              "FORBIDDEN",
              "STAFF_NOT_ASSIGNED_TO_EVENT",
              "STAFF_NOT_ASSIGNED_TO_EVENT",
            );
          assignedGate = assignment.gateId;
          if (assignedGate && input.gateId && input.gateId !== assignedGate)
            throw new TicketingDomainError(
              "FORBIDDEN",
              "STAFF_NOT_ASSIGNED_TO_GATE",
              "STAFF_NOT_ASSIGNED_TO_GATE",
            );
        }
        const [event] = await tx
          .select()
          .from(events)
          .where(eq(events.id, input.eventId))
          .for("share");
        loggedEvent = event?.id ?? null;
        if (!event || event.status !== EventStatus.PUBLISHED)
          throw new TicketingDomainError(
            "BAD_REQUEST",
            "EVENT_NOT_ACTIVE",
            "EVENT_NOT_ACTIVE",
          );
        resolvedGate = input.gateId ?? assignedGate;
        if (resolvedGate) {
          const gate = await tx.query.gates.findFirst({
            where: and(
              eq(gates.id, resolvedGate),
              eq(gates.eventId, input.eventId),
            ),
          });
          if (!gate) {
            resolvedGate = null;
            throw new TicketingDomainError(
              "BAD_REQUEST",
              "INVALID_GATE_ID",
              "INVALID_GATE_ID",
            );
          }
        }
        const now = new Date();
        if (now < event.gateOpeningTime || now > event.endTime) {
          throw new TicketingDomainError(
            "BAD_REQUEST",
            "CHECKIN_OUTSIDE_EVENT_WINDOW",
            "CHECKIN_OUTSIDE_EVENT_WINDOW",
          );
        }
        const [info] = await tx
          .select({
            ticket: tickets,
            buyer: users,
            type: ticketTypes,
            seat: seats,
          })
          .from(tickets)
          .innerJoin(users, eq(users.id, tickets.userId))
          .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
          .leftJoin(seats, eq(seats.id, tickets.seatId))
          .where(
            and(
              eq(tickets.eventId, input.eventId),
              input.manual
                ? eq(tickets.ticketCode, input.manual.ticketCode)
                : eq(tickets.id, input.qr!.sub),
            ),
          )
          .limit(1);
        if (!info)
          throw new TicketingDomainError(
            "NOT_FOUND",
            "TICKET_NOT_FOUND",
            "TICKET_NOT_FOUND",
          );
        foundTicket = info.ticket.id;
        if (
          input.qr &&
          (info.ticket.orderId !== input.qr.orderId ||
            info.ticket.userId !== input.qr.userId)
        )
          throw new TicketingDomainError(
            "BAD_REQUEST",
            "QR_TICKET_MISMATCH",
            "QR_TICKET_MISMATCH",
          );
        if (input.manual) {
          const last4 = input.manual.phoneOrEmailLast4?.trim();
          const phoneMatch = Boolean(
            last4 &&
            /^\d{4}$/.test(last4) &&
            info.buyer.phone?.replace(/\D/g, "").slice(-4) === last4,
          );
          const emailMatch = Boolean(
            input.manual.email &&
            info.buyer.email.toLowerCase() ===
              input.manual.email.trim().toLowerCase(),
          );
          const emailSuffixMatch = Boolean(
            last4 &&
            /^[a-z0-9]{4}$/i.test(last4) &&
            info.buyer.email.split("@")[0]?.toLowerCase().slice(-4) ===
              last4.toLowerCase(),
          );
          if (!phoneMatch && !emailMatch && !emailSuffixMatch)
            throw new TicketingDomainError(
              "BAD_REQUEST",
              "VERIFICATION_FAILED",
              "VERIFICATION_FAILED",
            );
        }
        if (info.ticket.status === TicketStatus.CHECKED_IN)
          throw alreadyCheckedIn(info.ticket);
        if (info.ticket.status !== TicketStatus.SOLD)
          throw input.manual
            ? ticketingErrors.notEligible(info.ticket.status)
            : ticketingErrors.notActive(info.ticket.status);
        if (!resolvedGate)
          throw new TicketingDomainError(
            "BAD_REQUEST",
            "GATE_REQUIRED",
            "GATE_REQUIRED",
          );
        const [updated] = await tx
          .update(tickets)
          .set({
            status: TicketStatus.CHECKED_IN,
            checkedInAt: now,
            checkedInBy: staffUserId,
            gateId: resolvedGate,
            updatedAt: now,
          })
          .where(
            and(
              eq(tickets.id, info.ticket.id),
              eq(tickets.eventId, input.eventId),
              eq(tickets.status, TicketStatus.SOLD),
            ),
          )
          .returning();
        if (!updated) {
          const latest = await tx.query.tickets.findFirst({
            columns: {
              status: true,
              checkedInAt: true,
              gateId: true,
              checkedInBy: true,
            },
            where: eq(tickets.id, info.ticket.id),
          });
          if (latest?.status === TicketStatus.CHECKED_IN)
            throw alreadyCheckedIn(latest);
          throw input.manual
            ? ticketingErrors.notEligible(latest?.status ?? "UNKNOWN")
            : ticketingErrors.notActive(latest?.status ?? "UNKNOWN");
        }
        const reason = input.manual?.reason ?? null;
        await tx.insert(gateCheckinLogs).values({
          eventId: input.eventId,
          ticketId: updated.id,
          gateId: resolvedGate,
          staffId: staffUserId,
          staffName,
          method,
          outcome: "SUCCESS",
          reason,
          checkedInAt: now,
        });
        await tx.insert(auditLog).values({
          actorId: staffUserId,
          actorRole: staffRole,
          action: input.manual
            ? "MANUAL_TICKET_CHECK_IN"
            : "QR_TICKET_CHECK_IN",
          targetType: "TICKET",
          targetId: updated.id,
          changes: {
            eventId: input.eventId,
            gateId: resolvedGate,
            staffId: staffUserId,
            staffName,
            reason,
            checkedInAt: now.toISOString(),
            method,
          },
        });
        return {
          ticketId: updated.id,
          ticketCode: updated.ticketCode,
          status: updated.status,
          eventTitle: event.title,
          ticketTypeName: info.type.name,
          zoneName: info.seat?.zoneName ?? undefined,
          seatLabel:
            info.type.isSeated && info.seat
              ? `Hàng ${info.seat.rowLabel} - Ghế ${info.seat.seatNumber}`
              : "GA - Fanzone (Vé đứng)",
          isSeated: info.type.isSeated,
          buyerName: info.buyer.fullName,
          checkedInAt: now.toISOString(),
          gateId: resolvedGate,
          staffId: staffUserId,
        };
      });
    } catch (error) {
      const message =
        error instanceof TicketingDomainError ? error.code : "CHECKIN_FAILED";
      await db.insert(gateCheckinLogs).values({
        eventId: loggedEvent,
        ticketId: foundTicket,
        gateId: resolvedGate,
        staffId: staffUserId,
        staffName,
        method,
        outcome: "REJECTED",
        reason: input.manual?.reason ?? null,
        errorCode: message.split(":")[0]!.slice(0, 100),
      });
      throw error;
    }
  }
}

export class DrizzleMyTicketsReader implements MyTicketsReader {
  async list(userId: string, query: MyTicketsQuery): Promise<MyTicketsPage> {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const conditions = [eq(tickets.userId, userId)];
    if (query.eventId) conditions.push(eq(tickets.eventId, query.eventId));
    if (query.status) {
      conditions.push(eq(tickets.status, query.status));
    } else {
      conditions.push(
        inArray(tickets.status, [TicketStatus.SOLD, TicketStatus.CHECKED_IN]),
      );
    }
    const where = and(...conditions);

    const countResult = await db
      .select({ value: count() })
      .from(tickets)
      .where(where);
    const total = countResult[0]?.value ? Number(countResult[0].value) : 0;

    const rows = await db
      .select({
        ticketId: tickets.id,
        ticketCode: tickets.ticketCode,
        ticketStatus: tickets.status,
        checkedInAt: tickets.checkedInAt,
        orderId: orders.id,
        orderCode: orders.orderCode,
        orderTotalAmount: orders.totalAmount,
        orderFinalAmount: orders.finalAmount,
        eventId: events.id,
        eventTitle: events.title,
        eventBannerUrl: events.bannerUrl,
        eventStartTime: events.startTime,
        eventEndTime: events.endTime,
        eventVenueName: events.venueName,
        eventCity: events.city,
        eventStatus: events.status,
        ticketTypeId: ticketTypes.id,
        ticketTypeName: ticketTypes.name,
        ticketTypePrice: ticketTypes.price,
        isSeated: ticketTypes.isSeated,
        seatId: seats.id,
        seatZoneName: seats.zoneName,
        seatRowLabel: seats.rowLabel,
        seatNumber: seats.seatNumber,
      })
      .from(tickets)
      .innerJoin(events, eq(tickets.eventId, events.id))
      .innerJoin(orders, eq(tickets.orderId, orders.id))
      .innerJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
      .leftJoin(seats, eq(tickets.seatId, seats.id))
      .where(where)
      .orderBy(asc(events.startTime), asc(tickets.id))
      .limit(limit)
      .offset((page - 1) * limit);

    return { total, rows };
  }
}
