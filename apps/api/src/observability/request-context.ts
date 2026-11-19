import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Accept a caller's request ID only if it is short and boring; otherwise mint a new one. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function resolveRequestId(incoming: string | readonly string[] | undefined): string {
  const candidate = typeof incoming === "string" ? incoming : incoming?.[0];
  return typeof candidate === "string" && SAFE_REQUEST_ID.test(candidate)
    ? candidate
    : randomUUID();
}
