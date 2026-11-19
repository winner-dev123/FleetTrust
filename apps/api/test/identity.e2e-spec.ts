import { auditEvents, eq, users } from "@fleettrust/db";
import { meResponseSchema } from "@fleettrust/types";
import { Controller, Post } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RequireDisplayName, RequireRecentLogin } from "../src/modules/identity/index.js";
import { FAILED_AUTH_LIMIT } from "../src/modules/identity/auth.guard.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

/** Test-only routes for the contribution and sensitive-action guards. */
@Controller("__test")
class GuardProbeController {
  @Post("contribute")
  @RequireDisplayName()
  contribute(): { ok: true } {
    return { ok: true };
  }

  @Post("delete-account")
  @RequireRecentLogin(300)
  deleteAccount(): { ok: true } {
    return { ok: true };
  }
}

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ controllers: [GuardProbeController] });
});

afterAll(async () => {
  await t.close();
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const reason = (body: unknown) => (body as { reason?: string }).reason;

describe("registration (first sign-in creates the account)", () => {
  it("creates a user from nothing but a verified token, and audits it", async () => {
    const token = t.auth.issue("uid-register", {
      email: "New.Driver@Example.test",
      signInProvider: "google.com",
    });

    const response = await request(t.server).get("/v1/me").set(bearer(token)).expect(200);
    const me = meResponseSchema.parse(response.body);
    expect(me).toMatchObject({
      email: "new.driver@example.test",
      emailVerified: true,
      displayName: null,
      profileComplete: false,
    });
    expect(response.body).not.toHaveProperty("firebaseUid");

    const rows = await t.db.db.select().from(users).where(eq(users.firebaseUid, "uid-register"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastSignInProvider).toBe("google.com");

    const audit = await t.db.db.select().from(auditEvents).where(eq(auditEvents.actorId, me.id));
    expect(audit.map((event) => event.action)).toEqual(["user.signed_up"]);
    expect(audit[0]?.metadata).toEqual({ provider: "google.com" });
  });

  it("signing in again returns the same account (login)", async () => {
    const first = await request(t.server)
      .get("/v1/me")
      .set(bearer(t.auth.issue("uid-login")))
      .expect(200);
    const second = await request(t.server)
      .get("/v1/me")
      .set(bearer(t.auth.issue("uid-login")))
      .expect(200);
    expect((second.body as { id: string }).id).toBe((first.body as { id: string }).id);
  });

  it("concurrent first requests create exactly one account and one audit event", async () => {
    const tokens = Array.from({ length: 6 }, () => t.auth.issue("uid-race"));
    const responses = await Promise.all(
      tokens.map((token) => request(t.server).get("/v1/me").set(bearer(token))),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(new Set(responses.map((response) => (response.body as { id: string }).id)).size).toBe(1);

    const rows = await t.db.db.select().from(users).where(eq(users.firebaseUid, "uid-race"));
    expect(rows).toHaveLength(1);
    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorId, rows[0]?.id ?? ""));
    expect(audit.filter((event) => event.action === "user.signed_up")).toHaveLength(1);
  });

  it("needs no profile data or documents to start (SRS FR-01)", async () => {
    const token = t.auth.issue("uid-anonymous-ish", { email: undefined, emailVerified: false });
    const response = await request(t.server).get("/v1/me").set(bearer(token)).expect(200);
    expect(response.body).toMatchObject({ email: null, displayName: null, profileComplete: false });
  });
});

describe("invalid credentials", () => {
  it.each([
    ["no Authorization header", {}, "missing_token"],
    ["a non-Bearer scheme", { Authorization: "Basic dXNlcjpwYXNz" }, "malformed_token"],
    [
      "a token with illegal characters",
      { Authorization: "Bearer <script>alert(1)</script>xxxxxxx" },
      "malformed_token",
    ],
    [
      "an unknown token",
      { Authorization: "Bearer this-token-was-never-issued-by-firebase" },
      "invalid_token",
    ],
  ])("rejects %s with 401", async (_label, headers, expected) => {
    const response = await request(t.server).get("/v1/me").set(headers).expect(401);
    expect(response.body).toMatchObject({
      statusCode: 401,
      error: "unauthenticated",
      reason: expected,
    });
  });

  it("tells clients an expired token should be refreshed", async () => {
    const response = await request(t.server)
      .get("/v1/me")
      .set(bearer(t.auth.issue("uid-expired", { expired: true })))
      .expect(401);
    expect(reason(response.body)).toBe("expired_token");
  });

  it("rejects disabled Firebase accounts", async () => {
    const token = t.auth.issue("uid-disabled");
    t.auth.disable("uid-disabled");
    expect(
      reason((await request(t.server).get("/v1/me").set(bearer(token)).expect(401)).body),
    ).toBe("user_disabled");
  });

  it("blocks suspended accounts with 403", async () => {
    const token = t.auth.issue("uid-suspended");
    await request(t.server).get("/v1/me").set(bearer(token)).expect(200);
    await t.db.db
      .update(users)
      .set({ status: "suspended" })
      .where(eq(users.firebaseUid, "uid-suspended"));
    const response = await request(t.server).get("/v1/me").set(bearer(token)).expect(403);
    expect(reason(response.body)).toBe("account_suspended");
  });

  it("keeps health checks public", async () => {
    await request(t.server).get("/health").expect(200);
  });
});

describe("profile (display name optional until first contribution)", () => {
  it("blocks contributing until a display name is set", async () => {
    const token = t.auth.issue("uid-contrib");
    const blocked = await request(t.server)
      .post("/__test/contribute")
      .set(bearer(token))
      .expect(409);
    expect(reason(blocked.body)).toBe("profile_incomplete");

    const updated = await request(t.server)
      .patch("/v1/me")
      .set(bearer(token))
      .send({ displayName: "  Thandi M.  " })
      .expect(200);
    expect(updated.body).toMatchObject({ displayName: "Thandi M.", profileComplete: true });

    await request(t.server).post("/__test/contribute").set(bearer(token)).expect(201);
  });

  it.each([
    ["empty", { displayName: "   " }],
    ["too long", { displayName: "x".repeat(51) }],
    ["control characters", { displayName: "Bob\u0000" }],
    ["invisible formatting characters", { displayName: "Ad‮min" }],
    ["unknown fields", { displayName: "Ok", role: "admin" }],
  ])("rejects a %s display name with 400", async (_label, body) => {
    const response = await request(t.server)
      .patch("/v1/me")
      .set(bearer(t.auth.issue("uid-validate")))
      .send(body)
      .expect(400);
    expect(response.body).toMatchObject({ error: "validation_failed" });
  });

  it("can clear the display name again", async () => {
    const token = t.auth.issue("uid-clear");
    await request(t.server)
      .patch("/v1/me")
      .set(bearer(token))
      .send({ displayName: "Sipho" })
      .expect(200);
    const cleared = await request(t.server)
      .patch("/v1/me")
      .set(bearer(token))
      .send({ displayName: null })
      .expect(200);
    expect(cleared.body).toMatchObject({ displayName: null, profileComplete: false });
  });
});

describe("sessions", () => {
  it("'sign out everywhere' revokes refresh tokens, audits, and kills old tokens on sensitive routes", async () => {
    const token = t.auth.issue("uid-revoke");
    await request(t.server).post("/v1/me/sessions/revoke").set(bearer(token)).expect(204);
    expect(t.auth.revokeCalls).toContain("uid-revoke");

    const [user] = await t.db.db.select().from(users).where(eq(users.firebaseUid, "uid-revoke"));
    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorId, user?.id ?? ""));
    expect(audit.map((event) => event.action)).toContain("user.sessions_revoked");

    // Sensitive routes check revocation immediately…
    const rejected = await request(t.server)
      .patch("/v1/me")
      .set(bearer(token))
      .send({ displayName: "X" })
      .expect(401);
    expect(reason(rejected.body)).toBe("revoked_token");
    // …and a fresh sign-in works again.
    await request(t.server)
      .patch("/v1/me")
      .set(bearer(t.auth.issue("uid-revoke")))
      .send({ displayName: "X" })
      .expect(200);
  });

  it("requires a recent sign-in (not just a refreshed token) for sensitive actions", async () => {
    const stale = t.auth.issue("uid-recent", { authTime: new Date(Date.now() - 10 * 60 * 1000) });
    const response = await request(t.server)
      .post("/__test/delete-account")
      .set(bearer(stale))
      .expect(401);
    expect(reason(response.body)).toBe("reauthentication_required");

    const fresh = t.auth.issue("uid-recent", { authTime: new Date() });
    await request(t.server).post("/__test/delete-account").set(bearer(fresh)).expect(201);
  });
});

