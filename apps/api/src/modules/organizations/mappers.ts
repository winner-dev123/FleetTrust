import type { Branch, Invitation, Membership, Organization, User } from "@fleettrust/db";
import {
  type BranchDto,
  type InvitationDto,
  type MemberDto,
  type MyOrganization,
  type OrganizationDto,
  ROLE_PERMISSIONS,
  type Role,
} from "@fleettrust/types";

export function toOrganizationDto(org: Organization): OrganizationDto {
  return {
    id: org.id,
    kind: org.kind,
    name: org.name,
    status: org.status,
    timeZone: org.timezone,
    createdAt: org.createdAt.toISOString(),
  };
}

export function toMyOrganization(org: Organization, membership: Membership): MyOrganization {
  const role = membership.role as Role;
  return {
    organization: toOrganizationDto(org),
    membershipId: membership.id,
    role,
    branchId: membership.branchId,
    permissions: [...ROLE_PERMISSIONS[role]],
  };
}

export function toBranchDto(branch: Branch): BranchDto {
  return {
    id: branch.id,
    organizationId: branch.organizationId,
    name: branch.name,
    addressLine1: branch.addressLine1,
    addressLine2: branch.addressLine2,
    locality: branch.locality,
    region: branch.region,
    postalCode: branch.postalCode,
    countryCode: branch.countryCode,
    location: branch.location,
    serviceRadiusKm: branch.serviceRadiusKm,
    phone: branch.phone,
    createdAt: branch.createdAt.toISOString(),
  };
}

export function toMemberDto(
  membership: Membership,
  user: Pick<User, "displayName" | "email">,
): MemberDto {
  return {
    membershipId: membership.id,
    userId: membership.userId,
    displayName: user.displayName,
    email: user.email,
    role: membership.role as Role,
    branchId: membership.branchId,
    joinedAt: membership.createdAt.toISOString(),
  };
}

export function toInvitationDto(invitation: Invitation): InvitationDto {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role as Role,
    branchId: invitation.branchId,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}
