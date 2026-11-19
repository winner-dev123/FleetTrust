import type { RateLimiter, RateLimitResult } from "./rate-limiter.js";

/** The one Redis capability the limiter needs (node-redis `eval`), kept structural for tests. */
export interface RedisEval {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

/**
 * Atomically increments the window counter and sets its expiry on first use, so a counter
 * can never be left without a TTL. Returns [count, ttlSeconds].
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

/** Shared fixed-window limiter backed by Redis (Memorystore in deployed environments). */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly client: RedisEval,
    private readonly prefix = "fleettrust:rl",
  ) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const reply = (await this.client.eval(HIT_SCRIPT, {
      keys: [`${this.prefix}:${key}`],
      arguments: [String(windowSeconds)],
    })) as [number, number];
    const [count, ttl] = reply;
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, ttl),
    };
  }
}
