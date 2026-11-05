import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { sql, eq, and, or, lt, inArray, asc } from "drizzle-orm";
import crypto from "crypto";
import { db } from "../database/db";
import {
  orders,
  orderItems,
  seats,
  ticketTypes,
  events,
  outbox,
} from "../database/schema";
import {
  HoldSeatsRequest,
  OrderStatus,
  OutboxStatus,
  EventStatus,
  SeatStatus,
  AllocatedSeatItem,
} from "@tickethub/shared";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { EventReadCacheService } from "../events/event-read-cache.service";
import { SeatStreamService } from "../events/seat-stream.service";

interface CandidateSeat {
  id: string;
  zoneName: string;
  rowLabel: string;
  seatNumber: string;
  ticketTypeId: string;
}

function parseSeatNumber(seatNum: string): number {
  const match = seatNum.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function findContiguousSeats(
  candidates: CandidateSeat[],
  quantity: number,
): CandidateSeat[] {
  if (candidates.length < quantity) {
    return [];
  }

  // Gom nhom theo rowLabel
  const byRow = new Map<string, CandidateSeat[]>();
  for (const seat of candidates) {
    if (!byRow.has(seat.rowLabel)) {
      byRow.set(seat.rowLabel, []);
    }
    byRow.get(seat.rowLabel)!.push(seat);
  }

  // Pass 1: Tim chuoi quantity ghe lien tiep trong cung 1 hang
  for (const [, rowSeats] of byRow.entries()) {
    const sorted = [...rowSeats].sort(
      (a, b) => parseSeatNumber(a.seatNumber) - parseSeatNumber(b.seatNumber),
    );
    if (sorted.length >= quantity) {
      for (let i = 0; i <= sorted.length - quantity; i++) {
        let isConsecutive = true;
        for (let j = 0; j < quantity - 1; j++) {
          if (
            parseSeatNumber(sorted[i + j + 1]!.seatNumber) !==
            parseSeatNumber(sorted[i + j]!.seatNumber) + 1
          ) {
            isConsecutive = false;
            break;
          }
        }
        if (isConsecutive) {
          return sorted.slice(i, i + quantity);
        }
      }
    }
  }

  // Pass 2: Fallback lay quantity ghe trong cung 1 hang du khong lien tiep
  for (const [, rowSeats] of byRow.entries()) {
    if (rowSeats.length >= quantity) {
      const sorted = [...rowSeats].sort(
        (a, b) => parseSeatNumber(a.seatNumber) - parseSeatNumber(b.seatNumber),
      );
      return sorted.slice(0, quantity);
    }
  }

  // Pass 3: Fallback lay cac ghe trong khac hang
  return candidates.slice(0, quantity);
}

@Injectable()
export class BookingService {
  constructor(
    @Inject(WaitingRoomService)
    private readonly waitingRoomService: WaitingRoomService,

    @Inject(EventReadCacheService)
    private readonly eventReadCacheService: EventReadCacheService,

    @Inject(SeatStreamService)
    private readonly seatStreamService: SeatStreamService,
  ) {}

  async holdSeats(
    userId: string,
    dto: HoldSeatsRequest,
    admissionToken?: string,
  ) {
    const event = await db.query.events.findFirst({
      where: eq(events.id, dto.eventId),
    });

    if (!event) {
      throw new NotFoundException({
        success: false,
        error: {
          code: "EVENT_NOT_FOUND",
          message: "Không tìm thấy sự kiện",
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "EVENT_NOT_PUBLISHED",
          message: "Sự kiện chưa mở bán vé hoặc đã kết thúc",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Kiểm tra hàng chờ ảo nếu sự kiện yêu cầu
    if (event.isWaitingRoomEnabled) {
      if (!admissionToken) {
        throw new ForbiddenException({
          success: false,
          error: {
            code: "MISSING_ADMISSION_TOKEN",
            message:
              "Sự kiện đang bật hàng chờ ảo, yêu cầu header X-Admission-Token",
            timestamp: new Date().toISOString(),
          },
        });
      }

      const isValidToken = await this.waitingRoomService.verifyAdmissionToken(
        admissionToken,
        dto.eventId,
        userId,
      );

      if (!isValidToken) {
        throw new ForbiddenException({
          success: false,
          error: {
            code: "INVALID_ADMISSION_TOKEN",
            message:
              "Mã lượt hàng chờ ảo không hợp lệ hoặc đã hết hạn (X-Admission-Token)",
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    // Kiểm tra tổng số lượng vé đặt (tối đa 6 vé)
    const totalQuantity = dto.items.reduce(
      (sum, item) => sum + (item.quantity ?? 1),
      0,
    );
    if (totalQuantity > 6) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "MAX_TICKETS_EXCEEDED",
          message: "Số lượng vé tối đa trên mỗi đơn hàng là 6 vé",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Tải thông tin các hạng vé trước
    const allTicketTypeIds = Array.from(
      new Set(dto.items.map((i) => i.ticketTypeId)),
    );
    const ticketTypeRows = await db.query.ticketTypes.findMany({
      where: and(
        inArray(ticketTypes.id, allTicketTypeIds),
        eq(ticketTypes.eventId, dto.eventId),
      ),
    });
    const ttMap = new Map(ticketTypeRows.map((tt) => [tt.id, tt]));

    for (const item of dto.items) {
      if (!ttMap.has(item.ticketTypeId)) {
        throw new NotFoundException({
          success: false,
          error: {
            code: "TICKET_TYPE_NOT_FOUND",
            message: `Hạng vé ${item.ticketTypeId} không tồn tại trong sự kiện`,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    // Phân loại: tự động phân bổ ghế (chuẩn domain model), ghế chỉ định (tương thích ngược), và vé đứng
    const explicitSeatedItems = dto.items.filter((i) => Boolean(i.seatId));
    const autoSeatedItems = dto.items.filter(
      (i) => !i.seatId && ttMap.get(i.ticketTypeId)?.isSeated === true,
    );
    const standingItems = dto.items.filter(
      (i) => !i.seatId && ttMap.get(i.ticketTypeId)?.isSeated === false,
    );

    const explicitSeatIds = explicitSeatedItems.map((i) => i.seatId!);
    if (new Set(explicitSeatIds).size !== explicitSeatIds.length) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "DUPLICATE_SEATS",
          message: "Danh sách ghế yêu cầu chứa vị trí trùng lặp",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const sortedExplicitSeatIds = [...explicitSeatIds].sort();

    const result = await db.transaction(async (tx) => {
      const now = new Date();
      const holdExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);
      const allHeldSeatIds: string[] = [];
      const allHeldSeatIdsSet = new Set<string>();
      const allocatedSeatItems: AllocatedSeatItem[] = [];
      const orderItemPayloads: Array<{
        ticketTypeId: string;
        seatId: string | null;
        quantity: number;
        unitPrice: string;
        subtotal: string;
      }> = [];
      let totalAmount = 0;

      // 1. Khóa và cập nhật ghế ngồi chỉ định cụ thể (hỗ trợ tương thích ngược cho test suites)
      if (sortedExplicitSeatIds.length > 0) {
        const lockedSeats = await tx
          .select({
            id: seats.id,
            status: seats.status,
            ticketTypeId: seats.ticketTypeId,
            zoneName: seats.zoneName,
            rowLabel: seats.rowLabel,
            seatNumber: seats.seatNumber,
          })
          .from(seats)
          .where(
            and(
              inArray(seats.id, sortedExplicitSeatIds),
              eq(seats.eventId, dto.eventId),
            ),
          )
          .orderBy(asc(seats.id))
          .for("update");

        if (lockedSeats.length < sortedExplicitSeatIds.length) {
          throw new NotFoundException({
            success: false,
            error: {
              code: "SEAT_NOT_FOUND",
              message: "Một số ghế yêu cầu không tồn tại trong sự kiện",
              timestamp: new Date().toISOString(),
            },
          });
        }

        const seatTypeById = new Map(
          lockedSeats.map((seat) => [seat.id, seat.ticketTypeId]),
        );

        for (const item of explicitSeatedItems) {
          if (
            (item.quantity ?? 1) !== 1 ||
            seatTypeById.get(item.seatId!) !== item.ticketTypeId
          ) {
            throw new BadRequestException({
              success: false,
              error: {
                code: "SEAT_TICKET_TYPE_MISMATCH",
                message:
                  "Ghế không thuộc hạng vé đã chọn hoặc số lượng không hợp lệ",
                timestamp: new Date().toISOString(),
              },
            });
          }
        }

        const updatedSeats = await tx
          .update(seats)
          .set({
            status: SeatStatus.HELD,
            holdExpiresAt,
            version: sql`${seats.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              inArray(seats.id, sortedExplicitSeatIds),
              eq(seats.eventId, dto.eventId),
              or(
                eq(seats.status, SeatStatus.AVAILABLE),
                and(
                  eq(seats.status, SeatStatus.HELD),
                  lt(seats.holdExpiresAt, now),
                ),
              ),
            ),
          )
          .returning({ id: seats.id });

        if (updatedSeats.length < sortedExplicitSeatIds.length) {
          throw new ConflictException({
            success: false,
            error: {
              code: "SEAT_ALREADY_HELD",
              message:
                "Một hoặc nhiều ghế đã được người khác giữ chỗ hoặc đã bán",
              timestamp: new Date().toISOString(),
            },
          });
        }

        for (const s of lockedSeats) {
          allHeldSeatIds.push(s.id);
          allHeldSeatIdsSet.add(s.id);
          allocatedSeatItems.push({
            id: s.id,
            zoneName: s.zoneName,
            rowLabel: s.rowLabel,
            seatNumber: s.seatNumber,
          });

          const tt = ttMap.get(s.ticketTypeId)!;
          const price = Number(tt.price);
          totalAmount += price;
          orderItemPayloads.push({
            ticketTypeId: s.ticketTypeId,
            seatId: s.id,
            quantity: 1,
            unitPrice: price.toFixed(2),
            subtotal: price.toFixed(2),
          });
        }
      }

      // 2. Tự động phân bổ ghế ngồi liền kề cho vé ngồi không chỉ định seatId
      for (const autoItem of autoSeatedItems) {
        const qty = autoItem.quantity ?? 1;
        let chosenAutoSeats: CandidateSeat[] = [];
        let allocated = false;
        const maxRetries = 10;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          const candidateSeats = await tx
            .select({
              id: seats.id,
              zoneName: seats.zoneName,
              rowLabel: seats.rowLabel,
              seatNumber: seats.seatNumber,
              ticketTypeId: seats.ticketTypeId,
            })
            .from(seats)
            .where(
              and(
                eq(seats.eventId, dto.eventId),
                eq(seats.ticketTypeId, autoItem.ticketTypeId),
                or(
                  eq(seats.status, SeatStatus.AVAILABLE),
                  and(
                    eq(seats.status, SeatStatus.HELD),
                    lt(seats.holdExpiresAt, now),
                  ),
                ),
              ),
            )
            .orderBy(asc(seats.rowLabel), asc(seats.seatNumber));

          const availableCandidates = candidateSeats.filter(
            (s) => !allHeldSeatIdsSet.has(s.id),
          );

          const chosen = findContiguousSeats(availableCandidates, qty);
          if (chosen.length < qty) {
            throw new ConflictException({
              success: false,
              error: {
                code: "INSUFFICIENT_TICKET_CAPACITY",
                message:
                  "Số lượng ghế trống không còn đủ để giữ chỗ theo yêu cầu",
                timestamp: new Date().toISOString(),
              },
            });
          }

          const chosenSeatIds = chosen.map((s) => s.id).sort();

          // Khóa các ghế được chọn bằng SELECT ... FOR UPDATE theo thứ tự id tăng dần
          const lockedAutoSeats = await tx
            .select({
              id: seats.id,
              zoneName: seats.zoneName,
              rowLabel: seats.rowLabel,
              seatNumber: seats.seatNumber,
              ticketTypeId: seats.ticketTypeId,
            })
            .from(seats)
            .where(
              and(
                inArray(seats.id, chosenSeatIds),
                eq(seats.eventId, dto.eventId),
                or(
                  eq(seats.status, SeatStatus.AVAILABLE),
                  and(
                    eq(seats.status, SeatStatus.HELD),
                    lt(seats.holdExpiresAt, now),
                  ),
                ),
              ),
            )
            .orderBy(asc(seats.id))
            .for("update");

          if (lockedAutoSeats.length === chosenSeatIds.length) {
            chosenAutoSeats = lockedAutoSeats;
            allocated = true;
            break;
          }
          // Neu bi transaction khac chiem mat, thu tim tiep o vong lap sau
        }

        if (!allocated || chosenAutoSeats.length < qty) {
          throw new ConflictException({
            success: false,
            error: {
              code: "SEAT_ALREADY_HELD",
              message:
                "Một số ghế phân bổ vừa được người khác giữ chỗ. Vui lòng thử lại.",
              timestamp: new Date().toISOString(),
            },
          });
        }

        const chosenSeatIds = chosenAutoSeats.map((s) => s.id).sort();

        await tx
          .update(seats)
          .set({
            status: SeatStatus.HELD,
            holdExpiresAt,
            version: sql`${seats.version} + 1`,
            updatedAt: now,
          })
          .where(inArray(seats.id, chosenSeatIds));

        const tt = ttMap.get(autoItem.ticketTypeId)!;
        const price = Number(tt.price);

        for (const s of chosenAutoSeats) {
          allHeldSeatIds.push(s.id);
          allHeldSeatIdsSet.add(s.id);
          allocatedSeatItems.push({
            id: s.id,
            zoneName: s.zoneName,
            rowLabel: s.rowLabel,
            seatNumber: s.seatNumber,
          });

          totalAmount += price;
          orderItemPayloads.push({
            ticketTypeId: s.ticketTypeId,
            seatId: s.id,
            quantity: 1,
            unitPrice: price.toFixed(2),
            subtotal: price.toFixed(2),
          });
        }
      }

      // 3. Khóa và cập nhật khu đứng không số
      for (const item of standingItems) {
        const qty = item.quantity ?? 1;

        const [lockedTT] = await tx
          .select({
            id: ticketTypes.id,
            capacity: ticketTypes.capacity,
            heldCount: ticketTypes.heldCount,
            soldCount: ticketTypes.soldCount,
            isSeated: ticketTypes.isSeated,
          })
          .from(ticketTypes)
          .where(
            and(
              eq(ticketTypes.id, item.ticketTypeId),
              eq(ticketTypes.eventId, dto.eventId),
            ),
          )
          .for("update");

        if (!lockedTT || lockedTT.isSeated) {
          throw new BadRequestException({
            success: false,
            error: {
              code: "INVALID_TICKET_TYPE",
              message: "Hạng vé khu đứng không hợp lệ",
              timestamp: new Date().toISOString(),
            },
          });
        }

        if (lockedTT.soldCount + lockedTT.heldCount + qty > lockedTT.capacity) {
          throw new ConflictException({
            success: false,
            error: {
              code: "INSUFFICIENT_TICKET_CAPACITY",
              message: "Số lượng vé khu đứng không còn đủ để giữ chỗ",
              timestamp: new Date().toISOString(),
            },
          });
        }

        await tx
          .update(ticketTypes)
          .set({
            heldCount: sql`${ticketTypes.heldCount} + ${qty}`,
            updatedAt: now,
          })
          .where(eq(ticketTypes.id, item.ticketTypeId));

        const tt = ttMap.get(item.ticketTypeId)!;
        const price = Number(tt.price);
        const subtotal = price * qty;
        totalAmount += subtotal;

        orderItemPayloads.push({
          ticketTypeId: item.ticketTypeId,
          seatId: null,
          quantity: qty,
          unitPrice: price.toFixed(2),
          subtotal: subtotal.toFixed(2),
        });
      }

      // 4. Tạo bản ghi đơn hàng PENDING có hạn 5 phút
      const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
      const orderCode = `ORD-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, "0")}${now.getDate().toString().padStart(2, "0")}-${randomSuffix}`;

      const [newOrder] = await tx
        .insert(orders)
        .values({
          orderCode,
          userId,
          eventId: dto.eventId,
          totalAmount: totalAmount.toFixed(2),
          discountAmount: "0.00",
          finalAmount: totalAmount.toFixed(2),
          status: OrderStatus.PENDING,
          expiresAt: holdExpiresAt,
        })
        .returning();

      if (!newOrder) {
        throw new Error("Không thể tạo bản ghi đơn hàng");
      }

      // 5. Gắn orderId vào các ghế đã giữ
      if (allHeldSeatIds.length > 0) {
        await tx
          .update(seats)
          .set({ holdOrderId: newOrder.id })
          .where(inArray(seats.id, allHeldSeatIds));
      }

      // 6. Thêm các dòng chi tiết đơn hàng
      const itemsToInsert = orderItemPayloads.map((i) => ({
        orderId: newOrder.id,
        ticketTypeId: i.ticketTypeId,
        seatId: i.seatId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        subtotal: i.subtotal,
      }));

      await tx.insert(orderItems).values(itemsToInsert);

      // 7. Ghi nhận sự kiện Outbox
      allocatedSeatItems.sort((a, b) => {
        if (a.rowLabel !== b.rowLabel) {
          return a.rowLabel.localeCompare(b.rowLabel);
        }
        return parseSeatNumber(a.seatNumber) - parseSeatNumber(b.seatNumber);
      });

      await tx.insert(outbox).values({
        eventType: "ORDER_HOLD_CREATED",
        payload: {
          orderId: newOrder.id,
          orderCode: newOrder.orderCode,
          userId,
          eventId: dto.eventId,
          heldSeats: allHeldSeatIds,
          allocatedSeats: allocatedSeatItems,
          totalAmount,
          expiresAt: holdExpiresAt.toISOString(),
        },
        status: OutboxStatus.PENDING,
      });

      return {
        orderId: newOrder.id,
        orderCode: newOrder.orderCode,
        heldSeats: allHeldSeatIds,
        allocatedSeats: allocatedSeatItems,
        totalAmount,
        holdExpiresAt: holdExpiresAt.toISOString(),
        remainingSeconds: 300,
      };
    });

    // Chi xoa cache sau khi PostgreSQL commit thanh cong
    await this.eventReadCacheService.invalidate(dto.eventId);

    if (result.heldSeats && result.heldSeats.length > 0) {
      await this.seatStreamService.publishSeatStatusChanged(dto.eventId, {
        seatIds: result.heldSeats,
        status: "HELD",
        expiresAt: result.holdExpiresAt,
      });
    }

    return result;
  }

  async releaseHold(userId: string, orderId: string) {
    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, orderId), eq(orders.userId, userId)),
      with: { items: true },
    });

    if (!order) {
      throw new NotFoundException({
        success: false,
        error: {
          code: "ORDER_NOT_FOUND",
          message: "Không tìm thấy đơn hàng cần giải phóng",
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "ORDER_NOT_PENDING",
          message: `Chỉ đơn hàng PENDING mới có thể hủy giữ chỗ (trạng thái: ${order.status})`,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const result = await db.transaction(async (tx) => {
      // 1. Cập nhật đơn hàng thành CANCELLED
      const updatedOrders = await tx
        .update(orders)
        .set({
          status: OrderStatus.CANCELLED,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, orderId),
            eq(orders.userId, userId),
            eq(orders.status, OrderStatus.PENDING),
          ),
        )
        .returning({ id: orders.id });

      if (updatedOrders.length !== 1) {
        throw new ConflictException({
          success: false,
          error: {
            code: "ORDER_STATUS_CHANGED",
            message: "Trạng thái đơn hàng đã thay đổi, không thể hủy giữ chỗ",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // 2. Trả ghế về AVAILABLE
      await tx
        .update(seats)
        .set({
          status: SeatStatus.AVAILABLE,
          holdOrderId: null,
          holdExpiresAt: null,
          version: sql`${seats.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(seats.holdOrderId, orderId));

      // 3. Hoàn trả held_count cho khu đứng
      for (const item of order.items) {
        if (!item.seatId) {
          await tx
            .update(ticketTypes)
            .set({
              heldCount: sql`GREATEST(0, ${ticketTypes.heldCount} - ${item.quantity})`,
              updatedAt: new Date(),
            })
            .where(eq(ticketTypes.id, item.ticketTypeId));
        }
      }

      // 4. Ghi outbox
      await tx.insert(outbox).values({
        eventType: "ORDER_HOLD_RELEASED",
        payload: {
          orderId,
          userId,
          releasedAt: new Date().toISOString(),
        },
        status: OutboxStatus.PENDING,
      });

      return {
        message: "Đã giải phóng ghế thành công",
      };
    });

    // Sau khi huy giu ve thanh cong
    await this.eventReadCacheService.invalidate(order.eventId);

    if (order.items && order.items.length > 0) {
      const seatIds = order.items
        .map((item) => item.seatId)
        .filter((id): id is string => id !== null && id !== undefined);
      if (seatIds.length > 0) {
        await this.seatStreamService.publishSeatStatusChanged(order.eventId, {
          seatIds,
          status: "AVAILABLE",
          expiresAt: null,
        });
      }
    }

    return result;
  }

  async getOrderById(userId: string, orderId: string) {
    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, orderId), eq(orders.userId, userId)),
      with: {
        items: {
          with: {
            ticketType: true,
            seat: true,
          },
        },
        event: true,
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

    const now = Date.now();
    const remainingSeconds = Math.max(
      0,
      Math.floor((order.expiresAt.getTime() - now) / 1000),
    );

    return {
      ...order,
      remainingSeconds,
    };
  }

  // Tác vụ quét thu hồi đơn hàng và ghế hết hạn
  async cleanExpiredOrders(): Promise<{ expiredOrdersCount: number }> {
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      // Tìm các đơn hàng PENDING đã hết hạn
      const expiredOrders = await tx
        .select({
          id: orders.id,
          eventId: orders.eventId,
        })
        .from(orders)
        .where(
          and(
            eq(orders.status, OrderStatus.PENDING),
            lt(orders.expiresAt, now),
          ),
        )
        .for("update");
      const expiredSeatEvents = await tx
        .selectDistinct({ eventId: seats.eventId })
        .from(seats)
        .where(
          and(eq(seats.status, SeatStatus.HELD), lt(seats.holdExpiresAt, now)),
        );

      const affectedEventIds = Array.from(
        new Set([
          ...expiredOrders.map((item) => item.eventId),
          ...expiredSeatEvents.map((item) => item.eventId),
        ]),
      );
      if (expiredOrders.length === 0) {
        // Vẫn dọn các ghế rác nếu có trạng thái HELD mà quá hạn
        const releasedSeatRecords = await tx
          .update(seats)
          .set({
            status: SeatStatus.AVAILABLE,
            holdOrderId: null,
            holdExpiresAt: null,
            version: sql`${seats.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(seats.status, SeatStatus.HELD),
              lt(seats.holdExpiresAt, now),
            ),
          )
          .returning({ id: seats.id, eventId: seats.eventId });
        return {
          expiredOrdersCount: 0,
          affectedEventIds,
          releasedSeatRecords,
        };
      }

      const expiredOrderIds = expiredOrders.map((o) => o.id);

      // Cập nhật đơn hàng thành EXPIRED
      await tx
        .update(orders)
        .set({ status: OrderStatus.EXPIRED, updatedAt: now })
        .where(inArray(orders.id, expiredOrderIds));

      // Giải phóng ghế thuộc các đơn hết hạn
      const releasedSeatRecords = await tx
        .update(seats)
        .set({
          status: SeatStatus.AVAILABLE,
          holdOrderId: null,
          holdExpiresAt: null,
          version: sql`${seats.version} + 1`,
          updatedAt: now,
        })
        .where(
          or(
            inArray(seats.holdOrderId, expiredOrderIds),
            and(
              eq(seats.status, SeatStatus.HELD),
              lt(seats.holdExpiresAt, now),
            ),
          ),
        )
        .returning({ id: seats.id, eventId: seats.eventId });

      // Hoàn trả held_count cho vé đứng thuộc các đơn hết hạn
      const standingOrderItems = await tx
        .select({
          ticketTypeId: orderItems.ticketTypeId,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(
          and(
            inArray(orderItems.orderId, expiredOrderIds),
            sql`${orderItems.seatId} IS NULL`,
          ),
        );

      for (const item of standingOrderItems) {
        await tx
          .update(ticketTypes)
          .set({
            heldCount: sql`GREATEST(0, ${ticketTypes.heldCount} - ${item.quantity})`,
            updatedAt: now,
          })
          .where(eq(ticketTypes.id, item.ticketTypeId));
      }

      return {
        expiredOrdersCount: expiredOrderIds.length,
        affectedEventIds,
        releasedSeatRecords,
      };
    });
    await Promise.all(
      result.affectedEventIds.map((eventId) =>
        this.eventReadCacheService.invalidate(eventId),
      ),
    );

    if (result.releasedSeatRecords && result.releasedSeatRecords.length > 0) {
      const seatsByEvent = new Map<string, string[]>();
      for (const s of result.releasedSeatRecords) {
        const list = seatsByEvent.get(s.eventId) || [];
        list.push(s.id);
        seatsByEvent.set(s.eventId, list);
      }
      for (const [eventId, seatIds] of seatsByEvent.entries()) {
        await this.seatStreamService.publishSeatStatusChanged(eventId, {
          seatIds,
          status: "AVAILABLE",
          expiresAt: null,
        });
      }
    }

    return {
      expiredOrdersCount: result.expiredOrdersCount,
    };
  }
}
