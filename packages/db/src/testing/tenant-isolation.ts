import { type TenantContext, tenantContext } from "../tenancy.js";

/**
 * Reusable tenant-leak check for every org-scoped resource (docs/qa/tenant-isolation-test-plan.md).
 * Framework-agnostic: returns a list of violations, so tests assert it is empty.
 */
export interface TenantIsolationCase<TRow extends { id: string }> {
  /** Resource name for messages, e.g. "vehicles". */
  resource: string;
  /** Creates one row owned by the tenant and returns it. */
  create(tenant: TenantContext): Promise<TRow>;
  /** List as the tenant (the repository's normal list/search path). */
  list(tenant: TenantContext): Promise<readonly TRow[]>;
  /** Fetch by ID as the tenant. Must return null/undefined or throw for another tenant's row. */
  getById(tenant: TenantContext, id: string): Promise<TRow | null | undefined>;
  /** Optional mutation as the tenant; must not affect another tenant's row. Return affected count. */
  update?(tenant: TenantContext, id: string): Promise<number>;
  /** Optional delete as the tenant; must not delete another tenant's row. Return affected count. */
  remove?(tenant: TenantContext, id: string): Promise<number>;
}

export async function expectTenantIsolation<TRow extends { id: string }>(
  testCase: TenantIsolationCase<TRow>,
  tenants: readonly [string, string] = [
    "00000000-0000-7000-8000-00000000000a",
    "00000000-0000-7000-8000-00000000000b",
  ],
): Promise<string[]> {
  const [a, b] = tenants.map((id) => tenantContext(id)) as [TenantContext, TenantContext];
  const violations: string[] = [];
  const rowA = await testCase.create(a);
  const rowB = await testCase.create(b);

  const listedByB = await testCase.list(b);
  if (listedByB.some((row) => row.id === rowA.id)) {
    violations.push(`${testCase.resource}: tenant B can list tenant A's row`);
  }
  if (!listedByB.some((row) => row.id === rowB.id)) {
    violations.push(`${testCase.resource}: tenant B cannot list its own row (test setup is wrong)`);
  }

  const fetched = await testCase.getById(b, rowA.id).catch(() => null);
  if (fetched) violations.push(`${testCase.resource}: tenant B can read tenant A's row by ID`);

  if (testCase.update) {
    const affected = await testCase.update(b, rowA.id).catch(() => 0);
    if (affected > 0) violations.push(`${testCase.resource}: tenant B can update tenant A's row`);
  }
  if (testCase.remove) {
    const affected = await testCase.remove(b, rowA.id).catch(() => 0);
    if (affected > 0) violations.push(`${testCase.resource}: tenant B can delete tenant A's row`);
    const stillThere = await testCase.getById(a, rowA.id);
    if (!stillThere)
      violations.push(`${testCase.resource}: tenant A's row disappeared after tenant B's delete`);
  }
  return violations;
}
