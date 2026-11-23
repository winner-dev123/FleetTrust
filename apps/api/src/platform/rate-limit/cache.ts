/**
 * Small shared key-value cache with per-entry TTL. Redis-backed when REDIS_URL is set (shared
 * across instances), otherwise in-memory. Callers must treat it as best-effort: a failure or
 * miss is never an error. Values are strings (serialise JSON yourself).
 */
export interface KeyValueCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export const CACHE = Symbol("CACHE");

/** Bounded in-memory cache (local development and tests). Oldest entries are evicted first. */
export class MemoryCache implements KeyValueCache {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 1_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return Promise.resolve();
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return Promise.resolve();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** The node-redis calls the cache needs, kept structural for tests. */
export interface RedisKeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  readonly isReady: boolean;
}

export class RedisCache implements KeyValueCache {
  constructor(
    private readonly client: RedisKeyValue,
    private readonly prefix = "fleettrust:cache",
  ) {}

  async get(key: string): Promise<string | null> {
    if (!this.client.isReady) return null;
    try {
      return await this.client.get(`${this.prefix}:${key}`);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0 || !this.client.isReady) return;
    try {
      await this.client.set(`${this.prefix}:${key}`, value, { EX: Math.ceil(ttlSeconds) });
    } catch {
      // Best effort: a cache write failure never fails the request.
    }
  }
}
