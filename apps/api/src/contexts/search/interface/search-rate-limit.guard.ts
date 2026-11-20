import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import Redis from "ioredis";
import { createHash } from "node:crypto";
import { REDIS_CLIENT } from "../../../database/redis.module";

// Gioi han 30 yeu cau tim kiem / phut / IP
const SEARCH_RATE_LIMIT = 30;

const RATE_LIMIT_SCRIPT = `
  local count = redis.call("INCR", KEYS[1])
  if count == 1 then
    redis.call("EXPIRE", KEYS[1], 70)
  end
  return count
`;

@Injectable()
export class SearchRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(SearchRateLimitGuard.name);

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const ip = request.ip || "unknown-ip";
    const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 24);

    const now = Date.now();
    const windowId = Math.floor(now / 60000);
    const key = `w03:rl:search:${ipHash}:${windowId}`;

    let count: number;
    try {
      const result = await this.redis.eval(RATE_LIMIT_SCRIPT, 1, key);
      count = Number(result);
    } catch (error) {
      // Fail-open: khi Redis gap su co, van cho phep tim kiem doc tu Postgres
      this.logger.warn(
        `Redis rate limit failed, failing open: ${String(error)}`,
      );
      return true;
    }

    if (count > SEARCH_RATE_LIMIT) {
      const retryAfter = Math.max(1, Math.ceil((60000 - (now % 60000)) / 1000));
      const response = context.switchToHttp().getResponse<FastifyReply>();
      response.header("Retry-After", String(retryAfter));

      throw new HttpException(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Qua nhieu yeu cau tim kiem, vui long thu lai",
            retryAfterSeconds: retryAfter,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
