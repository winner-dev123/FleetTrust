import "reflect-metadata";

import type { Server } from "node:http";

import { Controller, Get, type INestApplication, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { loadApiEnv } from "../src/config/env.js";
import { Public } from "../src/modules/identity/index.js";
import { NestPinoLogger } from "../src/observability/nest-logger.js";
import { captureLogs, type LogCapture } from "./support/log-capture.js";

const REPORTED_ERROR_EVENT =
  "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent";
const isErrorReport = (line: Record<string, unknown>) => line["@type"] === REPORTED_ERROR_EVENT;
const header = (value: unknown) => (typeof value === "string" ? value : "");

/** Test-only routes that exercise the error paths. */
@Public()
@Controller("__test")
class ProbeController {
  @Get("ok")
  ok(): { ok: true } {
    return { ok: true };
  }

  @Get("boom")
  boom(): never {
    throw new Error("query failed: postgresql://app:leaky-db-pass@10.0.0.5/fleettrust");
  }

  @Get("missing")
  missing(): never {
    throw new NotFoundException("Vehicle not found");
  }
}

describe("observability (request IDs, logging, error handling)", () => {
  let app: INestApplication;
  let capture: LogCapture;
  let server: Server;

  beforeAll(async () => {
    capture = captureLogs();
    const env = loadApiEnv({ NODE_ENV: "test", APP_ENV: "test", APP_VERSION: "test-sha" });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(env, { logger: capture.logger })],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(new NestPinoLogger(capture.logger));
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  const requestLines = () => capture.lines().filter((line) => line["httpRequest"] !== undefined);

  it("assigns a request ID, returns it, and logs the request with it", async () => {
    const response = await request(server).get("/__test/ok?token=should-not-be-logged").expect(200);
    const requestId = header(response.headers["x-request-id"]);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

    const line = requestLines().find((entry) => entry["requestId"] === requestId);
    expect(line).toMatchObject({
      severity: "INFO",
      httpRequest: { requestMethod: "GET", requestUrl: "/__test/ok", status: 200 },
    });
    expect(capture.raw()).not.toContain("should-not-be-logged");
  });

  it("reuses a safe incoming X-Request-Id and replaces an unsafe one", async () => {
    const reused = await request(server)
      .get("/__test/ok")
      .set("X-Request-Id", "lb-trace-0001")
      .expect(200);
    expect(header(reused.headers["x-request-id"])).toBe("lb-trace-0001");

    const replaced = await request(server)
      .get("/__test/ok")
      .set("X-Request-Id", "<script>alert(1)</script>")
      .expect(200);
    expect(header(replaced.headers["x-request-id"])).not.toContain("<script>");
  });

  it("answers unexpected errors with a generic 500, reports them once, and redacts the details", async () => {
    const response = await request(server).get("/__test/boom").expect(500);
    const requestId = header(response.headers["x-request-id"]);

    expect(response.body).toEqual({
      statusCode: 500,
      error: "internal_error",
      message: "Something went wrong. Please try again.",
      requestId,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/postgresql|leaky-db-pass|query failed/);

    const reports = capture.lines().filter((line) => isErrorReport(line));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ severity: "ERROR", requestId });
    expect(String(reports[0]?.["message"])).toContain("query failed: postgresql://app:[REDACTED]@");
    expect(capture.raw()).not.toContain("leaky-db-pass");
  });

  it("passes expected HTTP errors through unchanged and does not report them", async () => {
    const before = capture.lines().length;
    const response = await request(server).get("/__test/missing").expect(404);
    expect(response.body).toMatchObject({ statusCode: 404, message: "Vehicle not found" });

    const newLines = capture.lines().slice(before);
    expect(newLines.some((line) => isErrorReport(line))).toBe(false);
    expect(newLines.find((line) => line["httpRequest"] !== undefined)?.["severity"]).toBe(
      "WARNING",
    );
  });

  it("keeps the deliberate readiness 503 body and does not report it as an error", async () => {
    const before = capture.lines().length;
    const response = await request(server).get("/health/ready").expect(503);
    expect(response.body).toEqual({ status: "not_ready", checks: { database: "not_configured" } });
    const newLines = capture.lines().slice(before);
    expect(newLines.some((line) => isErrorReport(line))).toBe(false);
  });
});
