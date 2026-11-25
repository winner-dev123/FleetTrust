/** Latency statistics for load results (milliseconds). */

export interface LatencySummary {
  count: number;
  errors: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  /** Requests per second over the measured window. */
  throughput: number;
  /** errors / (count + errors). */
  errorRate: number;
}

/** Nearest-rank percentile of a sorted list (p in 0..100). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

const round = (value: number) => Math.round(value * 10) / 10;

export function summarize(
  latencies: readonly number[],
  errors: number,
  windowMs: number,
): LatencySummary {
  const sorted = [...latencies].sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);
  const attempts = sorted.length + errors;
  return {
    count: sorted.length,
    errors,
    min: round(sorted[0] ?? 0),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted.at(-1) ?? 0),
    mean: round(sorted.length === 0 ? 0 : total / sorted.length),
    throughput: round(windowMs <= 0 ? 0 : (sorted.length / windowMs) * 1000),
    errorRate: attempts === 0 ? 0 : Math.round((errors / attempts) * 10_000) / 10_000,
  };
}

export interface LoadOptions {
  /** Requests in flight at once. */
  concurrency: number;
  /** Stop after this long, or after `total` requests, whichever comes first. */
  durationMs?: number;
  total?: number;
}

export interface LoadResult {
  latencies: number[];
  errors: number;
  windowMs: number;
  /** A few error messages for the report. */
  samples: string[];
}

/**
 * Closed-loop load: `concurrency` workers each run `task` back to back. A task resolves on
 * success and throws on failure; its time counts only when it succeeds.
 */
export async function runLoad(
  task: (i: number) => Promise<void>,
  options: LoadOptions,
): Promise<LoadResult> {
  const latencies: number[] = [];
  const samples: string[] = [];
  let errors = 0;
  let next = 0;
  const started = performance.now();
  const deadline = options.durationMs === undefined ? Infinity : started + options.durationMs;
  const total = options.total ?? Infinity;
  const worker = async () => {
    while (performance.now() < deadline && next < total) {
      const i = next++;
      const t0 = performance.now();
      try {
        await task(i);
        latencies.push(performance.now() - t0);
      } catch (error) {
        errors += 1;
        if (samples.length < 5) samples.push((error as Error).message.slice(0, 200));
      }
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  return { latencies, errors, windowMs: performance.now() - started, samples };
}
