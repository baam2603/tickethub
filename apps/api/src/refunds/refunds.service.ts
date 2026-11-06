import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Optional,
  Inject,
} from "@nestjs/common";
import { and, eq, inArray, sql, gte } from "drizzle-orm";
import {
  OrderStatus,
  TicketStatus,
  SeatStatus,
  RefundStatus,
  OutboxStatus,
  UserRole,
  RefundPolicyType,
  type RefundPreviewRequest,
  type RefundPreviewResponse,
  type RefundExecuteRequest,
  type RefundExecuteResponse,
} from "@tickethub/shared";

import { db } from "../database/db";
import {
  orders,
  tickets,
  seats,
  ticketTypes,
  events,
  refunds,
  outbox,
  auditLog,
  idempotencyKeys,
} from "../database/schema";
import {
  computeRefundPercentage,
  computeDaysUntilEvent,
  calculateTicketRefundBreakdown,
  type TicketToRefund,
} from "./refund-calculator";
import { EventReadCacheService } from "../events/event-read-cache.service";
import { SeatStreamService } from "../events/seat-stream.service";

@Injectable()
export class RefundsService {
  constructor(
    @Optional()
    @Inject(EventReadCacheService)
    private readonly eventReadCacheService?: EventReadCacheService,

    @Optional()
    @Inject(SeatStreamService)
    private readonly seatStreamService?: SeatStreamService,
  ) {}

