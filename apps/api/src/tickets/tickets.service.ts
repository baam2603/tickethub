import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, inArray, count, asc } from "drizzle-orm";
import { db } from "../database/db";
import {
  auditLog,
  gateCheckinLogs,
  events,
  eventStaff,
  gates,
  orders,
  seats,
  tickets,
  ticketTypes,
  users,
} from "../database/schema";
import {
  EventStatus,
  GateLookupRequest,
  GateLookupResponse,
  GateScanRequest,
  GateScanResponse,
  GetTicketQrResponse,
  MyTicketsQuery,
  MyTicketsListResponse,
  MyTicketItem,
  TicketStatus,
  UserRole,
} from "@tickethub/shared";
import { Ed25519Service } from "./crypto/ed25519.service";
import {
  formatTicketSeatInfo,
  calculateEffectivePaidPrice,
} from "../booking/buyer-order.service";

@Injectable()
export class TicketsService {
  constructor(private readonly ed25519Service: Ed25519Service) {}

  /**
   * Lấy mã QR động ký số Ed25519 cho vé (30 giây xoay vòng)
   */
  async getTicketQr(
    userId: string,
    role: string,
    ticketId: string,
  ): Promise<GetTicketQrResponse> {
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

    if (!ticket) {
      throw new NotFoundException("TICKET_NOT_FOUND");
    }

    if (ticket.userId !== userId && role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        "ACCESS_DENIED: You do not have permission to access this ticket",
      );
    }

    if (ticket.status === TicketStatus.CHECKED_IN) {
      throw new ConflictException(
        "TICKET_ALREADY_USED: Ticket has already been used",
      );
    }

    if (ticket.status !== TicketStatus.SOLD) {
      throw new BadRequestException(
        `TICKET_NOT_ACTIVE: Ticket is not active (status: ${ticket.status})`,
      );
    }

    if (ticket.eventStatus !== EventStatus.PUBLISHED) {
      throw new BadRequestException(
        `EVENT_NOT_ACTIVE: Event is not published or is suspended (status: ${ticket.eventStatus})`,
      );
    }

    const { token, expiresAt, remainingSeconds } =
      this.ed25519Service.signDynamicQr({
        sub: ticket.id,
        eventId: ticket.eventId,
        orderId: ticket.orderId,
        userId: ticket.userId,
      });

