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

const me = {
  id: "0190f4a6-1c2b-7d3e-8f40-123456789abc",
  email: "driver@example.test",
  emailVerified: true,
  displayName: null,
  profileComplete: false,
  timeZone: "UTC",
  createdAt: "2026-11-19T10:00:00.000Z",
};

describe("authenticated requests", () => {
  it("sends the current ID token and App Check token, and parses the profile", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(me));
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetch,
      getIdToken: () => Promise.resolve("id-token-123"),
      getAppCheckToken: () => "app-check-456",
    });

    await expect(client.me()).resolves.toEqual(me);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer id-token-123",
      "X-Firebase-AppCheck": "app-check-456",
    });
  });

  it("never sends tokens to public endpoints", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(healthy));
    const client = createApiClient({
      baseUrl: "https://x.test",
      fetch,
      getIdToken: () => "id-token",
    });
    await client.health();
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
  });

  it("surfaces the API's reason code so apps know whether to refresh or re-authenticate", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        jsonResponse({ statusCode: 401, error: "unauthenticated", reason: "expired_token" }, 401),
      );
    const client = createApiClient({ baseUrl: "https://x.test", fetch, getIdToken: () => "old" });

    const error = (await client.me().catch((caught: unknown) => caught)) as ApiError;
    expect(error.reason).toBe("expired_token");
    expect(error.requiresSignIn).toBe(true);
  });

  it("reports Retry-After on 429", async () => {
    const response = new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "42" },
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const client = createApiClient({ baseUrl: "https://x.test", fetch, getIdToken: () => "t" });

    const error = (await client.revokeAllSessions().catch((caught: unknown) => caught)) as ApiError;
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 42 });
  });

  it("validates updates before sending them", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createApiClient({ baseUrl: "https://x.test", fetch, getIdToken: () => "t" });
    await expect(client.updateMe({ displayName: "x".repeat(51) })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("PATCHes a trimmed display name and handles 204 for session revocation", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ ...me, displayName: "Ana", profileComplete: true }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: "https://x.test", fetch, getIdToken: () => "t" });

    await client.updateMe({ displayName: "  Ana " });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ displayName: "Ana" }),
    });
    await expect(client.revokeAllSessions()).resolves.toBeUndefined();
    expect(fetch.mock.calls[1]?.[0]).toBe("https://x.test/v1/me/sessions/revoke");
  });
});

describe("organizations", () => {
  const orgId = "0190f4a6-1c2b-7d3e-8f40-123456789abc";
  const mine = {
    organization: {
      id: orgId,
      kind: "fleet",
      name: "Fleet",
      status: "active",
      timeZone: "UTC",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    membershipId: "0190f4a6-1c2b-7d3e-8f40-123456789abd",
    role: "owner",
    branchId: null,
    permissions: ["org.read"],
  };

  it("creates an organization and lists the user's organizations", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(mine, 201))
      .mockResolvedValueOnce(jsonResponse([mine]));
    const client = createApiClient({ baseUrl: "https://x.test", fetch, getIdToken: () => "t" });

    await expect(client.createOrganization({ kind: "fleet", name: " Fleet " })).resolves.toEqual(
      mine,
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ kind: "fleet", name: "Fleet" }),
    });
    await expect(client.myOrganizations()).resolves.toEqual([mine]);
  });

  it("encodes path IDs and sends DELETE for revocation", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: "https://x.test", fetch, getIdToken: () => "t" });
    await client.revokeInvitation(orgId, "../../me");
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://x.test/v1/orgs/${orgId}/invitations/..%2F..%2Fme`,
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("surfaces organization reason codes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        jsonResponse({ statusCode: 410, error: "gone", reason: "invitation_expired" }, 410),
      );
    const client = createApiClient({ baseUrl: "https://x.test", fetch, getIdToken: () => "t" });
    const error = (await client
      .acceptInvitation("A".repeat(43))
      .catch((caught: unknown) => caught)) as ApiError;
    expect(error).toMatchObject({ status: 410, reason: "invitation_expired" });
  });

  it("reads usage meters and surfaces quota_exceeded", async () => {
    const meters = {
      subject: { type: "organization", id: orgId },
      plan: {
        code: "fleet-free",
        name: "Fleet Starter",
        version: 1,
        source: "default",
        activatedAt: null,
        endsAt: null,
      },
      timeZone: "UTC",
      period: "2026-11-19",
      entitlements: [
        {
          key: "branches.max",
          kind: "capacity",
          limit: 3,
          used: 3,
          source: "plan",
          graceUntil: null,
          overLimit: false,
        },
      ],
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(meters))
      .mockResolvedValueOnce(
        jsonResponse({ statusCode: 403, error: "forbidden", reason: "quota_exceeded" }, 403),
      );
    const client = createApiClient({ baseUrl: "https://x.test", fetch, getIdToken: () => "t" });
    await expect(client.organizationEntitlements(orgId)).resolves.toEqual(meters);
    expect(fetch.mock.calls[0]?.[0]).toBe(`https://x.test/v1/orgs/${orgId}/entitlements`);
    const error = (await client
      .createBranch(orgId, "Depot")
      .catch((caught: unknown) => caught)) as ApiError;
    expect(error.reason).toBe("quota_exceeded");
  });

  it("verification: personal vs organization paths and labels", async () => {
    const labels = {
      subject: { type: "organization", id: orgId },
      labels: [{ badgeType: "business", status: "unverified", expiresAt: null }],
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(labels));
    const client = createApiClient({ baseUrl: "https://x.test", fetch, getIdToken: () => "t" });
    await client.verificationCases();
    await client.verificationCases(orgId);
    await expect(client.verificationLabels({ type: "organization", id: orgId })).resolves.toEqual(
      labels,
    );
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "https://x.test/v1/me/verification/cases",
      `https://x.test/v1/orgs/${orgId}/verification/cases`,
      `https://x.test/v1/verification/labels/organizations/${orgId}`,
    ]);
    // Oversized documents are refused before any request.
    await expect(
      client.addVerificationDocument(orgId, {
        kind: "other",
        contentType: "application/pdf",
        size: 50_000_000,
      }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects malformed invitation tokens without calling the API", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createApiClient({ baseUrl: "https://x.test", fetch, getIdToken: () => "t" });
    await expect(client.acceptInvitation("not a token")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
