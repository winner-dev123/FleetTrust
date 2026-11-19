/**
 * Global slot where instrumentation.ts leaves the tracer's shutdown function, if tracing is on.
 * Deliberately dependency-free: instrumentation.ts imports it before any hooked module loads.
 */
export const TRACING_SHUTDOWN = Symbol.for("fleettrust.tracing.shutdown");
