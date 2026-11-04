import { ServiceUnavailableException } from "@nestjs/common";
import type Redis from "ioredis";

// Chi boc thao tac Redis; loi database va loi nghiep vu duoc giu nguyen.
export async function waitingRoomRedis<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new ServiceUnavailableException({
      success: false,
      error: {
        code: "WAITING_ROOM_UNAVAILABLE",
        message: "Hang cho tam thoi khong kha dung, vui long thu lai",
      },
    });
  }
}

export async function clearWaitingRoom(redis: Redis, eventId: string) {
  await waitingRoomRedis(() =>
    redis.eval(
      `
      local users = redis.call("ZRANGE", KEYS[1], 0, -1)
      local active = redis.call("SMEMBERS", KEYS[2])
      for _, userId in ipairs(users) do
        redis.call("DEL", ARGV[1] .. userId)
      end
      for _, userId in ipairs(active) do
        redis.call("DEL", ARGV[1] .. userId)
      end
      redis.call("DEL", KEYS[1], KEYS[2])
      redis.call("SREM", KEYS[3], ARGV[2])
      return 1
      `,
      3,
      `waiting_room:${eventId}`,
      `active_users:${eventId}`,
      "w03:waiting-room:events",
      `w03:waiting-room:hb:${eventId}:`,
      eventId,
    ),
  );
}
