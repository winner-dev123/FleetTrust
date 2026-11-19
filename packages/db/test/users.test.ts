import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordAuditEvent } from "../src/events.js";
import { users } from "../src/schema/index.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : (error as Error).message;
  }
  throw new Error("expected the database to reject the statement");
}

describe("users", () => {
  it("needs nothing but a Firebase UID (minimal signup)", async () => {
    const [user] = await t.db.insert(users).values({ firebaseUid: "uid-minimal" }).returning();
    expect(user).toMatchObject({
      firebaseUid: "uid-minimal",
      email: null,
      emailVerified: false,
      displayName: null,
      status: "active",
    });
    expect(user?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it("allows only one account per Firebase UID", async () => {
    await t.db.insert(users).values({ firebaseUid: "uid-dup" });
    expect(await dbError(t.db.insert(users).values({ firebaseUid: "uid-dup" }))).toMatch(
      /users_firebase_uid_key/,
    );
  });

  it("enforces lower-case emails, display name length and known statuses", async () => {
    expect(
      await dbError(
        t.db.insert(users).values({ firebaseUid: "uid-e", email: "Mixed@Example.com" }),
      ),
    ).toMatch(/users_email_lowercase/);
    expect(
      await dbError(
        t.db.insert(users).values({ firebaseUid: "uid-n", displayName: "x".repeat(51) }),
      ),
    ).toMatch(/users_display_name_length/);
    expect(
      await dbError(
        t.client.query("INSERT INTO users (firebase_uid, status) VALUES ('uid-s', 'banned')"),
      ),
    ).toMatch(/users_status_valid/);
  });

  it("maintains updated_at on change", async () => {
    const [created] = await t.db.insert(users).values({ firebaseUid: "uid-upd" }).returning();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const [updated] = await t.db
      .update(users)
      .set({ displayName: "Ada" })
      .where(eq(users.id, created?.id ?? ""))
      .returning();
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(created?.updatedAt.getTime() ?? 0);
  });

  it("audit events must reference a real user, and users with history cannot be deleted", async () => {
    expect(
      await dbError(
        recordAuditEvent(t.db, {
          actorType: "user",
          actorId: "0190f4a6-1c2b-7d3e-8f40-123456789abc",
          action: "user.signed_up",
          targetType: "user",
        }),
      ),
    ).toMatch(/audit_events_actor_id_users_id_fk/);

    const [user] = await t.db.insert(users).values({ firebaseUid: "uid-hist" }).returning();
    await recordAuditEvent(t.db, {
      actorType: "user",
      actorId: user?.id,
      action: "user.signed_up",
      targetType: "user",
      targetId: user?.id,
    });
    expect(await dbError(t.db.delete(users).where(eq(users.id, user?.id ?? "")))).toMatch(
      /audit_events_actor_id_users_id_fk/,
    );
  });
});
