import {
  and,
  asc,
  branches,
  count,
  type Database,
  eq,
  type Executor,
  invitations,
  isNotNull,
  type Membership,
  memberships,
  or,
  type Organization,
  organizations,
  recordAuditEvent,
  type TenantContext,
  tenantFilter,
  type User,
  users,
} from "@fleettrust/db";
import {
  BRANCH_SCOPABLE_ROLES,
  type BranchDto,
  type CreateOrganizationRequest,
  type MemberDto,
  type MyOrganization,
  type Role,
  roleAllowedFor,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { EntitlementsService, subjectOfOrganization } from "../entitlements/index.js";
import { notFound, orgError, REFERENCED, sqlState, UNIQUE_VIOLATION } from "./errors.js";
import { toBranchDto, toMemberDto, toMyOrganization } from "./mappers.js";
import type { TenantAccess } from "./tenancy.js";

const requestId = () => currentRequestContext()?.requestId;

/**
 * Serializes membership changes within one organization (row lock on the organization), so
 * two owners demoting each other at the same time can't leave it without an owner.
 */
export async function lockOrganization(tx: Executor, tenant: TenantContext): Promise<void> {
  await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, tenant.organizationId))
    .for("update");
}

/**
 * Re-checks the caller's own membership under the organization lock: the guard read it
 * before the lock, and a concurrent change may have demoted or removed them since.
 */
export async function assertActorUnchanged(tx: Executor, access: TenantAccess): Promise<void> {
  const [row] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(tenantFilter(memberships, access.tenant), eq(memberships.id, access.membership.id)))
    .limit(1);
  if (row?.role !== access.role) throw orgError(409, "membership_changed");
}

export async function ownerCount(tx: Executor, tenant: TenantContext): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(memberships)
    .where(and(tenantFilter(memberships, tenant), eq(memberships.role, "owner")));
  return row?.n ?? 0;
}

/** A branch ID from a request body must name a branch of this organization. */
export async function assertBranchInTenant(
  tx: Executor,
  tenant: TenantContext,
  branchId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(tenantFilter(branches, tenant), eq(branches.id, branchId)))
    .limit(1);
  if (!row) throw orgError(400, "branch_not_found");
}

/**
 * Validates a role + branch scope for an organization (shared by invitations and member
 * updates). The database enforces the same rules; this turns them into clear 400s.
 */
