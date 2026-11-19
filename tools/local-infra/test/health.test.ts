import { describe, expect, it, vi } from "vitest";

import {
  allRequiredHealthy,
  evaluateContainers,
  formatReport,
  parseComposePs,
  probeHttp,
} from "../src/health.ts";

const pg = { Service: "postgres", State: "running", Health: "healthy" };
const redis = { Service: "redis", State: "running", Health: "healthy" };

describe("parseComposePs", () => {
  it("accepts newline-delimited JSON (current Compose)", () => {
    const output = `${JSON.stringify({ ...pg, Name: "x" })}\n${JSON.stringify(redis)}\n`;
    expect(parseComposePs(output)).toEqual([pg, redis]);
  });

  it("accepts a JSON array (older Compose)", () => {
    expect(parseComposePs(JSON.stringify([pg, redis]))).toEqual([pg, redis]);
  });

  it("returns no services for empty output", () => {
    expect(parseComposePs("  \n")).toEqual([]);
  });
});

describe("evaluateContainers", () => {
  it("is healthy when required services are healthy, even without optional mailpit", () => {
    const results = evaluateContainers([pg, redis]);
    expect(allRequiredHealthy(results)).toBe(true);
    expect(results.find((result) => result.name === "mailpit")?.status).toBe("not running");
  });

  it.each([
    [{ ...redis, Health: "starting" }, "starting"],
    [{ ...redis, Health: "unhealthy" }, "unhealthy"],
    [{ ...redis, State: "exited", Health: "" }, "not running"],
  ] as const)("fails when a required service is %o", (service, expected) => {
    const results = evaluateContainers([pg, service]);
    expect(results.find((result) => result.name === "redis")?.status).toBe(expected);
    expect(allRequiredHealthy(results)).toBe(false);
  });

  it("fails when nothing is running", () => {
    expect(allRequiredHealthy(evaluateContainers([]))).toBe(false);
  });

  it("formats a readable report", () => {
    const report = formatReport(evaluateContainers([pg]));
    expect(report).toMatch(/^ok {3}postgres/m);
    expect(report).toMatch(/^FAIL redis/m);
  });
});

describe("probeHttp", () => {
  it("reports healthy for any HTTP response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 404 }));
    const result = await probeHttp({ name: "auth", url: "http://127.0.0.1:9099/" }, fetchImpl);
    expect(result).toMatchObject({ status: "healthy", detail: "HTTP 404", required: false });
  });

  it("reports not running when the connection fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("ECONNREFUSED"));
    const result = await probeHttp({ name: "auth", url: "http://127.0.0.1:9099/" }, fetchImpl);
    expect(result.status).toBe("not running");
  });
});
