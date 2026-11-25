import type { LatencySummary } from "./stats.ts";

/**
 * Service level objectives (Prompt 28, docs/operations/slo.md). Latency targets are for
 * production; the CI runner is smaller and shares one machine between the database, the
 * API and the load generator, so a miss there is reported, not fatal. Correctness checks
 * (quotas never over-granted, every alert delivered) always fail the run.
 */
export interface LatencyTarget {
  name: string;
  p95Ms: number;
  p99Ms: number;
  maxErrorRate: number;
}

export const TARGETS: Record<string, LatencyTarget> = {
  search: { name: "Provider search near a point", p95Ms: 500, p99Ms: 1_000, maxErrorRate: 0.005 },
  requestCreate: {
    name: "Create a service request (quota check)",
    p95Ms: 800,
    p99Ms: 1_500,
    maxErrorRate: 0.005,
  },
  messageSend: { name: "Send a message (API)", p95Ms: 500, p99Ms: 1_000, maxErrorRate: 0.005 },
  messageDelivery: {
    name: "Message delivered to every group member's socket",
    p95Ms: 1_000,
    p99Ms: 2_000,
    maxErrorRate: 0,
  },
  emergencyFanout: {
    name: "Alert raised → push sent to every contact",
    p95Ms: 5_000,
    p99Ms: 10_000,
    maxErrorRate: 0,
  },
};

export interface Verdict {
  key: string;
  target: LatencyTarget;
  summary: LatencySummary;
  met: boolean;
  misses: string[];
}

export function evaluate(key: string, summary: LatencySummary): Verdict {
  const target = TARGETS[key];
  if (!target) throw new Error(`no SLO target for ${key}`);
  const misses: string[] = [];
  if (summary.p95 > target.p95Ms)
    misses.push(`p95 ${String(summary.p95)} ms > ${String(target.p95Ms)} ms`);
  if (summary.p99 > target.p99Ms)
    misses.push(`p99 ${String(summary.p99)} ms > ${String(target.p99Ms)} ms`);
  if (summary.errorRate > target.maxErrorRate) {
    misses.push(`error rate ${String(summary.errorRate)} > ${String(target.maxErrorRate)}`);
  }
  if (summary.count === 0) misses.push("no successful samples");
  return { key, target, summary, met: misses.length === 0, misses };
}
