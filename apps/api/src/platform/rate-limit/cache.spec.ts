import { describe, expect, it } from "vitest";

import { MemoryCache, RedisCache, type RedisKeyValue } from "./cache.js";

describe("MemoryCache", () => {
  it("expires entries after their TTL and ignores TTL 0", async () => {
    let now = 1_000;
    const cache = new MemoryCache(10, () => now);
    await cache.set("a", "1", 60);
    await cache.set("b", "2", 0);
    expect(await cache.get("a")).toBe("1");
    expect(await cache.get("b")).toBeNull();
    now += 60_000;
    expect(await cache.get("a")).toBeNull();
  });

  it("evicts the oldest entries beyond its capacity", async () => {
    const cache = new MemoryCache(2);
    await cache.set("a", "1", 60);
    await cache.set("b", "2", 60);
    await cache.set("c", "3", 60);
    expect(cache.size).toBe(2);
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("c")).toBe("3");
  });
});

describe("RedisCache", () => {
  it("is best effort: errors and a disconnected client behave like a miss", async () => {
    const failing: RedisKeyValue = {
      isReady: true,
      get: () => Promise.reject(new Error("boom")),
      set: () => Promise.reject(new Error("boom")),
    };
    const cache = new RedisCache(failing);
    expect(await cache.get("k")).toBeNull();
    await expect(cache.set("k", "v", 60)).resolves.toBeUndefined();

    const calls: unknown[] = [];
    const offline: RedisKeyValue = {
      isReady: false,
      get: () => Promise.resolve("never"),
      set: (...args) => {
        calls.push(args);
        return Promise.resolve();
      },
    };
    expect(await new RedisCache(offline).get("k")).toBeNull();
    await new RedisCache(offline).set("k", "v", 60);
    expect(calls).toEqual([]);
  });

  it("prefixes keys and sets an expiry", async () => {
    const calls: unknown[] = [];
    const client: RedisKeyValue = {
      isReady: true,
      get: () => Promise.resolve(null),
      set: (...args) => {
        calls.push(args);
        return Promise.resolve();
      },
    };
    await new RedisCache(client).set("route:x", "v", 59.5);
    expect(calls).toEqual([["fleettrust:cache:route:x", "v", { EX: 60 }]]);
  });
});
