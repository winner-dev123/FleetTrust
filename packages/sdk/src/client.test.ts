import { describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient } from "./index.js";

const healthy = { status: "ok", service: "fleettrust-api", role: "api", version: "0.0.0" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createApiClient", () => {
  it("calls GET /health on the base URL and validates the payload", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(healthy));
    const client = createApiClient({ baseUrl: "https://api.example.test/", fetch });

    await expect(client.health()).resolves.toEqual(healthy);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("raises http_error with the status for non-2xx responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({}, 503));
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch });

    await expect(client.health()).rejects.toMatchObject({
      name: "ApiError",
      code: "http_error",
      status: 503,
    });
  });

  it("raises invalid_response when the payload breaks the contract", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse({ ...healthy, role: "root" }));
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch });

    await expect(client.health()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("raises network_error when fetch rejects", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("offline"));
    const client = createApiClient({ baseUrl: "https://api.example.test", fetch });

    const error = await client.health().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("network_error");
  });
});
