/**
 * Preloaded with `node --import ./dist/instrumentation.js dist/main.js` so tracing hooks are
 * installed before Express and pg are loaded. When OTEL_TRACES_EXPORTER is unset or "none"
 * (the local default) nothing is registered and there is no overhead.
 */
import { register } from "node:module";

import { TRACING_SHUTDOWN } from "./observability/tracing-slot.js";

const exporter = (process.env["OTEL_TRACES_EXPORTER"] ?? "none").trim().toLowerCase();

if (exporter !== "none") {
  // The app is ESM, so instrumentation needs the import hook (not only require hooks).
  // OpenTelemetry's hook.mjs is an asynchronous loader, which only module.register() supports;
  // the synchronous module.registerHooks() replacement can't run it.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

  const { startTracing, tracingConfigFromEnv } = await import("./observability/tracing.js");
  // Flushed by TracingLifecycle when Nest shuts down (enableShutdownHooks handles SIGTERM).
  (globalThis as Record<symbol, unknown>)[TRACING_SHUTDOWN] = startTracing(
    tracingConfigFromEnv(process.env),
  );
}
