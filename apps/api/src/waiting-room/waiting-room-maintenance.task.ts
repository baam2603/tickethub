import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import Redis from "ioredis";
import { and, eq } from "drizzle-orm";
import { EventStatus } from "@tickethub/shared";

import { db } from "../database/db";
import { events } from "../database/schema";
import { clearWaitingRoom } from "./waiting-room.redis";
import { REDIS_CLIENT } from "../database/redis.module";

const PROMOTE_SCRIPT = `
  local activeKey = KEYS[1]
  local queueKey = KEYS[2]
  local maxActive = tonumber(ARGV[1])
  local heartbeatPrefix = ARGV[2]

  if redis.call("SCARD", activeKey) >= maxActive then
    return "FULL"
  end

  local first = redis.call("ZRANGE", queueKey, 0, 0)
  local userId = first[1]

  if not userId then
    return "EMPTY"
  end

  if redis.call("EXISTS", heartbeatPrefix .. userId) == 0 then
    redis.call("ZREM", queueKey, userId)
    return "STALE"
  end

  redis.call("ZREM", queueKey, userId)
  redis.call("SADD", activeKey, userId)

  return "PROMOTED"
`;

@Injectable()
export class WaitingRoomMaintenanceTask
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WaitingRoomMaintenanceTask.name);

  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.runMaintenance();
    }, 5000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async runMaintenance() {
    if (this.running) return;

    this.running = true;

    try {
      const eventIds = await this.redis.smembers("w03:waiting-room:events");

      for (const eventId of eventIds) {
        await this.maintainEvent(eventId);
      }
    } catch (error) {
      this.logger.error("Waiting room maintenance failed", error);
    } finally {
      this.running = false;
    }
  }

  private async maintainEvent(eventId: string) {
    const [event] = await db
      .select({
        status: events.status,
        maxActiveUsers: events.maxActiveUsers,
        isWaitingRoomEnabled: events.isWaitingRoomEnabled,
      })
      .from(events)
      .where(
        and(eq(events.id, eventId), eq(events.status, EventStatus.PUBLISHED)),
      )
      .limit(1);

    if (!event || !event.isWaitingRoomEnabled) {
      await clearWaitingRoom(this.redis, eventId);
      return;
    }

    const activeKey = `active_users:${eventId}`;
    const queueKey = `waiting_room:${eventId}`;
    const hbPrefix = `w03:waiting-room:hb:${eventId}:`;

    // Don cac phien active khong con heartbeat
    const activeUsers = await this.redis.smembers(activeKey);

    for (const userId of activeUsers) {
      const alive = await this.redis.exists(hbPrefix + userId);

      if (!alive) {
        await this.redis.srem(activeKey, userId);
      }
    }

    // Don nguoi xep hang da ngat ket noi
    const queuedUsers = await this.redis.zrange(queueKey, 0, "-1");

    for (const userId of queuedUsers) {
      const alive = await this.redis.exists(hbPrefix + userId);

      if (!alive) {
        await this.redis.zrem(queueKey, userId);
      }
    }

    // Promote toi da 100 luot moi chu ky.
    // Lua dam bao kiem tra suc chua va promote nguyen tu.
    for (let i = 0; i < 100; i++) {
      const result = await this.redis.eval(
        PROMOTE_SCRIPT,
        2,
        activeKey,
        queueKey,
        String(event.maxActiveUsers),
        hbPrefix,
      );

      if (result === "FULL" || result === "EMPTY") {
        break;
      }
    }
  }
}
