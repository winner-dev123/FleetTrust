import { type AnyColumn, eq, type SQL } from "drizzle-orm";

/**
 * Tenant scoping (SRS FR-02, ADR-0005). Every org-scoped table has an `organization_id`
 * column, and every org-scoped query must filter on it. Repositories take a TenantContext
 * as their first argument so forgetting the filter is a type error, not a runtime leak.
 * Postgres row-level security as a second layer is evaluated in Prompt 07.
 */

declare const tenantBrand: unique symbol;

/** An organization ID that has been checked against the caller's membership by the API guard. */
export type TenantId = string & { readonly [tenantBrand]: true };

export interface TenantContext {
  readonly organizationId: TenantId;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Brands an organization ID. Only the tenancy guard (Prompt 07) should call this, and
 * only after verifying membership; elsewhere, accept a TenantContext instead.
 */
export function tenantContext(organizationId: string): TenantContext {
  if (!UUID.test(organizationId)) throw new TypeError("organizationId must be a UUID");
  return { organizationId: organizationId as TenantId };
}

/** `WHERE <table>.organization_id = <tenant>`. Combine with other conditions using and(). */
export function tenantFilter(table: { organizationId: AnyColumn }, tenant: TenantContext): SQL {
  return eq(table.organizationId, tenant.organizationId);
}

/** Defence in depth for rows loaded by ID: throws instead of returning another tenant's row. */
export function assertSameTenant<T extends { organizationId: string | null }>(
  row: T,
  tenant: TenantContext,
): T {
  if (row.organizationId !== tenant.organizationId) {
    throw new TenantMismatchError();
  }
  return row;
}

/** Deliberately carries no IDs, so it can't leak another tenant's identifiers into logs or responses. */
export class TenantMismatchError extends Error {
  constructor() {
    super("Row does not belong to the current tenant");
    this.name = "TenantMismatchError";
  }
}