export function assertAssignable(org: Organization, role: Role, branchId: string | null): void {
  if (!roleAllowedFor(org.kind, role)) throw orgError(400, "role_not_allowed");
  if (branchId !== null && !BRANCH_SCOPABLE_ROLES.includes(role)) {
    throw orgError(400, "role_not_allowed");
  }
}

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    private readonly entitlements: EntitlementsService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  /** Creates the organization with the caller as its first owner (SRS FR-02). */
  async create(user: User, input: CreateOrganizationRequest): Promise<MyOrganization> {
    return this.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ kind: input.kind, name: input.name, createdBy: user.id })
        .returning();
      if (!org) throw new Error("organization insert returned no row");
      const [membership] = await tx
        .insert(memberships)
        .values({
          organizationId: org.id,
          organizationKind: org.kind,
          userId: user.id,
          role: "owner",
        })
        .returning();
      if (!membership) throw new Error("membership insert returned no row");
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: user.id,
        organizationId: org.id,
        action: "org.created",
        targetType: "organization",
        targetId: org.id,
        requestId: requestId(),
        metadata: { kind: org.kind },
      });
      return toMyOrganization(org, membership);
    });
  }

  /** The organization switcher: every organization the user belongs to. */
  async listForUser(user: User): Promise<MyOrganization[]> {
    const rows = await this.db
      .select({ organization: organizations, membership: memberships })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, user.id))
      .orderBy(asc(organizations.name), asc(organizations.id));
    return rows.map((row) => toMyOrganization(row.organization, row.membership));
  }

  async update(
    access: TenantAccess,
    user: User,
    change: { name?: string | undefined; timeZone?: string | undefined },
  ): Promise<MyOrganization> {
    return this.db.transaction(async (tx) => {
      const [org] = await tx
        .update(organizations)
        .set({
          ...(change.name === undefined ? {} : { name: change.name }),
          ...(change.timeZone === undefined ? {} : { timezone: change.timeZone }),
        })
        .where(eq(organizations.id, access.tenant.organizationId))
        .returning();
      if (!org) throw notFound();
      await this.audit(tx, access, user, "org.updated", "organization", org.id, {
        fields: Object.keys(change).filter(
          (field) => change[field as keyof typeof change] !== undefined,
        ),
      });
      return toMyOrganization(org, access.membership);
    });
  }

  // --- Branches -------------------------------------------------------------------------

  /** Branch-scoped members see only their own branch. */
  async listBranches(access: TenantAccess): Promise<BranchDto[]> {
    const rows = await this.db
      .select()
      .from(branches)
      .where(
        and(
          tenantFilter(branches, access.tenant),
          access.branchScope === null ? undefined : eq(branches.id, access.branchScope),
        ),
      )
      .orderBy(asc(branches.name), asc(branches.id));
    return rows.map(toBranchDto);
  }

  async createBranch(access: TenantAccess, user: User, name: string): Promise<BranchDto> {
    return this.uniqueName(() =>
      this.db.transaction(async (tx) => {
        await lockOrganization(tx, access.tenant);
        await this.entitlements.assertCapacity(
          tx,
          subjectOfOrganization(access.organization),
          "branches.max",
        );
        const [branch] = await tx
          .insert(branches)
          .values({ organizationId: access.tenant.organizationId, name })
          .returning();
        if (!branch) throw new Error("branch insert returned no row");
        await this.audit(tx, access, user, "branch.created", "branch", branch.id);
        return toBranchDto(branch);
      }),
    );
  }

  async renameBranch(
    access: TenantAccess,
    user: User,
    branchId: string,
    name: string,
  ): Promise<BranchDto> {
    return this.uniqueName(() =>
      this.db.transaction(async (tx) => {
        const [branch] = await tx
          .update(branches)
          .set({ name })
          .where(and(tenantFilter(branches, access.tenant), eq(branches.id, branchId)))
          .returning();
        if (!branch) throw notFound();
        await this.audit(tx, access, user, "branch.renamed", "branch", branch.id);
        return toBranchDto(branch);
      }),
    );
  }

  /**
   * Deletes an unused branch. Refused (409 branch_in_use) while members or open invitations
   * are scoped to it; closed invitations just lose the branch reference.
   */
  async deleteBranch(access: TenantAccess, user: User, branchId: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(invitations)
          .set({ branchId: null })
          .where(
            and(
              tenantFilter(invitations, access.tenant),
              eq(invitations.branchId, branchId),
              or(isNotNull(invitations.acceptedAt), isNotNull(invitations.revokedAt)),
            ),
          );
        const deleted = await tx
          .delete(branches)
          .where(and(tenantFilter(branches, access.tenant), eq(branches.id, branchId)))
          .returning({ id: branches.id });
        if (deleted.length === 0) throw notFound();
        await this.audit(tx, access, user, "branch.deleted", "branch", branchId);
      });
    } catch (error) {
      if (REFERENCED.has(sqlState(error) ?? "")) throw orgError(409, "branch_in_use");
      throw error;
    }
  }

  // --- Members --------------------------------------------------------------------------

  /** Branch-scoped managers see only members of their branch (and themselves). */
  async listMembers(access: TenantAccess): Promise<MemberDto[]> {
    const rows = await this.db
      .select({
        membership: memberships,
        user: { displayName: users.displayName, email: users.email },
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          tenantFilter(memberships, access.tenant),
          access.branchScope === null
            ? undefined
            : or(
                eq(memberships.branchId, access.branchScope),
                eq(memberships.id, access.membership.id),
              ),
        ),
      )
      .orderBy(asc(memberships.createdAt), asc(memberships.id));
    return rows.map((row) => toMemberDto(row.membership, row.user));
  }

  /**
   * Changes a member's role and/or branch scope. Only owners may grant, change or remove the
   * owner role; the last owner can't be demoted.
   */
  async updateMember(
    access: TenantAccess,
    actor: User,
    membershipId: string,
    change: { role?: Role | undefined; branchId?: string | null | undefined },
  ): Promise<MemberDto> {
    return this.db.transaction(async (tx) => {
      await lockOrganization(tx, access.tenant);
      await assertActorUnchanged(tx, access);
      const target = await this.findMember(tx, access.tenant, membershipId);
      const currentRole = target.membership.role as Role;
      const role = change.role ?? currentRole;
      // Moving to a role that can't be branch-scoped drops the scope unless one was asked for.
      const branchId =
        change.branchId !== undefined
          ? change.branchId
          : BRANCH_SCOPABLE_ROLES.includes(role)
            ? target.membership.branchId
            : null;

      const touchesOwner = currentRole === "owner" || role === "owner";
      if (touchesOwner && !access.permissions.includes("owners.manage")) {
        throw orgError(403, "owner_role_required");
      }
      assertAssignable(access.organization, role, branchId);
      if (branchId !== null) await assertBranchInTenant(tx, access.tenant, branchId);
      if (
        currentRole === "owner" &&
        role !== "owner" &&
        (await ownerCount(tx, access.tenant)) <= 1
      ) {
        throw orgError(409, "last_owner");
      }

      const [updated] = await tx
        .update(memberships)
        .set({ role, branchId })
        .where(and(tenantFilter(memberships, access.tenant), eq(memberships.id, membershipId)))
        .returning();
      if (!updated) throw notFound();
      await this.audit(tx, access, actor, "member.role_changed", "membership", membershipId, {
        userId: updated.userId,
        fromRole: currentRole,
        toRole: role,
        branchId,
      });
      return toMemberDto(updated, target.user);
    });
  }

  /**
   * Removes a member, or leaves the organization when the target is the caller. Removing
   * someone else needs members.manage (owners.manage for an owner); the last owner can't go.
   */
  async removeMember(access: TenantAccess, actor: User, membershipId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockOrganization(tx, access.tenant);
      await assertActorUnchanged(tx, access);
      const target = await this.findMember(tx, access.tenant, membershipId);
      const self = target.membership.id === access.membership.id;
      const role = target.membership.role as Role;
      if (!self && !access.permissions.includes("members.manage")) {
        throw orgError(403, "insufficient_permission");
      }
      if (!self && role === "owner" && !access.permissions.includes("owners.manage")) {
        throw orgError(403, "owner_role_required");
      }
      if (role === "owner" && (await ownerCount(tx, access.tenant)) <= 1) {
        throw orgError(409, "last_owner");
      }
      await tx
        .delete(memberships)
        .where(and(tenantFilter(memberships, access.tenant), eq(memberships.id, membershipId)));
      await this.audit(
        tx,
        access,
        actor,
        self ? "member.left" : "member.removed",
        "membership",
        membershipId,
        { userId: target.membership.userId, role },
      );
    });
  }

  private async findMember(
    tx: Executor,
    tenant: TenantContext,
    membershipId: string,
  ): Promise<{ membership: Membership; user: Pick<User, "displayName" | "email"> }> {
    const [row] = await tx
      .select({
        membership: memberships,
        user: { displayName: users.displayName, email: users.email },
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(tenantFilter(memberships, tenant), eq(memberships.id, membershipId)))
      .limit(1);
    if (!row) throw notFound();
    return row;
  }

  private async uniqueName<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) throw orgError(409, "branch_name_taken");
      throw error;
    }
  }

  private async audit(
    tx: Executor,
    access: TenantAccess,
    actor: User,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: actor.id,
      organizationId: access.tenant.organizationId,
      action,
      targetType,
      targetId,
      requestId: requestId(),
      metadata,
    });
  }
}
