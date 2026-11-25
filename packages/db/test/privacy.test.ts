import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { consents, users, verificationCases } from "../src/schema/index.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";
import { pgCode } from "./support/appointment-fixtures.js";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

const failure = (promise: PromiseLike<unknown>) =>
  Promise.resolve(promise).then(
    () => null,
    (error: unknown) => error,
  );

async function user(email: string | null = null) {
  const [row] = await t.db
    .insert(users)
    .values({ firebaseUid: `p-${uuidv7()}`, email })
    .returning();
  if (!row) throw new Error("no user");
  return row.id;
}

describe("account deletion tombstones (Prompt 27)", () => {
  it("a deleted account keeps no email, name or activity, and has a deletion time", async () => {
    const id = await user("person@example.test");
    const withEmail = await failure(
      t.db.update(users).set({ status: "deleted", deletedAt: new Date() }).where(eq(users.id, id)),
    );
    expect(pgCode(withEmail)).toBe("23514");
    const noTime = await failure(
      t.db.update(users).set({ status: "deleted", email: null }).where(eq(users.id, id)),
    );
    expect(pgCode(noTime)).toBe("23514");
    await t.db
      .update(users)
      .set({
        status: "deleted",
        email: null,
        displayName: null,
        lastSeenAt: null,
        deletedAt: new Date(),
      })
      .where(eq(users.id, id));
  });

  it("consents are typed and versioned", async () => {
    const id = await user();
    const bad = await failure(
      t.db
        .insert(consents)
        .values({ userId: id, purpose: "selling_data" as "terms", version: "1", granted: true }),
    );
    expect(pgCode(bad)).toBe("23514");
    await t.db
      .insert(consents)
      .values({ userId: id, purpose: "analytics", version: "2026-11-24", granted: false });
  });
});

describe("verification checks refuse a missing note (fixed in Prompt 27)", () => {
  it("a rejected case without a reason is refused, even as NULL", async () => {
    const id = await user();
    const missing = await failure(
      t.db.insert(verificationCases).values({
        subjectType: "user",
        userId: id,
        badgeType: "driver",
        status: "rejected",
        openedBy: id,
        submittedAt: new Date(),
        decidedAt: new Date(),
        decidedBy: id,
        decisionReason: null,
      }),
    );
    expect(pgCode(missing)).toBe("23514");
    expect(
      String((missing as { cause?: { constraint?: string } }).cause?.constraint ?? missing),
    ).toMatch(/verification_cases_reason_required/);
    // Control: the same row with a reason is accepted.
    await t.db.insert(verificationCases).values({
      subjectType: "user",
      userId: id,
      badgeType: "driver",
      status: "rejected",
      openedBy: id,
      submittedAt: new Date(),
      decidedAt: new Date(),
      decidedBy: id,
      decisionReason: "Licence photo unreadable",
    });
  });
});
