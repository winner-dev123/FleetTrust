import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureLogs } from "../../test/support/log-capture.js";
import { runWithRequestContext } from "./request-context.js";
import { createTracerProvider } from "./tracing.js";

describe("structured logger", () => {
  it("emits Cloud Logging fields: severity, message, time, service metadata", () => {
    const capture = captureLogs();
    capture.logger.warn("disk almost full");
    const [line] = capture.lines();
    expect(line).toMatchObject({
      severity: "WARNING",
      level: "warn",
      message: "disk almost full",
      service: "fleettrust-api",
      role: "api",
      version: "test",
    });
    expect(typeof line?.["time"]).toBe("string");
  });

  it("redacts secrets by field path and by pattern, including nested and error fields", () => {
    const capture = captureLogs();
    capture.logger.info(
      {
        req: {
          headers: {
            authorization: "Bearer live-token-123",
            cookie: "session=abc",
            "x-firebase-appcheck": "appcheck-xyz",
          },
        },
        user: { password: "hunter2", idToken: "eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiIxIn0.sig-value" },
        config: { DATABASE_URL: "postgresql://app:db-pass-1@10.0.0.5/fleettrust" },
        note: "retrying postgresql://app:db-pass-2@10.0.0.5/fleettrust",
      },
      "connecting with api_key=AIzaFAKE999",
    );
    capture.logger.error(
      { err: new Error("connect failed for redis://:redis-pass-3@10.0.0.6:6379") },
      "boom",
    );

    const raw = capture.raw();
    for (const secret of [
      "live-token-123",
      "session=abc",
      "appcheck-xyz",
      "hunter2",
      "sig-value",
      "db-pass-1",
      "db-pass-2",
      "redis-pass-3",
      "AIzaFAKE999",
    ]) {
      expect(raw, `secret "${secret}" leaked`).not.toContain(secret);
    }
    // The non-secret parts survive, so logs stay useful.
    expect(raw).toContain("10.0.0.5");
    const errorLine = capture.lines()[1];
    expect(errorLine?.["severity"]).toBe("ERROR");
    expect(JSON.stringify(errorLine?.["err"])).toContain("connect failed for redis://:[REDACTED]@");
  });

  it("adds the request ID from the current request context", () => {
    const capture = captureLogs();
    runWithRequestContext({ requestId: "req-12345678" }, () => {
      capture.logger.info("inside");
    });
    capture.logger.info("outside");
    const [inside, outside] = capture.lines();
    expect(inside?.["requestId"]).toBe("req-12345678");
    expect(outside?.["requestId"]).toBeUndefined();
  });

  describe("trace correlation", () => {
    const contextManager = new AsyncLocalStorageContextManager();
    beforeAll(() => {
      context.setGlobalContextManager(contextManager.enable());
    });
    afterAll(() => {
      contextManager.disable();
      context.disable();
    });

    it("links log lines to the active span for Cloud Trace", () => {
      const capture = captureLogs({ gcpProject: "fleettrust-staging" });
      const provider = createTracerProvider(
        {
          exporter: "console",
          serviceName: "t",
          serviceVersion: "t",
          environment: "test",
          sampleRatio: 1,
        },
        new InMemorySpanExporter(),
      );
      const span = provider.getTracer("test").startSpan("work");
      context.with(trace.setSpan(context.active(), span), () => {
        capture.logger.info("in span");
      });
      span.end();

      const [line] = capture.lines();
      const { traceId, spanId } = span.spanContext();
      expect(line).toMatchObject({
        traceId,
        spanId,
        "logging.googleapis.com/trace": `projects/fleettrust-staging/traces/${traceId}`,
        "logging.googleapis.com/spanId": spanId,
      });
    });
  });
});
