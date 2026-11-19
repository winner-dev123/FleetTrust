import { z } from "zod";

/** SRS §2.2: providers (workshops, towing, …) and fleets (vehicle operators). */
export const ORGANIZATION_KINDS = ["provider", "fleet"] as const;
export const organizationKindSchema = z.enum(ORGANIZATION_KINDS);
export type OrganizationKind = z.infer<typeof organizationKindSchema>;

export const ROLES = ["owner", "admin", "manager", "staff", "driver", "recruiter"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Roles each kind of organization can grant. Enforced by the database too. */
export const ROLES_BY_KIND: Readonly<Record<OrganizationKind, readonly Role[]>> = {
  provider: ["owner", "admin", "manager", "staff"],
  fleet: ["owner", "admin", "manager", "driver", "recruiter"],
};

/** Roles that may be limited to one branch (null branch = whole organization). */
export const BRANCH_SCOPABLE_ROLES: readonly Role[] = ["manager", "staff", "driver"];

export const PERMISSIONS = [
  "org.read",
  "org.update",
  "branches.read",
  "branches.manage",
  "members.read",
  "members.manage",
  "invitations.manage",
  "owners.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role → permissions. Later prompts add domain permissions (catalog, requests, vehicles, jobs)
 * here; the tenancy guard checks them by name. Admins manage members but only owners can
 * grant, change or remove the owner role.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: PERMISSIONS,
  admin: [
    "org.read",
    "org.update",
    "branches.read",
    "branches.manage",
    "members.read",
    "members.manage",
    "invitations.manage",
  ],
  manager: ["org.read", "branches.read", "members.read"],
  staff: ["org.read", "branches.read"],
  driver: ["org.read", "branches.read"],
  recruiter: ["org.read"],
};

export function roleAllowedFor(kind: OrganizationKind, role: Role): boolean {
  return ROLES_BY_KIND[kind].includes(role);
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(120, "Name must be 120 characters or fewer")
  .refine((value) => !/\p{Cc}|\p{Cf}/u.test(value), "Name contains invalid characters");

export const createOrganizationRequestSchema = z
  .object({ kind: organizationKindSchema, name: nameSchema })
  .strict();
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;

export const updateOrganizationRequestSchema = z.object({ name: nameSchema }).strict();

export const branchRequestSchema = z.object({ name: nameSchema }).strict();

export const organizationSchema = z.object({
  id: z.uuid(),
  kind: organizationKindSchema,
  name: z.string(),
  status: z.enum(["active", "suspended"]),
  createdAt: z.iso.datetime(),
});
export type OrganizationDto = z.infer<typeof organizationSchema>;

/** One entry in the organization switcher: the org plus the caller's role in it. */
export const myOrganizationSchema = z.object({
  organization: organizationSchema,
  membershipId: z.uuid(),
  role: roleSchema,
  branchId: z.uuid().nullable(),
  permissions: z.array(z.enum(PERMISSIONS)),
});
export type MyOrganization = z.infer<typeof myOrganizationSchema>;

export const branchSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});
export type BranchDto = z.infer<typeof branchSchema>;

export const memberSchema = z.object({
  membershipId: z.uuid(),
  userId: z.uuid(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  role: roleSchema,
  branchId: z.uuid().nullable(),
  joinedAt: z.iso.datetime(),
});
export type MemberDto = z.infer<typeof memberSchema>;

export const updateMemberRequestSchema = z
  .object({ role: roleSchema, branchId: z.uuid().nullable() })
  .partial()
  .strict()
  .refine((value) => value.role !== undefined || value.branchId !== undefined, "Nothing to update");

export const createInvitationRequestSchema = z
  .object({
    email: z.email().trim().toLowerCase().max(254),
    role: roleSchema,
    branchId: z.uuid().nullable().default(null),
  })
  .strict();
export type CreateInvitationRequest = z.input<typeof createInvitationRequestSchema>;

export const invitationSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  email: z.string(),
  role: roleSchema,
  branchId: z.uuid().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type InvitationDto = z.infer<typeof invitationSchema>;

/** Returned once, to the inviter. The token is never stored or shown again. */
export const createdInvitationSchema = z.object({
  invitation: invitationSchema,
  token: z.string(),
  acceptPath: z.string(),
});
export type CreatedInvitation = z.infer<typeof createdInvitationSchema>;

export const acceptInvitationRequestSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invitation token") })
  .strict();

/** Machine-readable reasons on organization/membership/invitation errors. */
export const organizationErrorReasonSchema = z.enum([
  "insufficient_permission",
  "organization_suspended",
  "owner_role_required",
  "last_owner",
  "membership_changed",
  "role_not_allowed",
  "branch_not_found",
  "branch_name_taken",
  "branch_in_use",
  "already_member",
  "invitation_not_found",
  "invitation_expired",
  "invitation_revoked",
  "invitation_used",
  "invitation_email_mismatch",
  "email_not_verified",
]);
export type OrganizationErrorReason = z.infer<typeof organizationErrorReasonSchema>;
