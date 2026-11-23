import { and, eq, type Executor, memberships, organizations, type User } from "@fleettrust/db";
import {
  hasPermission,
  type Permission,
  type RequestErrorReason,
  type Role,
} from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import type { TenantAccess } from "../organizations/index.js";

export function requestError(status: 400 | 409 | 422, reason: RequestErrorReason): Error {
  const error = status === 400 ? "bad_request" : status === 409 ? "conflict" : "unprocessable";
  const body = { statusCode: status, error, reason };
  if (status === 409) return new ConflictException(body);
  if (status === 422) return new UnprocessableEntityException(body);
  return new BadRequestException(body);
}

export const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

/** Who is acting on the requester side: an individual, or a fleet member. */
export type Requester =
  { kind: "user"; user: User } | { kind: "organization"; user: User; access: TenantAccess };

/** The caller's standing in an organization outside the TenancyGuard (attachment downloads). */
export async function membershipOf(
  executor: Executor,
  user: User,
  organizationId: string,
  permission: Permission,
): Promise<{ branchScope: string | null; role: Role } | null> {
  const [row] = await executor
    .select({ membership: memberships, status: organizations.status })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, user.id)));
  if (row?.status !== "active") return null;
  const role = row.membership.role as Role;
  if (!hasPermission(role, permission)) return null;
  return { branchScope: row.membership.branchId, role };
}
