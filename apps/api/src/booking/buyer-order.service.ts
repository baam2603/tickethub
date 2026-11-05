import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { eq, and, desc, count } from "drizzle-orm";
import { db } from "../database/db";
import { orders } from "../database/schema";
import {
  BuyerOrderQuery,
  BuyerOrderListResponse,
  BuyerOrderDetailResponse,
  BuyerOrderDetailTicketItem,
  UserRole,
  OrderStatus,
} from "@tickethub/shared";

export function formatTicketSeatInfo(
  isSeated: boolean,
  ticketTypeName: string,
  seat: { zoneName: string; rowLabel: string; seatNumber: string } | null,
) {
  if (isSeated && seat) {
    const zonePrefix = seat.zoneName.startsWith("Khu")
      ? seat.zoneName
      : `Khu ${seat.zoneName}`;
    return {
      zoneName: seat.zoneName,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
      formattedLabel: `${zonePrefix} - Hàng ${seat.rowLabel} - Ghế ${seat.seatNumber}`,
    };
  }

  return {
    zoneName: ticketTypeName,
    rowLabel: null,
    seatNumber: null,
    formattedLabel: `Khu vực: ${ticketTypeName} (Vé đứng)`,
  };
}

export function calculateEffectivePaidPrice(
  unitPrice: number,
  totalAmount: number,
  finalAmount: number,
): number {
  if (totalAmount <= 0) {
    return unitPrice;
  }
  return Math.round(unitPrice * (finalAmount / totalAmount));
}

@Injectable()
export class BuyerOrderService {
  async listBuyerOrders(
    userId: string,
    query: BuyerOrderQuery,
  ): Promise<BuyerOrderListResponse> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const offset = (page - 1) * limit;

    const whereConditions = [eq(orders.userId, userId)];
    if (query.status) {
      whereConditions.push(eq(orders.status, query.status));
    }
    const combinedWhere = and(...whereConditions);

    const countResult = await db
      .select({ value: count() })
      .from(orders)
      .where(combinedWhere);
    const total = countResult[0]?.value ? Number(countResult[0].value) : 0;
    const totalPages = Math.ceil(total / limit);

    const userOrders = await db.query.orders.findMany({
      where: combinedWhere,
      orderBy: [desc(orders.createdAt)],
      limit,
      offset,
      with: {
        event: true,
        items: true,
      },
    });

    const items = userOrders.map((order) => {
      const ticketCount = (order.items || []).reduce(
        (sum, item) => sum + (item.quantity || 0),
        0,
      );
      return {
        id: order.id,
        orderCode: order.orderCode,
        eventId: order.eventId,
        eventTitle: order.event.title,
        eventBannerUrl: order.event.bannerUrl,
        eventStartTime: order.event.startTime.toISOString(),
        eventVenueName: order.event.venueName,
        totalAmount: Number(order.totalAmount),
        discountAmount: Number(order.discountAmount),
        finalAmount: Number(order.finalAmount),
        status: order.status,
        expiresAt: order.expiresAt.toISOString(),
        paidAt: order.paidAt ? order.paidAt.toISOString() : null,
        createdAt: order.createdAt.toISOString(),
        ticketCount,
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

  async getBuyerOrderDetail(
    userId: string,
    role: string,
    orderId: string,
  ): Promise<BuyerOrderDetailResponse> {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      with: {
        event: true,
        items: {
          with: {
            ticketType: true,
          },
        },
        tickets: {
          with: {
            ticketType: true,
            seat: true,
          },
        },
        refunds: true,
      },
    });

    if (!order) {
      throw new NotFoundException({
        success: false,
        error: {
          code: "ORDER_NOT_FOUND",
          message: "Không tìm thấy đơn hàng",
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (order.userId !== userId && role !== UserRole.ADMIN) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "ACCESS_DENIED",
          message: "Bạn không có quyền truy cập đơn hàng này",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const items = (order.items || []).map((item) => ({
      id: item.id,
      ticketTypeId: item.ticketTypeId,
      ticketTypeName: item.ticketType.name,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      subtotal: Number(item.subtotal),
    }));

    const isPaidOrRefunded =
      order.status === OrderStatus.PAID || order.status === OrderStatus.REFUNDED;

    let ticketList: BuyerOrderDetailTicketItem[] = [];
    if (isPaidOrRefunded && order.tickets && order.tickets.length > 0) {
      ticketList = order.tickets.map((t) => {
        const matchingItem = order.items.find(
          (i) => i.ticketTypeId === t.ticketTypeId,
        );
        const unitPrice = matchingItem
          ? Number(matchingItem.unitPrice)
          : Number(t.ticketType.price);
        const effectivePaidPrice = calculateEffectivePaidPrice(
          unitPrice,
          Number(order.totalAmount),
          Number(order.finalAmount),
        );
        const seatInfo = formatTicketSeatInfo(
          t.ticketType.isSeated,
          t.ticketType.name,
          t.seat,
        );

        return {
          id: t.id,
          ticketCode: t.ticketCode,
          ticketTypeId: t.ticketTypeId,
          ticketTypeName: t.ticketType.name,
          isSeated: t.ticketType.isSeated,
          seatInfo,
          price: unitPrice,
          effectivePaidPrice,
          status: t.status,
          checkedInAt: t.checkedInAt ? t.checkedInAt.toISOString() : null,
        };
      });
    }

    const refundList = (order.refunds || []).map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));

    return {
      id: order.id,
      orderCode: order.orderCode,
      status: order.status,
      totalAmount: Number(order.totalAmount),
      discountAmount: Number(order.discountAmount),
      finalAmount: Number(order.finalAmount),
      voucherCode: order.voucherCode,
      expiresAt: order.expiresAt.toISOString(),
      paidAt: order.paidAt ? order.paidAt.toISOString() : null,
      createdAt: order.createdAt.toISOString(),
      event: {
        id: order.event.id,
        title: order.event.title,
        slug: order.event.slug,
        bannerUrl: order.event.bannerUrl,
        venueName: order.event.venueName,
        venueAddress: order.event.venueAddress,
        city: order.event.city,
        startTime: order.event.startTime.toISOString(),
        endTime: order.event.endTime.toISOString(),
        status: order.event.status,
      },
      items,
      tickets: ticketList,
      refunds: refundList,
    };
  }
}
