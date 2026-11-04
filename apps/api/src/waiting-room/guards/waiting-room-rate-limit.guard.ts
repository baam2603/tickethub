import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest, FastifyReply } from "fastify";
import Redis from "ioredis";
import { createHash } from "node:crypto";
import { REDIS_CLIENT } from "../../database/redis.module";

type RateAction = "join" | "heartbeat";

export const WAITING_ROOM_RATE_ACTION = "waiting_room_rate_action";

// Atomic Redis counter
const RATE_LIMIT_SCRIPT = `
  local count = redis.call("INCR", KEYS[1])

  if count == 1 then
    redis.call("EXPIRE", KEYS[1], 70)
  end

  return count
`;

@Injectable()
export class WaitingRoomRateLimitGuard implements CanActivate {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,

    @Inject(Reflector)
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const action =
      this.reflector.get<RateAction>(
        WAITING_ROOM_RATE_ACTION,
        context.getHandler(),
      ) ?? "join";

    // Heartbeat goi moi 15s nen can quota cao hon
    const maxRequests = action === "heartbeat" ? 600 : 20;

    // Lay IP do Fastify xac dinh
    const ip = request.ip;

    const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 24);

    const now = Date.now();
    const windowId = Math.floor(now / 60000);

    const key = `w03:rl:${action}:${ipHash}:${windowId}`;

    let count: number;

    try {
      // EVAL dam bao INCR va EXPIRE la atomic
      const result = await this.redis.eval(RATE_LIMIT_SCRIPT, 1, key);

      count = Number(result);

      if (!Number.isFinite(count)) {
        throw new Error("Invalid Redis counter");
      }
    } catch {
      // Waiting Room phu thuoc Redis.
      // Khong bo qua rate limit khi Redis loi.
      throw new ServiceUnavailableException({
        success: false,
        error: {
          code: "WAITING_ROOM_UNAVAILABLE",
          message: "Hang cho tam thoi khong kha dung, vui long thu lai",
        },
      });
    }

    if (count > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((60000 - (now % 60000)) / 1000));

      const response = context.switchToHttp().getResponse<FastifyReply>();

      response.header("Retry-After", String(retryAfter));

      throw new HttpException(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Qua nhieu yeu cau, vui long thu lai",
            retryAfterSeconds: retryAfter,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
