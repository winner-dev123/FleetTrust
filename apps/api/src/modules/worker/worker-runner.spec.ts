import { describe, expect, it, vi } from "vitest";

import type { ApiEnv } from "../../config/env.js";
import type { JobWaker } from "../../platform/worker-wake/index.js";
import type { EmergencyDispatcher } from "../emergency/index.js";
import type { OutboxRelay } from "../notifications/index.js";
import { type PendingWork, WorkerRunner } from "./worker-runner.js";

const T0 = new Date("2026-11-27T10:00:00Z").getTime();

/** A runner with fakes; `script` gives the pending work after each pass (the last one repeats). */
function setup(script: PendingWork[], options: { runMs?: number; tickFails?: boolean } = {}) {
  let now = T0;
  const env = {
    EMERGENCY_TICK_MS: 1_000,
    OUTBOX_RELAY_INTERVAL_MS: 2_000,
    WORKER_RUN_MS: options.runMs ?? 50_000,
  } as ApiEnv;
  const tick = vi.fn(() =>
    options.tickFails
      ? Promise.reject(new Error("db down"))
      : Promise.resolve({ sent: 0, failed: 0 }),
  );
  const drain = vi.fn(() => Promise.resolve({ published: 0, failed: 0 }));
  const wake = vi.fn<JobWaker["wake"]>(() => Promise.resolve());
  const runner = new WorkerRunner(
    null,
    env,
    { now: () => new Date(now) },
    { wake },
    { tick } as unknown as EmergencyDispatcher,
    { drain } as unknown as OutboxRelay,
  );
  let i = 0;
  runner.pending = () => Promise.resolve(script[Math.min(i++, script.length - 1)] as PendingWork);
  runner.sleep = (ms) => {
    now += ms;
    return Promise.resolve();
  };
  return { runner, tick, drain, wake, now: () => now };
}

const idle: PendingWork = { activeIncident: false, nextDueAt: null };
const emergency: PendingWork = { activeIncident: true, nextDueAt: null };

describe("WorkerRunner (WORKER_MODE=on-demand)", () => {
  it("does a few quiet passes and stops without booking anything when there is no work", async () => {
    const { runner, tick, drain, wake } = setup([idle]);
    await expect(runner.run()).resolves.toEqual({ passes: 3 });
    expect(tick).toHaveBeenCalledTimes(3);
    expect(drain).toHaveBeenCalledTimes(3);
    expect(wake).not.toHaveBeenCalled();
  });

  it("ticks every second while an emergency is active, then hands over at once", async () => {
    const { runner, tick, wake, now } = setup([emergency], { runMs: 10_000 });
    const { passes } = await runner.run();
    expect(passes).toBe(10); // one pass per second for the whole run
    expect(tick).toHaveBeenCalledTimes(10);
    expect(now() - T0).toBe(9_000);
    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake.mock.calls[0]?.[0]).toEqual({
      dedupeKey: `continue-${String(Math.floor((T0 + 9_000) / 10_000))}`,
    });
  });

  it("keeps going while work is due, then books a run for the next retry", async () => {
    const retryAt = new Date(T0 + 45_000);
    const { runner, wake } = setup([
      { activeIncident: false, nextDueAt: new Date(T0) },
      { activeIncident: false, nextDueAt: retryAt },
    ]);
    const { passes } = await runner.run();
    expect(passes).toBe(4); // 1 busy pass, then 3 quiet ones
    expect(wake).toHaveBeenCalledWith({
      at: retryAt,
      dedupeKey: `due-${String(Math.floor(retryAt.getTime() / 1000))}`,
    });
  });

  it("a request during a run joins it and makes it do another pass", async () => {
    const { runner } = setup([idle]);
    const first = runner.run();
    const second = runner.run();
    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ passes: 4 });
  });

  it("still relays the outbox when the emergency pass fails, and never throws on booking errors", async () => {
    const { runner, drain, wake } = setup([emergency], { runMs: 3_000, tickFails: true });
    wake.mockRejectedValue(new Error("queue missing"));
    await expect(runner.run()).resolves.toEqual({ passes: 3 });
    expect(drain).toHaveBeenCalledTimes(3);
    expect(wake).toHaveBeenCalledTimes(1);
  });
});
