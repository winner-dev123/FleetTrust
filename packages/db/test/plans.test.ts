import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { consumeDailyQuota, dailyUsage, localDate } from "../src/quotas.js";
import {
  organizations,
  planAssignments,
  planVersionLimits,
  planVersions,
  plans,
  quotaCounters,
  users,
} from "../src/schema/index.js";
import { PLAN_CATALOG, type PlanDefinition } from "../src/seed/plans.data.js";
import { seedPlans } from "../src/seed/plans.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

let t: TestDatabase;
let userId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const [user] = await t.db.insert(users).values({ firebaseUid: "uid-plans" }).returning();
  userId = user?.id ?? "";
});

afterAll(async () => {
  await t.close();
});

async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : (error as Error).message;
  }
  throw new Error("expected the database to reject the statement");
}

async function publishedVersion(code: string) {
  const [row] = await t.db
    .select({ version: planVersions })
    .from(planVersions)
    .innerJoin(plans, eq(plans.id, planVersions.planId))
    .where(and(eq(plans.code, code), eq(planVersions.status, "published")));
  if (!row) throw new Error(`no published version of ${code}`);
  return row.version;
}

describe("plan catalog", () => {
  it("is seeded with one default plan per audience and published versions", async () => {
    const rows = await t.db.select().from(plans);
    expect(rows).toHaveLength(PLAN_CATALOG.length);
    const defaults = rows.filter((plan) => plan.isDefault).map((plan) => plan.audience);
    expect(defaults.sort()).toEqual(["fleet", "provider", "user"]);
    const free = await publishedVersion("provider-free");
    expect(free.version).toBe(1);
    const limits = await t.db
      .select()
      .from(planVersionLimits)
      .where(eq(planVersionLimits.planVersionId, free.id));
    expect(Object.fromEntries(limits.map((l) => [l.key, l.limitValue]))).toEqual(
      PLAN_CATALOG.find((plan) => plan.code === "provider-free")?.limits,
    );
  });

  it("published versions and their limits are immutable", async () => {
    const pro = await publishedVersion("provider-pro");
    expect(
      await dbError(
        t.db.update(planVersions).set({ priceMinor: 1 }).where(eq(planVersions.id, pro.id)),
      ),
    ).toMatch(/immutable/);
    expect(
      await dbError(
        t.db
          .update(planVersionLimits)
          .set({ limitValue: 999 })
          .where(eq(planVersionLimits.planVersionId, pro.id)),
      ),
    ).toMatch(/immutable/);
    expect(
      await dbError(
        t.db
          .insert(planVersionLimits)
          .values({ planVersionId: pro.id, key: "extra.thing", limitValue: 1 }),
      ),
    ).toMatch(/immutable/);
    expect(await dbError(t.db.delete(planVersions).where(eq(planVersions.id, pro.id)))).toMatch(
      /cannot be deleted/,
    );
    // The one allowed transition: published → retired (and never back).
    const [retired] = await t.db
      .update(planVersions)
      .set({ status: "retired" })
      .where(eq(planVersions.id, pro.id))
      .returning();
    expect(retired?.status).toBe("retired");
    expect(
      await dbError(
        t.db.update(planVersions).set({ status: "published" }).where(eq(planVersions.id, pro.id)),
      ),
    ).toMatch(/immutable/);
  });

  it("changing a plan's terms publishes a new version and retires the old one; re-runs are no-ops", async () => {
    const before = await publishedVersion("fleet-pro");
    const changed: PlanDefinition[] = PLAN_CATALOG.map((plan) =>
      plan.code === "fleet-pro"
        ? { ...plan, limits: { ...plan.limits, "branches.max": 75 } }
        : plan,
    );
    await seedPlans(t.db, changed);
    const after = await publishedVersion("fleet-pro");
    expect(after.version).toBe(before.version + 1);
    const [old] = await t.db.select().from(planVersions).where(eq(planVersions.id, before.id));
    expect(old?.status).toBe("retired");

    const count = await t.db.select().from(planVersions);
    await seedPlans(t.db, changed);
    expect(await t.db.select().from(planVersions)).toHaveLength(count.length);
  });

  it("an assignment names exactly one subject of the declared type", async () => {
    const free = await publishedVersion("personal-free");
    const [org] = await t.db
      .insert(organizations)
      .values({ kind: "fleet", name: "Assign Co", createdBy: userId })
      .returning();
    const base = {
      planVersionId: free.id,
      externalReference: "INV-1",
      assignedBy: userId,
    };
    expect(
      await dbError(
        t.db
          .insert(planAssignments)
          .values({ ...base, subjectType: "user", organizationId: org?.id }),
      ),
    ).toMatch(/plan_assignments_subject/);
    expect(
      await dbError(
        t.db
          .insert(planAssignments)
          .values({ ...base, subjectType: "organization", organizationId: org?.id, userId }),
      ),
    ).toMatch(/plan_assignments_subject/);
    expect(
      await dbError(
        t.db
          .insert(planAssignments)
          .values({ ...base, subjectType: "user", userId, externalReference: "" }),
      ),
    ).toMatch(/plan_assignments_reference_length/);
  });
});

