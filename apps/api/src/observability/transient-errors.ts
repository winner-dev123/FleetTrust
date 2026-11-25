/**
 * Errors that mean "busy, try again", not "broken" (Prompt 28). The API answers them with
 * 503 `overloaded` and Retry-After, so clients back off and retry with the same idempotency
 * key instead of seeing a generic 500.
 *
 * - The connection pool had no free connection in time (pg-pool's connect timeout).
 * - PostgreSQL refused or aborted the work for load or concurrency reasons.
 */
const TRANSIENT_MESSAGES = [
  "timeout exceeded when trying to connect",
  "Connection terminated due to connection timeout",
];

const TRANSIENT_SQLSTATES = new Set([
  "53300", // too_many_connections
  "57P03", // cannot_connect_now
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
]);

/** Walks the cause chain (drizzle wraps driver errors) looking for a transient failure. */
export function isTransientDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const { code } = current as { code?: unknown };
    if (typeof code === "string" && TRANSIENT_SQLSTATES.has(code)) return true;
    if (TRANSIENT_MESSAGES.some((m) => current instanceof Error && current.message.includes(m)))
      return true;
    current = current.cause;
  }
  return false;
}

/** Seconds clients should wait before retrying an overloaded request. */
export const OVERLOADED_RETRY_AFTER_SECONDS = 1;
