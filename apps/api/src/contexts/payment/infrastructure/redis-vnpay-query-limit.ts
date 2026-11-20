import type Redis from "ioredis";

const TAKE_QUERY_SLOT = `
  local attempts = tonumber(redis.call("GET", KEYS[1]) or "0")
  if attempts >= 3 then
    return 0
  end
  if attempts == 0 then
    redis.call("SET", KEYS[1], 1, "EX", 60)
  else
    redis.call("INCR", KEYS[1])
  end
  return 1
`;

export function createVnpayQueryLimit(redis: Redis) {
  return async (userId: string): Promise<boolean> =>
    (await redis.eval(TAKE_QUERY_SLOT, 1, `payment:querydr:${userId}`)) === 1;
}
