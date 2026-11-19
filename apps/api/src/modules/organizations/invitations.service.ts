import { createHash, randomBytes } from "node:crypto";

import {
  and,
  type Database,
  desc,
  eq,
  type Invitation,
  invitations,
  isNull,
  memberships,
  organizations,
  recordAuditEvent,
  tenantContext,
  tenantFilter,
  type User,
  users,
} from "@fleettrust/db";
import type {
  CreatedInvitation,
  CreateInvitationRequest,
  InvitationDto,
  MyOrganization,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import type { AuthContext } from "../identity/index.js";
import { notFound, orgError } from "./errors.js";
import { toInvitationDto, toMyOrganization } from "./mappers.js";
import {
  assertActorUnchanged,
  assertAssignable,
  assertBranchInTenant,
  lockOrganization,
} from "./organizations.service.js";
import type { TenantAccess } from "./tenancy.js";

/** Invitations expire after a week; re-inviting issues a fresh token and revokes the old one. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const requestId = () => currentRequestContext()?.requestId;

/** 256-bit, URL-safe, 43 characters. Only its SHA-256 is stored. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * The token travels in the URL fragment, which browsers never send to servers, so it stays
 * out of access logs, proxies and Referer headers.
 */
export function acceptPath(token: string): string {
  return `/invitations/accept#token=${token}`;
}

type CreateInput = Required<Pick<CreateInvitationRequest, "email" | "role">> & {
  branchId: string | null;
};

@Injectable()
export class InvitationsService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseProvider) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  async create(access: TenantAccess, actor: User, input: CreateInput): Promise<CreatedInvitation> {
    if (input.role === "owner" && !access.permissions.includes("owners.manage")) {
      throw orgError(403, "owner_role_required");
    }
    assertAssignable(access.organization, input.role, input.branchId);

    const token = newToken();
    const invitation = await this.db.transaction(async (tx) => {
      await lockOrganization(tx, access.tenant);
      await assertActorUnchanged(tx, access);
      if (input.branchId !== null) await assertBranchInTenant(tx, access.tenant, input.branchId);

      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(tenantFilter(memberships, access.tenant), eq(users.email, input.email)))
        .limit(1);
      if (member) throw orgError(409, "already_member");

      // A new invitation supersedes any open one for the same person.
      const superseded = await tx
        .update(invitations)
        .set({ revokedAt: new Date(), revokedBy: actor.id })
        .where(
          and(
            tenantFilter(invitations, access.tenant),
            eq(invitations.email, input.email),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        )
        .returning({ id: invitations.id });

      const [row] = await tx
        .insert(invitations)
        .values({
          organizationId: access.organization.id,
          organizationKind: access.organization.kind,
          email: input.email,
          role: input.role,
          branchId: input.branchId,
          tokenHash: hashInvitationToken(token),
          invitedBy: actor.id,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        })
        .returning();
      if (!row) throw new Error("invitation insert returned no row");
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: actor.id,
        organizationId: row.organizationId,
        action: "invitation.created",
        targetType: "invitation",
        targetId: row.id,
        requestId: requestId(),
        // No email or token in the audit trail: the invitation row holds the address.
        metadata: {
          role: row.role,
          branchId: row.branchId,
          superseded: superseded.map((s) => s.id),
        },
      });
      return row;
    });

    return { invitation: toInvitationDto(invitation), token, acceptPath: acceptPath(token) };
  }

  /** Open invitations (not accepted or revoked), newest first. Expired ones are included. */
  async listOpen(access: TenantAccess): Promise<InvitationDto[]> {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(
        and(
          tenantFilter(invitations, access.tenant),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .orderBy(desc(invitations.createdAt), desc(invitations.id));
    return rows.map(toInvitationDto);
  }

  async revoke(access: TenantAccess, actor: User, invitationId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const open = and(
        tenantFilter(invitations, access.tenant),
        eq(invitations.id, invitationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      );
      const [existing] = await tx.select().from(invitations).where(open).limit(1).for("update");
      if (!existing) throw notFound();
      if (existing.role === "owner" && !access.permissions.includes("owners.manage")) {
        throw orgError(403, "owner_role_required");
      }
      await tx.update(invitations).set({ revokedAt: new Date(), revokedBy: actor.id }).where(open);
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: actor.id,
        organizationId: existing.organizationId,
        action: "invitation.revoked",
        targetType: "invitation",
        targetId: existing.id,
        requestId: requestId(),
      });
    });
  }

  /**
   * Accepts an invitation as the signed-in user. The token proves the link was received; the
   * verified email proves it was received by the person it was sent to.
   */
  async accept(auth: AuthContext, token: string): Promise<MyOrganization> {
    const { user, identity } = auth;
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ invitation: invitations, organization: organizations })
        .from(invitations)
        .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
        .where(eq(invitations.tokenHash, hashInvitationToken(token)))
        .limit(1)
        .for("update", { of: invitations });
      if (!found) throw orgError(404, "invitation_not_found");
      const { invitation, organization } = found;
      assertOpen(invitation);
      if (organization.status !== "active") throw orgError(403, "organization_suspended");
      if (!identity.emailVerified) throw orgError(403, "email_not_verified");
      if (identity.email?.toLowerCase() !== invitation.email) {
        throw orgError(403, "invitation_email_mismatch");
      }

      const tenant = tenantContext(invitation.organizationId);
      const [existing] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(tenantFilter(memberships, tenant), eq(memberships.userId, user.id)))
        .limit(1);
      if (existing) throw orgError(409, "already_member");

      const [membership] = await tx
        .insert(memberships)
        .values({
          organizationId: invitation.organizationId,
          organizationKind: invitation.organizationKind,
          userId: user.id,
          role: invitation.role,
          branchId: invitation.branchId,
        })
        .returning();
      if (!membership) throw new Error("membership insert returned no row");
      await tx
        .update(invitations)
        .set({ acceptedAt: new Date(), acceptedBy: user.id })
        .where(eq(invitations.id, invitation.id));
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: user.id,
        organizationId: invitation.organizationId,
        action: "invitation.accepted",
        targetType: "invitation",
        targetId: invitation.id,
        requestId: requestId(),
        metadata: { membershipId: membership.id, role: membership.role },
      });
      return toMyOrganization(organization, membership);
    });
  }
}

function assertOpen(invitation: Invitation): void {
  if (invitation.revokedAt !== null) throw orgError(410, "invitation_revoked");
  if (invitation.acceptedAt !== null) throw orgError(410, "invitation_used");
  if (invitation.expiresAt.getTime() <= Date.now()) throw orgError(410, "invitation_expired");
}
