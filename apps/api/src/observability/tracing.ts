import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  ParentBasedSampler,
  type SpanExporter,
  TraceIdRatioBasedSampler,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export type TracesExporter = "none" | "console" | "otlp";

export interface TracingConfig {
  exporter: TracesExporter;
  serviceName: string;
  serviceVersion: string;
  environment: string;
  /** Fraction of new (root) traces to sample. Child spans follow the caller's decision. */
  sampleRatio: number;
}

/** Reads the standard OpenTelemetry environment variables (OTEL_*) plus APP_* for metadata. */
export function tracingConfigFromEnv(env: NodeJS.ProcessEnv): TracingConfig {
  const exporter = (env["OTEL_TRACES_EXPORTER"] ?? "none").trim().toLowerCase();
  if (exporter !== "none" && exporter !== "console" && exporter !== "otlp") {
    throw new Error(`OTEL_TRACES_EXPORTER must be none, console or otlp, got "${exporter}"`);
  }
  const ratio = Number(env["OTEL_TRACES_SAMPLER_ARG"] ?? "1");
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error("OTEL_TRACES_SAMPLER_ARG must be a number between 0 and 1");
  }
  return {
    exporter,
    serviceName: env["OTEL_SERVICE_NAME"] ?? `fleettrust-${env["APP_ROLE"] ?? "api"}`,
    serviceVersion: env["APP_VERSION"] ?? "0.0.0-dev",
    environment: env["APP_ENV"] ?? "local",
    sampleRatio: ratio,
  };
}

/** Builds (but does not register) a tracer provider; tests pass their own exporter. */
export function createTracerProvider(
  config: TracingConfig,
  exporter: SpanExporter,
): TracerProvider {
  return new TracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      "deployment.environment.name": config.environment,
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRatio) }),
    spanProcessors: [new BatchSpanProcessor({ exporter })],
  });
}

/**
 * Starts tracing for the process. In Cloud Run, exporting goes over OTLP to an
 * OpenTelemetry Collector sidecar that forwards to Cloud Trace
 * (docs/operations/observability.md), so the app stays vendor-neutral.
 */
export function startTracing(config: TracingConfig): () => Promise<void> {
  const exporter: SpanExporter =
    config.exporter === "console" ? new ConsoleSpanExporter() : new OTLPTraceExporter();
  const provider = createTracerProvider(config, exporter);

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new HttpInstrumentation({
        // Liveness probes are frequent and uninteresting.
        ignoreIncomingRequestHook: (request) => request.url === "/health",
      }),
      new ExpressInstrumentation(),
      // Records statement shape, never parameter values.
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });

  return () => provider.shutdown();
}