  /**
   * Xem trước số tiền hoàn trả cho các vé được chọn (Read-only, chống IDOR)
   */
  async previewRefund(
    userId: string,
    role: string,
    dto: RefundPreviewRequest,
  ): Promise<RefundPreviewResponse> {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, dto.orderId),
      with: {
        event: true,
      },
    });

    if (!order) {
      throw new NotFoundException("ORDER_NOT_FOUND");
    }

    if (order.userId !== userId && role !== UserRole.ADMIN) {
      throw new ForbiddenException("ACCESS_DENIED");
    }

    if (order.status !== OrderStatus.PAID) {
      throw new BadRequestException("ORDER_NOT_PAID");
    }

    const policyType =
      (order.event?.refundPolicyType as RefundPolicyType) ||
      RefundPolicyType.FLEXIBLE;
    const now = new Date();
    const eventStartTime = order.event?.startTime || new Date();
    const refundPercentage = computeRefundPercentage(
      policyType,
      eventStartTime,
      now,
    );
    const daysUntilEvent = computeDaysUntilEvent(eventStartTime, now);

    if (refundPercentage === 0) {
      throw new BadRequestException(
        "REFUND_POLICY_NOT_ELIGIBLE: Event policy does not allow refund at this time",
      );
    }

    const requestedTickets = await db.query.tickets.findMany({
      where: and(
        eq(tickets.orderId, order.id),
        inArray(tickets.id, dto.ticketIds),
      ),
      with: {
        ticketType: true,
        seat: true,
      },
    });

    if (requestedTickets.length !== dto.ticketIds.length) {
      throw new NotFoundException("SOME_TICKETS_NOT_FOUND");
    }

    for (const t of requestedTickets) {
      if (t.status !== TicketStatus.SOLD) {
        throw new ConflictException(
          `TICKET_NOT_ELIGIBLE_FOR_REFUND: Ticket ${t.id} is ${t.status}`,
        );
      }
    }

    const priorRefunds = await db.query.refunds.findMany({
      where: eq(refunds.orderId, order.id),
    });
    const totalPreviouslyRefunded = priorRefunds.reduce(
      (sum, r) => sum + Number(r.amount),
      0,
    );

    const ticketsToRefund: TicketToRefund[] = requestedTickets.map((t) => ({
      ticketId: t.id,
      ticketCode: t.ticketCode,
      seatLabel: t.seat
        ? `Hàng ${t.seat.rowLabel} - Ghế ${t.seat.seatNumber}`
        : t.ticketType?.name || "GA",
      unitPrice: Number(t.ticketType?.price || 0),
    }));

    const breakdown = calculateTicketRefundBreakdown({
      tickets: ticketsToRefund,
      totalAmount: Number(order.totalAmount),
      finalAmount: Number(order.finalAmount),
      refundPercentage,
      totalPreviouslyRefunded,
    });

    return {
      orderId: order.id,
      policyType,
      daysUntilEvent,
      refundPercentage,
      items: breakdown.items,
      totalRefundAmount: breakdown.totalRefundAmount,
      totalFeeDeducted: breakdown.totalFeeDeducted,
    };
  }

  /**
   * Thực thi yêu cầu hoàn tiền vé nguyên tử trong PostgreSQL Database Transaction
   */
  async executeRefund(
    userId: string,
    role: string,
    dto: RefundExecuteRequest,
    idempotencyKey: string,
  ): Promise<RefundExecuteResponse> {
    // 1. Kiểm tra chống trùng request header
    const existingKey = await db.query.idempotencyKeys.findFirst({
      where: eq(idempotencyKeys.key, idempotencyKey),
    });
    if (existingKey && existingKey.responseBody) {
      return existingKey.responseBody as RefundExecuteResponse;
    }

    // 2. Mở Database Transaction
    const result = await db.transaction(async (tx) => {
      // Khóa dòng đơn hàng
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, dto.orderId))
        .for("update");

      if (!order) {
        throw new NotFoundException("ORDER_NOT_FOUND");
      }

      if (order.userId !== userId && role !== UserRole.ADMIN) {
        throw new ForbiddenException("ACCESS_DENIED");
      }

      if (order.status !== OrderStatus.PAID) {
        throw new BadRequestException("ORDER_NOT_PAID");
      }

      // Khóa dòng các vé được yêu cầu
      const requestedTickets = await tx
        .select()
        .from(tickets)
        .where(
          and(
            eq(tickets.orderId, order.id),
            inArray(tickets.id, dto.ticketIds),
          ),
        )
        .for("update");

      if (requestedTickets.length !== dto.ticketIds.length) {
        throw new NotFoundException("SOME_TICKETS_NOT_FOUND");
      }

      for (const t of requestedTickets) {
        if (t.status !== TicketStatus.SOLD) {
          throw new ConflictException(
            `TICKET_NOT_ELIGIBLE_FOR_REFUND: Ticket ${t.id} is ${t.status}`,
          );
        }
      }

      // Lấy thông tin sự kiện
      const event = await tx.query.events.findFirst({
        where: eq(events.id, order.eventId),
      });

      if (!event) {
        throw new NotFoundException("EVENT_NOT_FOUND");
      }

      const policyType =
        (event.refundPolicyType as RefundPolicyType) ||
        RefundPolicyType.FLEXIBLE;
      const now = new Date();
      const refundPercentage = computeRefundPercentage(
        policyType,
        event.startTime,
        now,
      );

      if (refundPercentage === 0) {
        throw new BadRequestException(
          "REFUND_POLICY_NOT_ELIGIBLE: Event policy does not allow refund at this time",
        );
      }

      // Tính tổng tiền đã hoàn trước đó
      const priorRefunds = await tx
        .select()
        .from(refunds)
        .where(eq(refunds.orderId, order.id));

      const totalPreviouslyRefunded = priorRefunds.reduce(
        (sum, r) => sum + Number(r.amount),
        0,
      );

      // Lấy thông tin giá vé từ ticketTypes
      const ttIds = requestedTickets.map((t) => t.ticketTypeId);
      const ttRows = await tx
        .select()
        .from(ticketTypes)
        .where(inArray(ticketTypes.id, ttIds));
      const ttMap = new Map(ttRows.map((tt) => [tt.id, tt]));

      const ticketsToRefund: TicketToRefund[] = requestedTickets.map((t) => {
        const tt = ttMap.get(t.ticketTypeId);
        return {
          ticketId: t.id,
          ticketCode: t.ticketCode,
          unitPrice: Number(tt?.price || 0),
        };
      });

      const breakdown = calculateTicketRefundBreakdown({
        tickets: ticketsToRefund,
        totalAmount: Number(order.totalAmount),
        finalAmount: Number(order.finalAmount),
        refundPercentage,
        totalPreviouslyRefunded,
      });

      // 3. Cập nhật trạng thái vé sang CANCELLED
      await tx
        .update(tickets)
        .set({
          status: TicketStatus.CANCELLED,
          updatedAt: now,
        })
        .where(inArray(tickets.id, dto.ticketIds));

      // 4. Giải phóng ghế / hoàn tồn kho
      const seatIds = requestedTickets
        .map((t) => t.seatId)
        .filter((id): id is string => id !== null);

      if (seatIds.length > 0) {
        await tx
          .update(seats)
          .set({
            status: SeatStatus.AVAILABLE,
            holdOrderId: null,
            holdExpiresAt: null,
            version: sql`${seats.version} + 1`,
            updatedAt: now,
          })
          .where(inArray(seats.id, seatIds));
      }

      // Với vé GA (không có số ghế): giảm soldCount
      const gaTickets = requestedTickets.filter((t) => t.seatId === null);
      if (gaTickets.length > 0) {
        const gaCounts = new Map<string, number>();
        for (const t of gaTickets) {
          gaCounts.set(t.ticketTypeId, (gaCounts.get(t.ticketTypeId) || 0) + 1);
        }
        for (const [ttId, count] of gaCounts) {
          await tx
            .update(ticketTypes)
            .set({
              soldCount: sql`${ticketTypes.soldCount} - ${count}`,
              updatedAt: now,
            })
            .where(
              and(eq(ticketTypes.id, ttId), gte(ticketTypes.soldCount, count)),
            );
        }
      }

      // 5. Tạo các bản ghi trong bảng refunds
      const refundRows = breakdown.items.map((item) => ({
        orderId: order.id,
        ticketId: item.ticketId,
        amount: String(item.refundAmount),
        reason: dto.reason,
        status: RefundStatus.PENDING,
        idempotencyKey: `${idempotencyKey}:${item.ticketId}`,
      }));

      const insertedRefunds = await tx
        .insert(refunds)
        .values(refundRows)
        .returning({ id: refunds.id });

      // 6. Cập nhật trạng thái đơn hàng nếu tất cả vé đều đã bị hủy
      const remainingUncancelled = await tx
        .select({ count: sql<number>`count(*)` })
        .from(tickets)
        .where(
          and(
            eq(tickets.orderId, order.id),
            sql`${tickets.status} != ${TicketStatus.CANCELLED}`,
          ),
        );

      const uncancelledCount = Number(remainingUncancelled[0]?.count || 0);
      let orderStatus: OrderStatus = OrderStatus.PAID;
      if (uncancelledCount === 0) {
        orderStatus = OrderStatus.REFUNDED;
        await tx
          .update(orders)
          .set({
            status: OrderStatus.REFUNDED,
            updatedAt: now,
          })
          .where(eq(orders.id, order.id));
      }

      // 7. Xác định cờ isPartial cho cổng VNPay
      const isPartial = !(
        totalPreviouslyRefunded === 0 &&
        breakdown.totalRefundAmount === Number(order.finalAmount)
      );

      // 8. Đẩy sự kiện REFUND_REQUESTED vào bảng outbox
      await tx.insert(outbox).values({
        eventType: "REFUND_REQUESTED",
        status: OutboxStatus.PENDING,
        payload: {
          orderId: order.id,
          orderCode: order.orderCode,
          refundIds: insertedRefunds.map((r) => r.id),
          ticketIds: dto.ticketIds,
          userId: order.userId,
          eventId: order.eventId,
          amount: breakdown.totalRefundAmount,
          reason: dto.reason,
          isPartial,
          requestedAt: now.toISOString(),
        },
      });

      // 9. Ghi log kiểm toán
      await tx.insert(auditLog).values({
        actorId: userId,
        actorRole: role,
        action: "TICKET_REFUND_REQUESTED",
        targetType: "ORDER",
        targetId: order.id,
        changes: {
          orderId: order.id,
          ticketIds: dto.ticketIds,
          refundAmount: breakdown.totalRefundAmount,
          reason: dto.reason,
          isPartial,
          newOrderStatus: orderStatus,
          timestamp: now.toISOString(),
        },
      });

      const responsePayload: RefundExecuteResponse = {
        refundId: insertedRefunds[0]?.id || "",
        refundIds: insertedRefunds.map((r) => r.id),
        orderId: order.id,
        status: "PROCESSING",
        refundAmount: breakdown.totalRefundAmount,
        cancelledTicketCount: dto.ticketIds.length,
        orderStatus,
      };

      // 10. Lưu kết quả vào idempotency_keys
      await tx.insert(idempotencyKeys).values({
        key: idempotencyKey,
        userId,
        path: "/api/v1/refund/request",
        responseStatus: 201,
        responseBody: responsePayload,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      return responsePayload;
    });

    // Invalidate Redis event read cache nếu có
    if (this.eventReadCacheService) {
      const [order] = await db
        .select({ eventId: orders.eventId })
        .from(orders)
        .where(eq(orders.id, dto.orderId))
        .limit(1);
      if (order?.eventId) {
        await this.eventReadCacheService.invalidate(order.eventId);
      }
    }

    // Phát sự kiện cập nhật trạng thái ghế thời gian thực qua Redis Pub/Sub
    if (this.seatStreamService) {
      const seatRows = await db
        .select({ seatId: tickets.seatId, eventId: tickets.eventId })
        .from(tickets)
        .where(inArray(tickets.id, dto.ticketIds));

      const seatsByEvent = new Map<string, string[]>();
      for (const r of seatRows) {
        if (r.seatId && r.eventId) {
          const list = seatsByEvent.get(r.eventId) || [];
          list.push(r.seatId);
          seatsByEvent.set(r.eventId, list);
        }
      }
      for (const [eventId, seatIds] of seatsByEvent.entries()) {
        await this.seatStreamService?.publishSeatStatusChanged(eventId, {
          seatIds,
          status: "AVAILABLE",
          expiresAt: null,
        });
      }
    }

    return result;
  }
}
