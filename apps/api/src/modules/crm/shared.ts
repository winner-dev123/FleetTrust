import {
  and,
  eq,
  type Executor,
  inArray,
  memberships,
  type ServiceRequest,
  type ServiceRequestRecipient,
  serviceRequestRecipients,
} from "@fleettrust/db";
import {
  type CrmErrorReason,
  hasPermission,
  type PipelineStage,
  RESPONSE_TARGET_HOURS,
  type Role,
} from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import type { TenantAccess } from "../organizations/index.js";

export function crmError(status: 400 | 403 | 409, reason: CrmErrorReason): Error {
  const error = status === 400 ? "bad_request" : status === 403 ? "forbidden" : "conflict";
  const body = { statusCode: status, error, reason };
  if (status === 403) return new ForbiddenException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
}

export const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

export function assertProvider(access: TenantAccess): void {
  if (access.organization.kind !== "provider") throw crmError(400, "not_a_provider");
}

/** Managers: assign work, manage availability, book appointments, see analytics. */
export function canManage(access: TenantAccess): boolean {
  return hasPermission(access.role, "crm.manage");
}

export function assertManager(access: TenantAccess): void {
  if (!canManage(access)) throw crmError(403, "not_allowed");
}

/** Whether a branch-bound record is inside the caller's branch scope. */
export function inScope(access: TenantAccess, branchId: string | null): boolean {
  return access.branchScope === null || access.branchScope === branchId;
}

/** Roles that can take inquiries, tasks and appointments. */
export const STAFF_ROLES = ["owner", "admin", "manager", "staff"] as const;

/**
 * A member who can work on something at `branchId`: an organization-wide member, or one scoped
 * to that branch. Work routed to the whole organization (`branchId` null) needs an
 * organization-wide member.
 */
export async function eligibleMember(
  executor: Executor,
  organizationId: string,
  userId: string,
  branchId: string | null,
): Promise<{ userId: string; role: Role; branchId: string | null } | null> {
  const [member] = await executor
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
        inArray(memberships.role, [...STAFF_ROLES]),
      ),
    );
  if (!member) return null;
  if (member.branchId !== null && member.branchId !== branchId) return null;
  return { userId: member.userId, role: member.role as Role, branchId: member.branchId };
}

/** The caller's inquiry (recipient row), within branch scope; 404 otherwise. */
export async function recipientInScope(
  executor: Executor,
  access: TenantAccess,
  recipientId: string,
): Promise<ServiceRequestRecipient> {
  const [row] = await executor
    .select()
    .from(serviceRequestRecipients)
    .where(
      and(
        eq(serviceRequestRecipients.id, recipientId),
        eq(serviceRequestRecipients.organizationId, access.tenant.organizationId),
      ),
    );
  if (!row || !inScope(access, row.branchId)) throw notFound();
  return row;
}

const LOST = new Set(["declined", "not_selected", "cancelled"]);

/** Pipeline stage from the inquiry and request status (ADR-0027). */
export function stageOf(
  recipient: Pick<ServiceRequestRecipient, "status">,
  request: Pick<ServiceRequest, "status" | "expiresAt">,
  now: Date,
): PipelineStage {
  if (recipient.status === "accepted") return request.status === "completed" ? "completed" : "won";
  if (LOST.has(recipient.status)) return "lost";
  const ended =
    request.status === "cancelled" ||
    request.status === "completed" ||
    (request.status === "open" && request.expiresAt <= now);
  if (ended || request.status === "accepted") return "lost";
  if (recipient.status === "quoted") return "quoted";
  return recipient.status === "viewed" ? "open" : "new";
}

/** When the first reply is due, from the request urgency. */
export function responseDueAt(createdAt: Date, urgency: ServiceRequest["urgency"]): Date {
  return new Date(createdAt.getTime() + RESPONSE_TARGET_HOURS[urgency] * 3_600_000);
}

/** Postgres exclusion_violation (the appointments double-booking constraint). */
export function isExclusionViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    if ((current as { code?: unknown }).code === "23P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function summaryOf(description: string): string {
  return description.length > 140 ? `${description.slice(0, 139)}…` : description;
}