describe("daily quota counters", () => {
  const subject = { type: "user" as const, id: "0190f4a6-1c2b-7d3e-8f40-0000000000a1" };
  const day = "2026-11-19";

  it("never exceeds the limit, even with many simultaneous requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeDailyQuota(t.db, {
          subject,
          key: "friend_requests.daily",
          periodStart: day,
          limit: 5,
        }),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect((await dailyUsage(t.db, subject, day)).get("friend_requests.daily")).toBe(5);
  });

  it("counts a retried request once (idempotency key)", async () => {
    const input = {
      subject,
      key: "articles.daily",
      periodStart: day,
      limit: 3,
      idempotencyKey: "article-123",
    };
    const results = await Promise.all([1, 2, 3, 4].map(() => consumeDailyQuota(t.db, input)));
    expect(results.every((r) => r.allowed)).toBe(true);
    expect(results.filter((r) => r.allowed && !r.replayed)).toHaveLength(1);
    expect((await dailyUsage(t.db, subject, day)).get("articles.daily")).toBe(1);
  });

  it("a denied request leaves no idempotency record behind", async () => {
    const full = { subject, key: "groups.daily", periodStart: day, limit: 1 };
    await consumeDailyQuota(t.db, { ...full, idempotencyKey: "g-1" });
    expect(await consumeDailyQuota(t.db, { ...full, idempotencyKey: "g-2" })).toMatchObject({
      allowed: false,
      used: 1,
    });
    // Once the limit allows it (e.g. an override), the same key can still succeed.
    expect(
      await consumeDailyQuota(t.db, { ...full, limit: 2, idempotencyKey: "g-2" }),
    ).toMatchObject({
      allowed: true,
      replayed: false,
      used: 2,
    });
  });

  it("rolls back with the surrounding transaction", async () => {
    const key = "service_requests.daily";
    await t.db
      .transaction(async (tx) => {
        await consumeDailyQuota(tx, { subject, key, periodStart: day, limit: 3 });
        throw new Error("creating the request failed");
      })
      .catch(() => undefined);
    expect((await dailyUsage(t.db, subject, day)).get(key)).toBeUndefined();
  });

  it("limit 0 refuses and unlimited still counts usage", async () => {
    const other = { type: "organization" as const, id: "0190f4a6-1c2b-7d3e-8f40-0000000000b2" };
    expect(
      await consumeDailyQuota(t.db, {
        subject: other,
        key: "articles.daily",
        periodStart: day,
        limit: 0,
      }),
    ).toEqual({ allowed: false, used: 0 });
    for (let i = 0; i < 3; i++) {
      await consumeDailyQuota(t.db, {
        subject: other,
        key: "groups.daily",
        periodStart: day,
        limit: null,
      });
    }
    expect((await dailyUsage(t.db, other, day)).get("groups.daily")).toBe(3);
  });

  it("a new local day starts a fresh counter", async () => {
    const key = "friend_requests.daily";
    const next = "2026-11-20";
    expect(
      await consumeDailyQuota(t.db, { subject, key, periodStart: day, limit: 5 }),
    ).toMatchObject({
      allowed: false,
    });
    expect(
      await consumeDailyQuota(t.db, { subject, key, periodStart: next, limit: 5 }),
    ).toMatchObject({
      allowed: true,
      used: 1,
    });
    const rows = await t.db
      .select()
      .from(quotaCounters)
      .where(and(eq(quotaCounters.subjectId, subject.id), eq(quotaCounters.key, key)));
    expect(rows.map((row) => row.periodStart).sort()).toEqual([day, next]);
  });

  it("local days follow the subject's timezone", () => {
    const instant = new Date("2026-11-19T12:30:00Z");
    expect(localDate(instant, "UTC")).toBe("2026-11-19");
    expect(localDate(instant, "Pacific/Auckland")).toBe("2026-11-20"); // UTC+13
    expect(localDate(instant, "Pacific/Honolulu")).toBe("2026-11-19");
    expect(localDate(new Date("2026-11-19T09:59:59Z"), "Pacific/Honolulu")).toBe("2026-11-18");
  });
});
