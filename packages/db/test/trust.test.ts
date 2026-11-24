import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { memberSanctions, moderationAppeals, powerUserStatus, users } from "../src/schema/index.js";
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

async function user() {
  const [row] = await t.db
    .insert(users)
    .values({ firebaseUid: `trust-${uuidv7()}` })
    .returning();
  if (!row) throw new Error("no user");
  return row.id;
}

describe("trust and safety records (ADR-0030)", () => {
  it("keeps sanctions as history and requires a reason for revocations", async () => {
    const member = await user();
    const [warning] = await t.db
      .insert(memberSanctions)
      .values({ userId: member, kind: "warning", reason: "Spam links", startsAt: new Date() })
      .returning();
    const removed = await failure(
      t.db.delete(memberSanctions).where(eq(memberSanctions.id, warning?.id ?? "")),
    );
    expect(pgCode(removed)).toBe("23514");
    const silent = await failure(
      t.db.insert(powerUserStatus).values({
        userId: member,
        status: "revoked",
        grantedAt: new Date(),
        criteria: {},
        revokedAt: new Date(),
      }),
    );
    expect(pgCode(silent)).toBe("23514");
    // Deleting the account (and only that) removes the history.
    await t.db.delete(users).where(eq(users.id, member));
    expect(
      await t.db.select().from(memberSanctions).where(eq(memberSanctions.userId, member)),
    ).toEqual([]);
  });

  it("allows one appeal per decision, with a decision reason", async () => {
    const member = await user();
    const [sanction] = await t.db
      .insert(memberSanctions)
      .values({ userId: member, kind: "suspension", reason: "Harassment", startsAt: new Date() })
      .returning();
    const appeal = {
      userId: member,
      kind: "sanction" as const,
      sanctionId: sanction?.id ?? "",
      statement: "Those messages were not sent by me at all.",
    };
    const [first] = await t.db.insert(moderationAppeals).values(appeal).returning();
    expect(pgCode(await failure(t.db.insert(moderationAppeals).values(appeal)))).toBe("23505");
    const noReason = await failure(
      t.db
        .update(moderationAppeals)
        .set({ status: "upheld", decidedAt: new Date() })
        .where(eq(moderationAppeals.id, first?.id ?? "")),
    );
    expect(pgCode(noReason)).toBe("23514");
  });
});
