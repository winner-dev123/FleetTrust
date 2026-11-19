import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { Executor } from "../database.js";
import { planVersionLimits, planVersions, plans } from "../schema/plans.js";
import { PLAN_CATALOG, type PlanDefinition } from "./plans.data.js";

function sameTerms(
  definition: PlanDefinition,
  version: { priceMinor: number | null; currency: string | null; billingPeriod: string | null },
  limits: readonly { key: string; limitValue: number | null }[],
): boolean {
  const price = definition.price;
  if ((price?.amountMinor ?? null) !== version.priceMinor) return false;
  if ((price?.currency ?? null) !== version.currency) return false;
  if ((price?.period ?? null) !== version.billingPeriod) return false;
  const wanted = Object.entries(definition.limits);
  if (wanted.length !== limits.length) return false;
  const actual = new Map(limits.map((limit) => [limit.key, limit.limitValue]));
  return wanted.every(([key, value]) => actual.has(key) && actual.get(key) === value);
}

/**
 * Converges the catalog on PLAN_CATALOG. A plan whose terms changed gets a new published
 * version and its previous published version is retired (still valid for existing
 * assignments). Unchanged plans are left alone, so re-runs are no-ops.
 */
export async function seedPlans(
  executor: Executor,
  catalog: readonly PlanDefinition[] = PLAN_CATALOG,
): Promise<number> {
  const defaults = catalog.filter((plan) => plan.isDefault).map((plan) => plan.code);
  // Clear stale defaults first so the one-default-per-audience index never trips mid-seed.
  await executor
    .update(plans)
    .set({ isDefault: false })
    .where(
      and(
        eq(plans.isDefault, true),
        defaults.length > 0 ? notInArray(plans.code, defaults) : undefined,
      ),
    );

  for (const definition of catalog) {
    await executor
      .insert(plans)
      .values({
        code: definition.code,
        audience: definition.audience,
        name: definition.name,
        isDefault: definition.isDefault,
      })
      .onConflictDoUpdate({
        target: plans.code,
        set: {
          audience: sql`excluded.audience`,
          name: sql`excluded.name`,
          isDefault: sql`excluded.is_default`,
        },
        setWhere: sql`(${plans.audience}, ${plans.name}, ${plans.isDefault}) IS DISTINCT FROM (excluded.audience, excluded.name, excluded.is_default)`,
      });
    const [plan] = await executor
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.code, definition.code));
    if (!plan) throw new Error(`plan ${definition.code} missing after upsert`);

    const versions = await executor
      .select()
      .from(planVersions)
      .where(eq(planVersions.planId, plan.id))
      .orderBy(desc(planVersions.version));
    const published = versions.filter((version) => version.status === "published");
    const current = published[0];
    if (current) {
      const limits = await executor
        .select()
        .from(planVersionLimits)
        .where(eq(planVersionLimits.planVersionId, current.id));
      if (sameTerms(definition, current, limits)) continue;
    }

    const [draft] = await executor
      .insert(planVersions)
      .values({
        planId: plan.id,
        version: (versions[0]?.version ?? 0) + 1,
        priceMinor: definition.price?.amountMinor ?? null,
        currency: definition.price?.currency ?? null,
        billingPeriod: definition.price?.period ?? null,
      })
      .returning({ id: planVersions.id });
    if (!draft) throw new Error("plan version insert returned no row");
    const limitRows = Object.entries(definition.limits).map(([key, limitValue]) => ({
      planVersionId: draft.id,
      key,
      limitValue,
    }));
    if (limitRows.length > 0) await executor.insert(planVersionLimits).values(limitRows);
    if (published.length > 0) {
      await executor
        .update(planVersions)
        .set({ status: "retired" })
        .where(
          inArray(
            planVersions.id,
            published.map((version) => version.id),
          ),
        );
    }
    await executor
      .update(planVersions)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(planVersions.id, draft.id));
  }
  return catalog.length;
}
