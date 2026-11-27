import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { CloudTasksJobWaker, type GoogleRequester, type JobWaker } from "./job-waker.js";
import { WAKE_DEBOUNCE_MS, WakeWorkerAfterWrites } from "./wake-after-writes.interceptor.js";

const QUEUE = "projects/p/locations/europe-west1/queues/fleettrust-jobs";
const WORKER = "https://fleettrust-worker-123.europe-west1.run.app";

function recorder(fail?: Error) {
  const calls: { url: string; data: { task: Record<string, unknown> } }[] = [];
  const client: GoogleRequester = {
    request: (options) => {
      calls.push(options as never);
      return fail === undefined ? Promise.resolve({ status: 200 }) : Promise.reject(fail);
    },
  };
  return { calls, client: () => Promise.resolve(client) };
}

describe("CloudTasksJobWaker", () => {
  it("creates an HTTP task to the worker's run path with an identity token for the jobs account", async () => {
    const r = recorder();
    await new CloudTasksJobWaker(
      QUEUE,
      WORKER,
      "fleettrust-jobs@p.iam.gserviceaccount.com",
      r.client,
    ).wake();
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]?.url).toBe(`https://cloudtasks.googleapis.com/v2/${QUEUE}/tasks`);
    expect(r.calls[0]?.data.task).toEqual({
      httpRequest: {
        url: `${WORKER}/internal/jobs/run`,
        httpMethod: "POST",
        oidcToken: {
          serviceAccountEmail: "fleettrust-jobs@p.iam.gserviceaccount.com",
          audience: WORKER,
        },
      },
      dispatchDeadline: "300s",
    });
  });

  it("schedules and names a wake-up when asked", async () => {
    const r = recorder();
    const at = new Date("2026-11-27T10:00:05Z");
    await new CloudTasksJobWaker(QUEUE, WORKER, "j@p", r.client).wake({
      at,
      dedupeKey: "due-1795..x",
    });
    expect(r.calls[0]?.data.task).toMatchObject({
      scheduleTime: "2026-11-27T10:00:05.000Z",
      name: `${QUEUE}/tasks/due-1795--x`,
    });
  });

  it("treats an existing task of the same name as done, and passes other errors on", async () => {
    const dup = recorder(Object.assign(new Error("exists"), { response: { status: 409 } }));
    await expect(
      new CloudTasksJobWaker(QUEUE, WORKER, "j@p", dup.client).wake({ dedupeKey: "a" }),
    ).resolves.toBeUndefined();
    const denied = recorder(Object.assign(new Error("denied"), { response: { status: 403 } }));
    await expect(
      new CloudTasksJobWaker(QUEUE, WORKER, "j@p", denied.client).wake(),
    ).rejects.toBeDefined();
  });
});

function context(method: string, url = "/v1/requests") {
  return {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => ({ method, url }) }),
  } as unknown as ExecutionContext;
}
const handler: CallHandler = { handle: () => of({ ok: true }) };

function interceptor(waker: JobWaker) {
  const i = new WakeWorkerAfterWrites(waker);
  let now = 1_000_000;
  i.now = () => now;
  return { i, advance: (ms: number) => (now += ms) };
}

describe("WakeWorkerAfterWrites", () => {
  it("wakes the worker before answering a successful write, not after reads", async () => {
    const wake = vi.fn(() => Promise.resolve());
    const { i } = interceptor({ wake });
    await expect(lastValueFrom(i.intercept(context("GET"), handler))).resolves.toEqual({
      ok: true,
    });
    expect(wake).not.toHaveBeenCalled();
    await expect(lastValueFrom(i.intercept(context("POST"), handler))).resolves.toEqual({
      ok: true,
    });
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("wakes at most once per window, except for emergency routes", async () => {
    const wake = vi.fn(() => Promise.resolve());
    const { i, advance } = interceptor({ wake });
    await lastValueFrom(i.intercept(context("POST"), handler));
    await lastValueFrom(i.intercept(context("PATCH"), handler));
    expect(wake).toHaveBeenCalledTimes(1);
    await lastValueFrom(i.intercept(context("POST", "/v1/emergency/incidents"), handler));
    expect(wake).toHaveBeenCalledTimes(2);
    advance(WAKE_DEBOUNCE_MS);
    await lastValueFrom(i.intercept(context("DELETE"), handler));
    expect(wake).toHaveBeenCalledTimes(3);
  });

  it("never fails the request when the wake-up fails, and tries again on the next write", async () => {
    const wake = vi.fn().mockRejectedValueOnce(new Error("quota")).mockResolvedValue(undefined);
    const { i } = interceptor({ wake });
    await expect(lastValueFrom(i.intercept(context("POST"), handler))).resolves.toEqual({
      ok: true,
    });
    await lastValueFrom(i.intercept(context("POST"), handler));
    expect(wake).toHaveBeenCalledTimes(2);
  });
});
