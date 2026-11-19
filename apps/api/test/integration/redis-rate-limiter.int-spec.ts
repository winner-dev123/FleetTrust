import { randomUUID } from "node:crypto";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RedisRateLimiter } from "../../src/platform/rate-limit/index.js";

/**
 * Real Redis (Compose locally, `local-infra` job in CI). Skipped without REDIS_URL unless
 * REQUIRE_INTEGRATION=1, which turns a missing service into a failure.
 */
const url = process.env["REDIS_URL"];
if (process.env["REQUIRE_INTEGRATION"] === "1" && !url) {
  throw new Error("REQUIRE_INTEGRATION=1 but REDIS_URL is not set");
}

describe.skipIf(!url)("RedisRateLimiter against real Redis", () => {
  const client = createClient({ url: url ?? "" });
  let limiter: RedisRateLimiter;

  beforeAll(async () => {
    await client.connect();
    limiter = new RedisRateLimiter(client, `it:${randomUUID()}`);
  });

  afterAll(async () => {
    await client.close();
  });

  it("allows `limit` hits per window and reports a TTL-based Retry-After", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.hit("seq", 3, 30));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]?.retryAfterSeconds).toBeGreaterThan(0);
    expect(results[3]?.retryAfterSeconds).toBeLessThanOrEqual(30);
  });

  it("is atomic under concurrency: exactly `limit` of many parallel hits succeed", async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, () => limiter.hit("burst", 10, 30)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it("always sets an expiry, so counters can never stick forever", async () => {
    await limiter.hit("ttl", 5, 30);
    const keys = await client.keys("it:*:ttl");
    expect(keys).toHaveLength(1);
    expect(await client.ttl(keys[0] ?? "")).toBeGreaterThan(0);
  });
});
