import { describe, expect, it } from "vitest";

import { evaluate } from "../src/slo.ts";
import { percentile, runLoad, summarize } from "../src/stats.ts";

describe("latency statistics", () => {
  it("uses nearest-rank percentiles", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 95)).toBe(0);
  });

  it("summarizes throughput and error rate", () => {
    const summary = summarize([10, 20, 30, 40], 1, 2_000);
    expect(summary).toMatchObject({
      count: 4,
      errors: 1,
      min: 10,
      max: 40,
      mean: 25,
      throughput: 2,
      errorRate: 0.2,
    });
  });
});

describe("load runner", () => {
  it("keeps the requested concurrency and counts failures separately", async () => {
    let inFlight = 0;
    let peak = 0;
    const result = await runLoad(
      async (i) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        if (i % 10 === 0) throw new Error(`failed ${String(i)}`);
      },
      { concurrency: 4, total: 40 },
    );
    expect(peak).toBe(4);
    expect(result.latencies).toHaveLength(36);
    expect(result.errors).toBe(4);
    expect(result.samples[0]).toBe("failed 0");
  });
});

describe("SLO evaluation", () => {
  it("reports each missed target", () => {
    const ok = evaluate("search", summarize([100, 200, 300], 0, 1_000));
    expect(ok.met).toBe(true);
    const slow = evaluate(
      "search",
      summarize(
        Array.from({ length: 100 }, () => 900),
        1,
        1_000,
      ),
    );
    expect(slow.met).toBe(false);
    expect(slow.misses.join("; ")).toMatch(/p95 900 ms > 400 ms.*error rate/);
  });
});
