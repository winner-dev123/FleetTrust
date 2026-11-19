import type { IncomingMessage } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { clientIp } from "./client-ip.js";
import { MemoryRateLimiter } from "./rate-limiter.js";
import { RedisRateLimiter } from "./redis-rate-limiter.js";

describe("MemoryRateLimiter", () => {
  it("allows `limit` hits per window, then blocks until the window resets", async () => {
    let now = 1_000_000;
    const limiter = new MemoryRateLimiter(() => now);

    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.hit("k", 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]).toMatchObject({ remaining: 0, retryAfterSeconds: 60 });

    now += 30_000;
    expect((await limiter.hit("k", 3, 60)).retryAfterSeconds).toBe(30);

    now += 30_001;
    expect((await limiter.hit("k", 3, 60)).allowed).toBe(true);
  });

  it("keeps keys independent", async () => {
    const limiter = new MemoryRateLimiter();
    await limiter.hit("a", 1, 60);
    expect((await limiter.hit("a", 1, 60)).allowed).toBe(false);
    expect((await limiter.hit("b", 1, 60)).allowed).toBe(true);
  });
});

describe("RedisRateLimiter", () => {
  it("uses one atomic script per hit and maps the reply", async () => {
    const evalFn = vi.fn().mockResolvedValueOnce([1, 60]).mockResolvedValueOnce([4, 42]);
    const limiter = new RedisRateLimiter({ eval: evalFn }, "test");

    expect(await limiter.hit("login:ip:1.2.3.4", 3, 60)).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterSeconds: 60,
    });
    expect(await limiter.hit("login:ip:1.2.3.4", 3, 60)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 42,
    });
    expect(evalFn).toHaveBeenCalledWith(expect.stringContaining("INCR"), {
      keys: ["test:login:ip:1.2.3.4"],
      arguments: ["60"],
    });
  });
});

describe("clientIp", () => {
  const req = (xff: string | undefined, socket = "10.0.0.1") =>
    ({
      headers: xff === undefined ? {} : { "x-forwarded-for": xff },
      socket: { remoteAddress: socket },
    }) as unknown as IncomingMessage;

  it("uses the socket address when no proxies are trusted (and ignores spoofed headers)", () => {
    expect(clientIp(req("6.6.6.6"), 0)).toBe("10.0.0.1");
  });

  it("reads the address appended by the trusted proxy, not client-supplied entries", () => {
    // The client claims to be 6.6.6.6; Cloud Run's front end appended the real 203.0.113.9.
    expect(clientIp(req("6.6.6.6, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientIp(req("203.0.113.9"), 1)).toBe("203.0.113.9");
  });

  it("falls back to the socket address when the header is shorter than expected", () => {
    expect(clientIp(req(undefined), 1)).toBe("10.0.0.1");
    expect(clientIp(req("203.0.113.9"), 2)).toBe("10.0.0.1");
  });
});
