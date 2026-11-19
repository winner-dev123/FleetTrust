export interface RateLimitResult {
  allowed: boolean;
  /** Hits left in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the window resets; send as Retry-After when blocked. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limiter port. `hit` counts one attempt against `key` and reports
 * whether it is within `limit` attempts per `windowSeconds`.
 */
export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

export const RATE_LIMITER = Symbol("RATE_LIMITER");

/** In-process limiter for local development and tests. Not shared across instances. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (this.windows.size > 10_000) this.prune(now);

    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    return Promise.resolve({
      allowed: window.count <= limit,
      remaining: Math.max(0, limit - window.count),
      retryAfterSeconds,
    });
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}