    return {
      ticketId: ticket.id,
      qrToken: token,
      expiresAt: expiresAt.toISOString(),
      remainingSeconds,
    };
  }

  /**
   * Quét và soát vé nguyên tử tại cổng bằng mã QR động
   */
  async scanTicket(
    staffUserId: string,
    staffRole: string,
    dto: GateScanRequest,
  ): Promise<GateScanResponse> {
    let payload: ReturnType<Ed25519Service["verifyDynamicQr"]>;
    try {
      payload = this.ed25519Service.verifyDynamicQr(dto.qrToken);
    } catch (error) {
      await db.insert(gateCheckinLogs).values({
        staffId: staffUserId,
        method: "QR",
        outcome: "REJECTED",
        errorCode: "INVALID_QR",
      });
      throw error;
    }
    return this.checkIn(staffUserId, staffRole, {
      eventId: payload.eventId,
      gateId: dto.gateId,
      manual: undefined,
      qr: payload,
    });
  }

  async lookupTicket(
    staffUserId: string,
    staffRole: string,
    dto: GateLookupRequest,
  ): Promise<GateLookupResponse> {
    const result = await this.checkIn(staffUserId, staffRole, {
      eventId: dto.eventId,
      gateId: dto.gateId,
      manual: dto,
      qr: undefined,
    });
    return { ...result, method: "MANUAL_LOOKUP" };
  }

  private async checkIn(
    staffUserId: string,
    staffRole: string,
    input: {
      eventId: string;
      gateId: string | undefined;
      manual: GateLookupRequest | undefined;
      qr: ReturnType<Ed25519Service["verifyDynamicQr"]> | undefined;
    },
  ): Promise<GateScanResponse> {
    const method = input.manual ? "MANUAL" : "QR";
    let resolvedGate: string | null = null;
    let foundTicket: string | null = null;
    try {
      return await db.transaction(async (tx) => {
        const [actor] = await tx
          .select()
          .from(users)
          .where(eq(users.id, staffUserId))
          .for("share");
        if (
          !actor ||
          actor.status !== "ACTIVE" ||
          actor.role !== staffRole ||
          ![UserRole.GATE_STAFF, UserRole.ADMIN].some((r) => r === actor.role)
        )
          throw new ForbiddenException("STAFF_INACTIVE");
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
            throw new ForbiddenException("STAFF_NOT_ASSIGNED_TO_EVENT");
          assignedGate = assignment.gateId;
          if (assignedGate && input.gateId && input.gateId !== assignedGate)
            throw new ForbiddenException("STAFF_NOT_ASSIGNED_TO_GATE");
        }
        const [event] = await tx
          .select()
          .from(events)
          .where(eq(events.id, input.eventId))
          .for("share");
        if (!event || event.status !== EventStatus.PUBLISHED)
          throw new BadRequestException("EVENT_NOT_ACTIVE");
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
            throw new BadRequestException("INVALID_GATE_ID");
          }
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
        if (!info) throw new NotFoundException("TICKET_NOT_FOUND");
        foundTicket = info.ticket.id;
        if (
          input.qr &&
          (info.ticket.orderId !== input.qr.orderId ||
            info.ticket.userId !== input.qr.userId)
        )
          throw new BadRequestException("QR_TICKET_MISMATCH");
        if (info.ticket.status === TicketStatus.CHECKED_IN)
          throw new ConflictException(
            `TICKET_ALREADY_USED: Ticket was already checked in at ${info.ticket.checkedInAt?.toISOString()} by staff ${info.ticket.checkedInBy}`,
          );
        if (info.ticket.status !== TicketStatus.SOLD)
          throw new BadRequestException("TICKET_NOT_ELIGIBLE");
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
          if (!phoneMatch && !emailMatch)
            throw new BadRequestException("VERIFICATION_FAILED");
        }
        if (!resolvedGate) throw new BadRequestException("GATE_REQUIRED");
        const now = new Date();
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
        if (!updated) throw new ConflictException("TICKET_ALREADY_USED");
        const reason = input.manual?.reason ?? null;
        await tx.insert(gateCheckinLogs).values({
          eventId: input.eventId,
          ticketId: updated.id,
          gateId: resolvedGate,
          staffId: staffUserId,
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
        error instanceof HttpException ? error.message : "CHECKIN_FAILED";
      await db.insert(gateCheckinLogs).values({
        eventId: input.eventId,
        ticketId: foundTicket,
        gateId: resolvedGate,
        staffId: staffUserId,
        method,
        outcome: "REJECTED",
        reason: input.manual?.reason ?? null,
        errorCode: message.split(":")[0]!.slice(0, 100),
      });
      throw error;
    }
  }

  /**
   * Lấy danh sách vé đã mua của người dùng (Ví vé cá nhân)
   */
  async getMyTickets(
    userId: string,
    query: MyTicketsQuery,
  ): Promise<MyTicketsListResponse> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    const whereConditions = [eq(tickets.userId, userId)];

    if (query.eventId) {
      whereConditions.push(eq(tickets.eventId, query.eventId));
    }

    if (query.status) {
      whereConditions.push(eq(tickets.status, query.status));
    } else {
      whereConditions.push(
        inArray(tickets.status, [TicketStatus.SOLD, TicketStatus.CHECKED_IN]),
      );
    }

    const combinedWhere = and(...whereConditions);

    const countResult = await db
      .select({ value: count() })
      .from(tickets)
      .where(combinedWhere);
    const total = countResult[0]?.value ? Number(countResult[0].value) : 0;
    const totalPages = Math.ceil(total / limit);

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
      .where(combinedWhere)
      .orderBy(asc(events.startTime), asc(tickets.id))
      .limit(limit)
      .offset(offset);

    const items: MyTicketItem[] = rows.map((row) => {
      const price = Number(row.ticketTypePrice);
      const effectivePaidPrice = calculateEffectivePaidPrice(
        price,
        Number(row.orderTotalAmount),
        Number(row.orderFinalAmount),
      );
      const seatInfo = formatTicketSeatInfo(
        row.isSeated,
        row.ticketTypeName,
        row.seatId
          ? {
              zoneName: row.seatZoneName!,
              rowLabel: row.seatRowLabel!,
              seatNumber: row.seatNumber!,
            }
          : null,
      );

      return {
        id: row.ticketId,
        ticketCode: row.ticketCode,
        status: row.ticketStatus,
        price,
        effectivePaidPrice,
        checkedInAt: row.checkedInAt ? row.checkedInAt.toISOString() : null,
        orderId: row.orderId,
        orderCode: row.orderCode,
        eventId: row.eventId,
        eventTitle: row.eventTitle,
        eventBannerUrl: row.eventBannerUrl,
        eventStartTime: row.eventStartTime.toISOString(),
        eventEndTime: row.eventEndTime.toISOString(),
        eventVenueName: row.eventVenueName,
        eventCity: row.eventCity,
        eventStatus: row.eventStatus,
        ticketTypeId: row.ticketTypeId,
        ticketTypeName: row.ticketTypeName,
        isSeated: row.isSeated,
        seatInfo,
      };
    });

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }
}
