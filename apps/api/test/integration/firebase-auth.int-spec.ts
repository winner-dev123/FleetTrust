import { randomUUID } from "node:crypto";

import { auditEvents, eq, users } from "@fleettrust/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FirebaseAuthVerifier } from "../../src/modules/identity/firebase-adapters.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

/**
 * End-to-end sign-in against the Firebase Auth emulator with the PRODUCTION verifier
 * (firebase-admin). Runs in CI's `local-infra` job; skipped elsewhere unless
 * REQUIRE_INTEGRATION=1. The emulator accepts unsigned tokens, which is why env
 * validation forbids FIREBASE_AUTH_EMULATOR_HOST in deployed environments.
 */
const emulator = process.env["FIREBASE_AUTH_EMULATOR_HOST"];
if (process.env["REQUIRE_INTEGRATION"] === "1" && !emulator) {
  throw new Error("REQUIRE_INTEGRATION=1 but FIREBASE_AUTH_EMULATOR_HOST is not set");
}

const PROJECT = "demo-fleettrust";
const API_KEY = "fake-api-key"; // the emulator accepts any key
const toolkit = (method: string) =>
  `http://${emulator ?? ""}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=${API_KEY}`;

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${url} -> ${String(response.status)}: ${await response.text()}`);
  return (await response.json()) as T;
}

/** The real passwordless flow: request a link, read it from the emulator's outbox, redeem it. */
async function signInWithEmailLink(email: string): Promise<string> {
  await post(toolkit("sendOobCode"), {
    requestType: "EMAIL_SIGNIN",
    email,
    continueUrl: "http://localhost:3000/auth/finish",
    canHandleCodeInApp: true,
  });
  const outbox = (await (
    await fetch(`http://${emulator ?? ""}/emulator/v1/projects/${PROJECT}/oobCodes`)
  ).json()) as { oobCodes: { email: string; oobCode: string; requestType: string }[] };
  const code = outbox.oobCodes
    .filter((c) => c.email === email && c.requestType === "EMAIL_SIGNIN")
    .at(-1);
  if (!code) throw new Error(`no sign-in link was sent to ${email}`);
  const { idToken } = await post<{ idToken: string }>(toolkit("signInWithEmailLink"), {
    email,
    oobCode: code.oobCode,
  });
  return idToken;
}

/** Google sign-in through the emulator's fake IdP. */
async function signInWithGoogle(email: string): Promise<string> {
  const fakeGoogleToken = JSON.stringify({ sub: randomUUID(), email, email_verified: true });
  const { idToken } = await post<{ idToken: string }>(toolkit("signInWithIdp"), {
    postBody: `id_token=${encodeURIComponent(fakeGoogleToken)}&providerId=google.com`,
    requestUri: "http://localhost",
    returnSecureToken: true,
  });
  return idToken;
}

describe.skipIf(!emulator)(
  "sign-in against the Firebase Auth emulator (real firebase-admin verifier)",
  () => {
    let t: TestApp;

    beforeAll(async () => {
      t = await createTestApp({ authVerifier: FirebaseAuthVerifier.forProject(PROJECT) });
    });

    afterAll(async () => {
      await t.close();
    });

    it("email link: registration on first sign-in, login on the next, same account", async () => {
      const email = `driver-${randomUUID()}@example.test`;

      const first = await request(t.server)
        .get("/v1/me")
        .set("Authorization", `Bearer ${await signInWithEmailLink(email)}`)
        .expect(200);
      expect(first.body).toMatchObject({ email, emailVerified: true, displayName: null });

      const second = await request(t.server)
        .get("/v1/me")
        .set("Authorization", `Bearer ${await signInWithEmailLink(email)}`)
        .expect(200);
      expect((second.body as { id: string }).id).toBe((first.body as { id: string }).id);

      const audit = await t.db.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.actorId, (first.body as { id: string }).id));
      expect(audit.filter((e) => e.action === "user.signed_up")).toHaveLength(1);
    });

    it("Google: records the provider", async () => {
      const email = `fleet-${randomUUID()}@example.test`;
      await request(t.server)
        .get("/v1/me")
        .set("Authorization", `Bearer ${await signInWithGoogle(email)}`)
        .expect(200);
      const [row] = await t.db.db.select().from(users).where(eq(users.email, email));
      expect(row?.lastSignInProvider).toBe("google.com");
    });

    it("rejects garbage and tokens for another project", async () => {
      await request(t.server)
        .get("/v1/me")
        .set("Authorization", "Bearer not.a.real-jwt-token-at-all")
        .expect(401);
      const otherProject = FirebaseAuthVerifier.forProject("demo-some-other-project");
      const token = await signInWithEmailLink(`other-${randomUUID()}@example.test`);
      await expect(
        otherProject.verifyIdToken(token, { checkRevoked: false }),
      ).rejects.toMatchObject({
        reason: "invalid_token",
      });
    });

    it("'sign out everywhere' revokes the session in Firebase; sensitive routes reject the old token", async () => {
      const email = `revoke-${randomUUID()}@example.test`;
      const token = await signInWithEmailLink(email);
      await request(t.server).get("/v1/me").set("Authorization", `Bearer ${token}`).expect(200);

      // Firebase revocation has one-second resolution: a token issued in the same second survives.
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await request(t.server)
        .post("/v1/me/sessions/revoke")
        .set("Authorization", `Bearer ${token}`)
        .expect(204);

      const rejected = await request(t.server)
        .patch("/v1/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ displayName: "Late" })
        .expect(401);
      expect((rejected.body as { reason: string }).reason).toBe("revoked_token");

      // Signing in again restores access.
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await request(t.server)
        .patch("/v1/me")
        .set("Authorization", `Bearer ${await signInWithEmailLink(email)}`)
        .send({ displayName: "Back" })
        .expect(200);
    });
  },
);
