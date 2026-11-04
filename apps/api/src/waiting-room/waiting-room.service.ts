import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import Redis from "ioredis";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../database/db";
import { events, orders, seats, ticketTypes } from "../database/schema";
import { REDIS_CLIENT } from "../database/redis.module";
import { env } from "../config/env.config";
import { EventStatus, OrderStatus, SeatStatus } from "@tickethub/shared";
import { clearWaitingRoom, waitingRoomRedis } from "./waiting-room.redis";

export interface WaitingRoomStatus {
  status: "ADMITTED" | "QUEUED" | "SOLD_OUT";
  orderId?: string;
  admissionToken?: string;
  queuePosition?: number;
  estimatedWaitSeconds?: number;
  queueId?: string;
}

@Injectable()
export class WaitingRoomService {
  private readonly HEARTBEAT_TTL = 60;

  private heartbeatKey(eventId: string, userId: string) {
    return `w03:waiting-room:hb:${eventId}:${userId}`;
  }

  private async touchHeartbeat(eventId: string, userId: string): Promise<void> {
    await this.redis
      .multi()
      .set(this.heartbeatKey(eventId, userId), "1", "EX", this.HEARTBEAT_TTL)
      .sadd("w03:waiting-room:events", eventId)
      .exec();
  }

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwtService: JwtService,
  ) {}

  async generateAdmissionToken(
    userId: string,
    eventId: string,
  ): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: userId,
        eventId,
        type: "waiting_room_admission",
      },
      {
        secret: env.JWT_SECRET,
        expiresIn: 600, // 10 phút theo đặc tả
      },
    );
  }

  async verifyAdmissionToken(
    token: string,
    eventId: string,
    userId: string,
  ): Promise<boolean> {
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: env.JWT_SECRET,
      });

      // Xac thuc danh tinh va pham vi token
      if (
        payload.type !== "waiting_room_admission" ||
        payload.sub !== userId ||
        payload.eventId !== eventId
      ) {
        return false;
      }

      // Kiem tra su kien con duoc phep ban ve
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
          status: true,
          isWaitingRoomEnabled: true,
        },
      });

      if (!event || event.status !== EventStatus.PUBLISHED) {
        return false;
      }

      // Su kien khong bat waiting room:
      // JWT hop le la du.
      if (!event.isWaitingRoomEnabled) {
        return true;
      }

      // Su kien bat waiting room:
      // Bat buoc phien Redis van active.
      const [isActive, heartbeatAlive] = await Promise.all([
        this.redis.sismember(`active_users:${eventId}`, userId),
        this.redis.exists(`w03:waiting-room:hb:${eventId}:${userId}`),
      ]);

      return isActive === 1 && heartbeatAlive === 1;
    } catch {
      return false;
    }
  }

  private async prepareEntry(
    userId: string,
    eventId: string,
  ): Promise<{
    event: typeof events.$inferSelect;
    result: WaitingRoomStatus | undefined;
  }> {
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
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

    // Don dang giu duoc uu tien, chi lay don cua chinh nguoi dang dang nhap.
    const pending = await db.query.orders.findFirst({
      where: and(
        eq(orders.userId, userId),
        eq(orders.eventId, eventId),
        eq(orders.status, OrderStatus.PENDING),
        gt(orders.expiresAt, new Date()),
      ),
      orderBy: [desc(orders.createdAt), desc(orders.id)],
    });
    if (pending) {
      await waitingRoomRedis(() =>
        this.redis.zrem(`waiting_room:${eventId}`, userId),
      );
      return {
        event,
        result: {
          status: "ADMITTED",
          orderId: pending.id,
        },
      };
    }

    if (!event.isWaitingRoomEnabled) {
      await clearWaitingRoom(this.redis, eventId);
      const admissionToken = await this.generateAdmissionToken(userId, eventId);
      return {
        event,
        result: { status: "ADMITTED", admissionToken },
      };
    }

    // Ghe HELD chua phai ve da ban. Khong bao SOLD_OUT khi ve chi tam giu.
    const [inventory] = await db.execute<{
      remaining: boolean;
    }>(sql`select exists (
        select 1 from ${ticketTypes}
        where ${ticketTypes.eventId} = ${eventId}
        and (
          (${ticketTypes.isSeated} = false and ${ticketTypes.soldCount} < ${ticketTypes.capacity})
          or (${ticketTypes.isSeated} = true and exists (
            select 1 from ${seats}
            where ${seats.ticketTypeId} = ${ticketTypes.id}
            and ${seats.status} in (${SeatStatus.AVAILABLE}, ${SeatStatus.HELD})
          ))
        )
      ) as remaining`);
    if (!inventory?.remaining) {
      await clearWaitingRoom(this.redis, eventId);
      return { event, result: { status: "SOLD_OUT" } };
    }
    return { event, result: undefined };
  }

  async joinQueue(userId: string, eventId: string): Promise<WaitingRoomStatus> {
    const { event, result } = await this.prepareEntry(userId, eventId);
    if (result) return result;
    return waitingRoomRedis(() => this.joinRedis(userId, event));
  }

  private async joinRedis(
    userId: string,
    event: typeof events.$inferSelect,
  ): Promise<WaitingRoomStatus> {
    const eventId = event.id;
    const activeKey = `active_users:${eventId}`;
    const queueKey = `waiting_room:${eventId}`;

    // Kiểm tra xem người dùng đã nằm trong danh sách active chưa

    const isAlreadyActive = await this.redis.sismember(activeKey, userId);

    if (isAlreadyActive) {
      const isAlive = await this.redis.exists(
        this.heartbeatKey(eventId, userId),
      );

      if (isAlive) {
        await this.touchHeartbeat(eventId, userId);

        const admissionToken = await this.generateAdmissionToken(
          userId,
          eventId,
        );

        return {
          status: "ADMITTED",
          admissionToken,
        };
      }

      // Phien cu het han: loai khoi active
      await this.redis.srem(activeKey, userId);
    }

    const [activeCount, queueLen] = await Promise.all([
      this.redis.scard(activeKey),
      this.redis.zcard(queueKey),
    ]);

    // Nếu số người active còn dưới ngưỡng và hàng chờ đang rỗng -> Vào thẳng
    if (activeCount < event.maxActiveUsers && queueLen === 0) {
      await this.redis.sadd(activeKey, userId);
      await this.touchHeartbeat(eventId, userId);
      const admissionToken = await this.generateAdmissionToken(userId, eventId);
      return {
        status: "ADMITTED",
        admissionToken,
      };
    }

    const oldRank = await this.redis.zrank(queueKey, userId);

    if (
      oldRank !== null &&
      !(await this.redis.exists(this.heartbeatKey(eventId, userId)))
    ) {
      await this.redis.zrem(queueKey, userId);
    }
    // Xếp hàng vào Redis Sorted Set với điểm số là thời điểm gia nhập
    let rank = await this.redis.zrank(queueKey, userId);
    if (rank === null) {
      await this.redis.zadd(queueKey, Date.now(), userId);
      rank = await this.redis.zrank(queueKey, userId);
    }

    const position = (rank ?? 0) + 1;
    const estimatedWaitSeconds = Math.max(15, position * 15);
    await this.touchHeartbeat(eventId, userId);
    return {
      status: "QUEUED",
      queuePosition: position,
      estimatedWaitSeconds,
      queueId: `q_${userId}_${eventId}`,
    };
  }

  async heartbeat(userId: string, eventId: string): Promise<WaitingRoomStatus> {
    const { event, result } = await this.prepareEntry(userId, eventId);
    if (result) return result;
    return waitingRoomRedis(() => this.heartbeatRedis(userId, event));
  }

  private async heartbeatRedis(
    userId: string,
    event: typeof events.$inferSelect,
  ): Promise<WaitingRoomStatus> {
    const eventId = event.id;
    const activeKey = `active_users:${eventId}`;
    const queueKey = `waiting_room:${eventId}`;

    const isAlreadyActive = await this.redis.sismember(activeKey, userId);

    if (isAlreadyActive) {
      const alive = await this.redis.exists(this.heartbeatKey(eventId, userId));

      if (!alive) {
        await this.redis.srem(activeKey, userId);
        return this.joinRedis(userId, event);
      }

      await this.touchHeartbeat(eventId, userId);

      const admissionToken = await this.generateAdmissionToken(userId, eventId);

      return {
        status: "ADMITTED",
        admissionToken,
      };
    }

    const [activeCount, rank] = await Promise.all([
      this.redis.scard(activeKey),
      this.redis.zrank(queueKey, userId),
    ]);

    if (rank === null) {
      // Chưa có trong hàng chờ, gọi joinQueue
      return this.joinRedis(userId, event);
    }

    const heartbeatAlive = await this.redis.exists(
      this.heartbeatKey(eventId, userId),
    );

    if (!heartbeatAlive) {
      await this.redis.zrem(queueKey, userId);
      return this.joinRedis(userId, event);
    }

    await this.touchHeartbeat(eventId, userId);

    // Nếu đứng đầu hàng chờ và còn chỗ trống -> Nhận vào (promote)
    if (rank === 0 && activeCount < event.maxActiveUsers) {
      await Promise.all([
        this.redis.zrem(queueKey, userId),
        this.redis.sadd(activeKey, userId),
      ]);

      const admissionToken = await this.generateAdmissionToken(userId, eventId);
      return {
        status: "ADMITTED",
        admissionToken,
      };
    }

    const position = rank + 1;
    const estimatedWaitSeconds = Math.max(15, position * 15);

    return {
      status: "QUEUED",
      queuePosition: position,
      estimatedWaitSeconds,
      queueId: `q_${userId}_${eventId}`,
    };
  }

  async leaveActive(userId: string, eventId: string): Promise<void> {
    await this.redis.srem(`active_users:${eventId}`, userId);
    await this.redis.del(this.heartbeatKey(eventId, userId));
  }
}
