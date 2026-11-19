import type { IncomingMessage } from "node:http";

import {
  and,
  type Database,
  eq,
  type Membership,
  memberships,
  type Organization,
  organizations,
  type TenantContext,
  tenantContext,
} from "@fleettrust/db";
import { hasPermission, type Permission, ROLE_PERMISSIONS, type Role } from "@fleettrust/types";
import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import type { AuthenticatedRequest } from "../identity/index.js";
import { notFound, orgError } from "./errors.js";

const ORG_PERMISSION = Symbol("org-permission");

/** The caller's verified standing in the organization named by `:orgId`. */
export interface TenantAccess {
  /** Branded tenant ID: pass to repositories / tenantFilter. */
  tenant: TenantContext;
  organization: Organization;
  membership: Membership;
  role: Role;
  permissions: readonly Permission[];
  /** Set when the membership is limited to one branch: listings are narrowed to it. */
  branchScope: string | null;
}

export interface TenantRequest extends AuthenticatedRequest {
  tenant?: TenantAccess;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Tenancy guard (SRS FR-02, ADR-0014). Runs after the global AuthGuard, on routes with an
 * `:orgId` parameter: the caller must be a member (else 404, so other tenants' IDs can't be
 * probed), the organization must be active, and the member's role must grant the permission.
 * This is the only place TenantContext values are minted from user input.
 */
@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly database: DatabaseProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(ORG_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (permission === undefined) throw new Error("TenancyGuard used without @OrgPermission()");

    const request = context
      .switchToHttp()
      .getRequest<IncomingMessage & TenantRequest & { params?: Record<string, string> }>();
    const user = request.auth?.user;
    if (!user) throw new Error("TenancyGuard ran before authentication");
    const orgId = request.params?.["orgId"];
    if (orgId === undefined) throw new Error("@OrgPermission() route has no :orgId parameter");
    if (!UUID.test(orgId)) throw notFound();

    const db: Database | undefined = this.database?.db;
    if (!db) throw new Error("DATABASE_URL is not configured");
    const [row] = await db
      .select({ organization: organizations, membership: memberships })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, user.id)))
      .limit(1);
    if (!row) throw notFound();
    if (row.organization.status !== "active") throw orgError(403, "organization_suspended");

    const role = row.membership.role as Role;
    if (!hasPermission(role, permission)) throw orgError(403, "insufficient_permission");

    request.tenant = {
      tenant: tenantContext(orgId),
      organization: row.organization,
      membership: row.membership,
      role,
      permissions: ROLE_PERMISSIONS[role],
      branchScope: row.membership.branchId,
    };
    return true;
  }
}

/**
 * Route acts inside the organization in `:orgId` and needs `permission`. Implies sign-in
 * (global AuthGuard) and membership. Inject the result with @CurrentTenant().
 */
export const OrgPermission = (permission: Permission) =>
  applyDecorators(SetMetadata(ORG_PERMISSION, permission), UseGuards(TenancyGuard));

export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantAccess => {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    if (!request.tenant) throw new Error("CurrentTenant used on a route without @OrgPermission()");
    return request.tenant;
  },
);