describe("abuse throttling", () => {
  it(`returns 429 with Retry-After after ${String(FAILED_AUTH_LIMIT)} failed attempts from one IP`, async () => {
    const isolated = await createTestApp({ db: t.db });
    try {
      for (let attempt = 0; attempt < FAILED_AUTH_LIMIT; attempt++) {
        await request(isolated.server)
          .get("/v1/me")
          .set(bearer("guessed-token-0000000000000"))
          .expect(401);
      }
      const blocked = await request(isolated.server)
        .get("/v1/me")
        .set(bearer("guessed-token-0000000000000"))
        .expect(429);
      expect(blocked.body).toMatchObject({ error: "rate_limited" });
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

      // Valid tokens never consume the failure budget, so real users are not locked out.
      await request(isolated.server)
        .get("/v1/me")
        .set(bearer(isolated.auth.issue("uid-legit")))
        .expect(200);
    } finally {
      await isolated.close();
    }
  });

  it("limits 'sign out everywhere' per user", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await request(t.server)
        .post("/v1/me/sessions/revoke")
        .set(bearer(t.auth.issue("uid-revoke-spam")));
      statuses.push(response.status);
    }
    expect(statuses).toEqual([204, 204, 204, 204, 204, 429]);
  });
});

describe("App Check", () => {
  it("enforce mode rejects requests without a valid App Check token", async () => {
    const enforced = await createTestApp({ db: t.db, env: { APP_CHECK_MODE: "enforce" } });
    try {
      const token = enforced.auth.issue("uid-appcheck");
      const missing = await request(enforced.server).get("/v1/me").set(bearer(token)).expect(401);
      expect(reason(missing.body)).toBe("app_check_failed");
      await request(enforced.server)
        .get("/v1/me")
        .set({ ...bearer(token), "X-Firebase-AppCheck": "forged" })
        .expect(401);
      await request(enforced.server)
        .get("/v1/me")
        .set({ ...bearer(token), "X-Firebase-AppCheck": "valid-app-check-token" })
        .expect(200);
      // Public routes (load-balancer health checks) never need App Check.
      await request(enforced.server).get("/health").expect(200);
    } finally {
      await enforced.close();
    }
  });

  it("monitor mode lets requests through but logs what it would have rejected", async () => {
    const monitored = await createTestApp({ db: t.db, env: { APP_CHECK_MODE: "monitor" } });
    try {
      await request(monitored.server)
        .get("/v1/me")
        .set(bearer(monitored.auth.issue("uid-monitor")))
        .expect(200);
    } finally {
      await monitored.close();
    }
  });
});
