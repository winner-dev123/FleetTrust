import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { describe, expect, it } from "vitest";

import { createTracerProvider, type TracingConfig, tracingConfigFromEnv } from "./tracing.js";

describe("tracingConfigFromEnv", () => {
  it("is off by default", () => {
    expect(tracingConfigFromEnv({})).toEqual({
      exporter: "none",
      serviceName: "fleettrust-api",
      serviceVersion: "0.0.0-dev",
      environment: "local",
      sampleRatio: 1,
    });
  });

  it("reads standard OTEL_* variables and app metadata", () => {
    expect(
      tracingConfigFromEnv({
        OTEL_TRACES_EXPORTER: "OTLP",
        OTEL_TRACES_SAMPLER_ARG: "0.25",
        APP_ROLE: "worker",
        APP_VERSION: "1.4.0",
        APP_ENV: "staging",
      }),
    ).toEqual({
      exporter: "otlp",
      serviceName: "fleettrust-worker",
      serviceVersion: "1.4.0",
      environment: "staging",
      sampleRatio: 0.25,
    });
  });

  it("rejects unknown exporters and invalid ratios", () => {
    expect(() => tracingConfigFromEnv({ OTEL_TRACES_EXPORTER: "jaeger" })).toThrow(
      /none, console or otlp/,
    );
    expect(() => tracingConfigFromEnv({ OTEL_TRACES_SAMPLER_ARG: "1.5" })).toThrow(
      /between 0 and 1/,
    );
  });
});

describe("createTracerProvider", () => {
  const base: TracingConfig = {
    exporter: "console",
    serviceName: "fleettrust-api",
    serviceVersion: "9.9.9",
    environment: "test",
    sampleRatio: 1,
  };

  it("exports spans tagged with service and environment", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = createTracerProvider(base, exporter);
    provider.getTracer("test").startSpan("unit-of-work").end();
    await provider.forceFlush();

    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe("unit-of-work");
    expect(span?.resource.attributes).toMatchObject({
      "service.name": "fleettrust-api",
      "service.version": "9.9.9",
      "deployment.environment.name": "test",
    });
    await provider.shutdown();
  });

  it("samples nothing at ratio 0", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = createTracerProvider({ ...base, sampleRatio: 0 }, exporter);
    provider.getTracer("test").startSpan("dropped").end();
    await provider.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    await provider.shutdown();
  });
});
