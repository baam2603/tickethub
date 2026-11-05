import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { db } from "../database/db";
import {
  auditLog,
  events,
  eventStaff,
  gates,
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
  TicketStatus,
  UserRole,
} from "@tickethub/shared";
import { Ed25519Service } from "./crypto/ed25519.service";

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
    const payload = this.ed25519Service.verifyDynamicQr(dto.qrToken);

    // 1. Kiểm tra phân công nhân viên nếu không phải ADMIN
    if (staffRole !== UserRole.ADMIN) {
      const [assignment] = await db
        .select({ id: eventStaff.id })
        .from(eventStaff)
        .where(
          and(
            eq(eventStaff.eventId, payload.eventId),
            eq(eventStaff.userId, staffUserId),
          ),
        )
        .limit(1);

      if (!assignment) {
        throw new ForbiddenException(
          "STAFF_NOT_ASSIGNED_TO_EVENT: Gate staff is not assigned to this event",
        );
      }
    }

    // 2. Kiểm tra trạng thái sự kiện (Kill Switch)
    const [event] = await db
      .select({ id: events.id, status: events.status, title: events.title })
      .from(events)
      .where(eq(events.id, payload.eventId))
      .limit(1);

    if (!event || event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException(
        `EVENT_NOT_ACTIVE: Event is not published or is suspended`,
      );
    }

    // 3. Kiểm tra gateId hợp lệ nếu có truyền
    if (dto.gateId) {
      const [gate] = await db
        .select({ id: gates.id })
        .from(gates)
        .where(
          and(eq(gates.id, dto.gateId), eq(gates.eventId, payload.eventId)),
        )
        .limit(1);

      if (!gate) {
        throw new BadRequestException(
          "INVALID_GATE_ID: Gate does not belong to this event",
        );
      }
    }

    // 4. Cập nhật nguyên tử trạng thái vé
    const now = new Date();
    const [updatedTicket] = await db
      .update(tickets)
      .set({
        status: TicketStatus.CHECKED_IN,
        checkedInAt: now,
        checkedInBy: staffUserId,
        gateId: dto.gateId ?? null,
        updatedAt: now,
      })
      .where(
        and(eq(tickets.id, payload.sub), eq(tickets.status, TicketStatus.SOLD)),
      )
      .returning();

    // 5. Nếu không cập nhật được dòng nào -> phân tích nguyên nhân lỗi
    if (!updatedTicket) {
      const [existing] = await db
        .select({
          id: tickets.id,
          status: tickets.status,
          checkedInAt: tickets.checkedInAt,
          checkedInBy: tickets.checkedInBy,
          gateId: tickets.gateId,
        })
        .from(tickets)
        .where(eq(tickets.id, payload.sub))
        .limit(1);

      if (!existing) {
        throw new NotFoundException("TICKET_NOT_FOUND");
      }

      if (existing.status === TicketStatus.CHECKED_IN) {
        throw new ConflictException(
          `TICKET_ALREADY_USED: Ticket was already checked in at ${existing.checkedInAt?.toISOString()} by staff ${existing.checkedInBy}`,
        );
      }

      throw new BadRequestException(
        `TICKET_NOT_ELIGIBLE: Ticket status is ${existing.status}`,
      );
    }

    // 6. Nạp thông tin chi tiết vé và người mua
    const [ticketInfo] = await db
      .select({
        ticketCode: tickets.ticketCode,
        ticketTypeName: ticketTypes.name,
        isSeated: ticketTypes.isSeated,
        zoneName: seats.zoneName,
        rowLabel: seats.rowLabel,
        seatNumber: seats.seatNumber,
        buyerName: users.fullName,
      })
      .from(tickets)
      .innerJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
      .innerJoin(users, eq(tickets.userId, users.id))
      .leftJoin(seats, eq(tickets.seatId, seats.id))
      .where(eq(tickets.id, updatedTicket.id))
      .limit(1);

    const seatLabel =
      ticketInfo?.isSeated && ticketInfo?.seatNumber
        ? `Hàng ${ticketInfo.rowLabel || ""} - Ghế ${ticketInfo.seatNumber}`.trim()
        : "GA - Fanzone (Vé đứng)";

    return {
      ticketId: updatedTicket.id,
      ticketCode: updatedTicket.ticketCode,
      status: updatedTicket.status,
      eventTitle: event.title,
      ticketTypeName: ticketInfo?.ticketTypeName || "",
      zoneName: ticketInfo?.zoneName ?? undefined,
      seatLabel,
      isSeated: ticketInfo?.isSeated ?? false,
      buyerName: ticketInfo?.buyerName || "",
      checkedInAt: updatedTicket.checkedInAt!.toISOString(),
      gateId: updatedTicket.gateId ?? undefined,
      staffId: staffUserId,
    };
  }

  /**
   * Tra cứu vé thủ công dự phòng khi khách gặp sự cố thiết bị
   */
  async lookupTicket(
    staffUserId: string,
    staffRole: string,
    dto: GateLookupRequest,
  ): Promise<GateLookupResponse> {
    // 1. Kiểm tra phân công nhân viên nếu không phải ADMIN
    if (staffRole !== UserRole.ADMIN) {
      const [assignment] = await db
        .select({ id: eventStaff.id })
        .from(eventStaff)
        .where(
          and(
            eq(eventStaff.eventId, dto.eventId),
            eq(eventStaff.userId, staffUserId),
          ),
        )
        .limit(1);

      if (!assignment) {
        throw new ForbiddenException(
          "STAFF_NOT_ASSIGNED_TO_EVENT: Gate staff is not assigned to this event",
        );
      }
    }

    // 2. Kiểm tra trạng thái sự kiện
    const [event] = await db
      .select({ id: events.id, status: events.status, title: events.title })
      .from(events)
      .where(eq(events.id, dto.eventId))
      .limit(1);

    if (!event || event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException(
        `EVENT_NOT_ACTIVE: Event is not published or is suspended`,
      );
    }

    // 3. Kiểm tra gateId hợp lệ nếu có
    if (dto.gateId) {
      const [gate] = await db
        .select({ id: gates.id })
        .from(gates)
        .where(and(eq(gates.id, dto.gateId), eq(gates.eventId, dto.eventId)))
        .limit(1);

      if (!gate) {
        throw new BadRequestException(
          "INVALID_GATE_ID: Gate does not belong to this event",
        );
      }
    }

    // 4. Tìm kiếm vé theo ticketCode và eventId
    const [ticketRow] = await db
      .select({
        id: tickets.id,
        userId: tickets.userId,
        status: tickets.status,
        ticketCode: tickets.ticketCode,
        buyerPhone: users.phone,
        buyerEmail: users.email,
        buyerName: users.fullName,
        ticketTypeName: ticketTypes.name,
        isSeated: ticketTypes.isSeated,
        zoneName: seats.zoneName,
        rowLabel: seats.rowLabel,
        seatNumber: seats.seatNumber,
      })
      .from(tickets)
      .innerJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
      .innerJoin(users, eq(tickets.userId, users.id))
      .leftJoin(seats, eq(tickets.seatId, seats.id))
      .where(
        and(
          eq(tickets.ticketCode, dto.ticketCode),
          eq(tickets.eventId, dto.eventId),
        ),
      )
      .limit(1);

    if (!ticketRow) {
      throw new NotFoundException(
        "TICKET_NOT_FOUND: Invalid ticket code for this event",
      );
    }

    if (ticketRow.status === TicketStatus.CHECKED_IN) {
      throw new ConflictException(
        "TICKET_ALREADY_USED: Ticket has already been used",
      );
    }

    if (ticketRow.status !== TicketStatus.SOLD) {
      throw new BadRequestException(
        `TICKET_NOT_ELIGIBLE: Ticket status is ${ticketRow.status}`,
      );
    }

    // 5. Đối soát 4 số cuối SĐT hoặc Email
    const last4Input = dto.phoneOrEmailLast4.trim().toLowerCase();
    let isMatch = false;

    if (ticketRow.buyerPhone) {
      const cleanPhone = ticketRow.buyerPhone.replace(/\D/g, "");
      if (cleanPhone.slice(-4) === last4Input) {
        isMatch = true;
      }
    }

    if (!isMatch && ticketRow.buyerEmail) {
      const emailLower = ticketRow.buyerEmail.toLowerCase();
      const emailLocalPart = emailLower.split("@")[0] || "";
      if (
        emailLocalPart.slice(-4) === last4Input ||
        emailLower.slice(-4) === last4Input
      ) {
        isMatch = true;
      }
    }

    if (!isMatch) {
      throw new BadRequestException(
        "VERIFICATION_FAILED: Phone or email last 4 digits do not match",
      );
    }

    // 6. Cập nhật nguyên tử
    const now = new Date();
    const [updatedTicket] = await db
      .update(tickets)
      .set({
        status: TicketStatus.CHECKED_IN,
        checkedInAt: now,
        checkedInBy: staffUserId,
        gateId: dto.gateId ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(tickets.id, ticketRow.id),
          eq(tickets.status, TicketStatus.SOLD),
        ),
      )
      .returning();

    if (!updatedTicket) {
      throw new ConflictException(
        "TICKET_ALREADY_USED: Ticket has already been checked in",
      );
    }

    // 7. Ghi vết kiểm toán bắt buộc vào audit_log
    await db.insert(auditLog).values({
      actorId: staffUserId,
      actorRole: staffRole,
      action: "MANUAL_TICKET_CHECK_IN",
      targetType: "TICKET",
      targetId: ticketRow.id,
      changes: {
        ticketCode: dto.ticketCode,
        reason: dto.reason,
        phoneOrEmailLast4: dto.phoneOrEmailLast4,
        gateId: dto.gateId ?? null,
        timestamp: now.toISOString(),
      },
    });

    const seatLabel =
      ticketRow.isSeated && ticketRow.seatNumber
        ? `Hàng ${ticketRow.rowLabel || ""} - Ghế ${ticketRow.seatNumber}`.trim()
        : "GA - Fanzone (Vé đứng)";

    return {
      ticketId: updatedTicket.id,
      ticketCode: updatedTicket.ticketCode,
      status: updatedTicket.status,
      eventTitle: event.title,
      ticketTypeName: ticketRow.ticketTypeName,
      zoneName: ticketRow.zoneName ?? undefined,
      seatLabel,
      isSeated: ticketRow.isSeated,
      buyerName: ticketRow.buyerName,
      checkedInAt: updatedTicket.checkedInAt!.toISOString(),
      gateId: updatedTicket.gateId ?? undefined,
      staffId: staffUserId,
      method: "MANUAL_LOOKUP",
    };
  }
}
