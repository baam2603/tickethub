import { Module, Global } from "@nestjs/common";
import Redis from "ioredis";
import { env } from "../config/env.config";

export const REDIS_CLIENT = "REDIS_CLIENT";

export function createRedisClient(url = env.REDIS_URL) {
  return new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1000,
    commandTimeout: 1000,
    retryStrategy: (times) => Math.min(times * 100, 1000),
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => createRedisClient(),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
