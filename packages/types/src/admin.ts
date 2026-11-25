import { z } from "zod";

import { AUTO_FLAG_REPORTS, safeText } from "./articles.js";
import { CATEGORY_LABELS } from "./labels.js";
import { PROVIDER_CATEGORIES, type ProviderCategory } from "./providers.js";

// ---------------------------------------------------------------------------------------------
// Staff roles (SRS §2.3). Least privilege: each role sees only its own console sections.
// ---------------------------------------------------------------------------------------------

/** Must match PLATFORM_ROLES in @fleettrust/db (an API test enforces it). */
export const STAFF_ROLES = [
  "super_admin",
  "verification_reviewer",
  "billing_operator",
  "trust_safety_moderator",
  "support_agent",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const staffRoleSchema = z.enum(STAFF_ROLES);

export const STAFF_ROLE_LABELS: Readonly<Record<StaffRole, string>> = {
  super_admin: "Super admin",
  verification_reviewer: "Verification reviewer",
  billing_operator: "Billing operator",
  trust_safety_moderator: "Trust and safety moderator",
  support_agent: "Support agent",
};

/** What each role may do, in words (shown in the console and the docs). */
export const STAFF_ROLE_SCOPES: Readonly<Record<StaffRole, string>> = {
  super_admin:
    "Manage staff roles, feature settings and service categories. Search the whole audit log.",
  verification_reviewer:
    "Review evidence, grant, deny and revoke badges, decide verification appeals.",
  billing_operator: "Assign plans after external billing confirmation, set quota overrides.",
  trust_safety_moderator:
    "Act on reports, hide content, sanction members, decide moderation appeals.",
  support_agent: "Look up account metadata and help people sign in again, through an audited case.",
};

/**
 * Audit actions each role may search. Super admins search everything. Prefixes are dotted
 * action families (see audit_events.action).
 */
export const AUDIT_SCOPES: Readonly<Record<StaffRole, readonly string[] | "all">> = {
  super_admin: "all",
  verification_reviewer: ["verification."],
  billing_operator: ["plan.", "entitlement."],
  trust_safety_moderator: [
    "moderation.",
    "power_user.",
    "content_report.",
    "article.",
    "article_comment.",
    "group.",
    "job.",
    "user.suspension_ended",
  ],
  support_agent: ["support.", "user."],
};

export const adminMeSchema = z.object({
  userId: z.uuid(),
  email: z.string().nullable(),
  roles: z.array(staffRoleSchema),
  mfa: z.object({
    /** Staff routes need a second factor on the current sign-in. */
    required: z.boolean(),
    /** The current sign-in used one. */
    satisfied: z.boolean(),
  }),
});
export type AdminMe = z.infer<typeof adminMeSchema>;

export const platformStaffMemberSchema = z.object({
  userId: z.uuid(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  roles: z.array(z.object({ role: staffRoleSchema, since: z.iso.datetime() })),
});
export type PlatformStaffMemberDto = z.infer<typeof platformStaffMemberSchema>;

export const grantStaffRoleSchema = z
  .object({ email: z.email().max(254), role: staffRoleSchema })
  .strict();
export type GrantStaffRole = z.infer<typeof grantStaffRoleSchema>;

export const revokeStaffRoleSchema = z.object({ userId: z.uuid(), role: staffRoleSchema }).strict();
export type RevokeStaffRole = z.infer<typeof revokeStaffRoleSchema>;

// ---------------------------------------------------------------------------------------------
// Irreversible actions: a recent sign-in plus an explicit confirmation header.
// ---------------------------------------------------------------------------------------------

/** Header the client sends with the action name after the person confirmed it. */
export const CONFIRM_ACTION_HEADER = "X-Confirm-Action";

/** Every action the API treats as irreversible (the console asks for a typed confirmation). */
export const IRREVERSIBLE_ACTIONS = [
  "badge.revoke",
  "verification.purge",
  "plan.end_assignment",
  "staff.grant",
  "staff.revoke",
  "support.revoke_sessions",
  /** A person deleting their own account (Prompt 27). */
  "account.delete",
] as const;
export type IrreversibleAction = (typeof IRREVERSIBLE_ACTIONS)[number];

export const adminErrorReasonSchema = z.enum([
  "mfa_required",
  "confirmation_required",
  "own_roles",
  "unknown_setting",
  "category_closed",
  "case_closed",
  "no_email",
]);
export type AdminErrorReason = z.infer<typeof adminErrorReasonSchema>;

// ---------------------------------------------------------------------------------------------
// Feature settings: a fixed list of real, server-side settings. No feature flags for future
// modules (ADR-0011); adding a key is a code change, reviewed like any other.
// ---------------------------------------------------------------------------------------------

interface SettingDefinition<T> {
  label: string;
  description: string;
  schema: z.ZodType<T>;
  defaultValue: T;
  /** Readable by anyone through GET /v1/config (never secrets). */
  public: boolean;
}

const setting = <T>(definition: SettingDefinition<T>) => definition;

export const FEATURE_SETTINGS = {
  "signups.paused": setting({
    label: "Pause new sign-ups",
    description:
      "Stops new accounts from being created (for example during an abuse wave). People who already have an account can still sign in.",
    schema: z.boolean(),
    defaultValue: false,
    public: false,
  }),
  "community.auto_hide_reporters": setting({
    label: "Reports that hide content automatically",
    description:
      "How many different people must report an article, comment, job, message or group before it's hidden until a moderator decides.",
    schema: z.number().int().min(2).max(10),
    defaultValue: AUTO_FLAG_REPORTS,
    public: false,
  }),
  "site.notice": setting({
    label: "Site notice",
    description:
      "A short message shown at the top of the website, for example planned maintenance. Empty hides it.",
    schema: safeText(280).nullable(),
    defaultValue: null,
    public: true,
  }),
} as const;

export type FeatureSettingKey = keyof typeof FEATURE_SETTINGS;
export type FeatureSettingValue<K extends FeatureSettingKey> = z.infer<
  (typeof FEATURE_SETTINGS)[K]["schema"]
>;
export const FEATURE_SETTING_KEYS = Object.keys(FEATURE_SETTINGS) as FeatureSettingKey[];

export const featureSettingSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  value: z.unknown(),
  defaultValue: z.unknown(),
  public: z.boolean(),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.string().nullable(),
});
export type FeatureSettingDto = z.infer<typeof featureSettingSchema>;

export const updateFeatureSettingSchema = z.object({ value: z.unknown() }).strict();

/** Public client configuration (GET /v1/config). */
export const publicConfigSchema = z.object({
  siteNotice: z.string().nullable(),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;

// ---------------------------------------------------------------------------------------------
// Service taxonomy: the category codes are fixed in code (database checks and labels use
// them); admins manage their description, order and whether new offerings may use them.
// ---------------------------------------------------------------------------------------------

export const serviceCategorySchema = z.object({
  category: z.enum(PROVIDER_CATEGORIES),
  label: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  /** False: providers can't add new offerings in this category (existing ones stay). */
  acceptingNewOfferings: z.boolean(),
  updatedAt: z.iso.datetime().nullable(),
});
export type ServiceCategoryDto = z.infer<typeof serviceCategorySchema>;

export const updateServiceCategorySchema = z
  .object({
    description: safeText(500).nullable(),
    sortOrder: z.number().int().min(0).max(1000),
    acceptingNewOfferings: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Change at least one field");
export type UpdateServiceCategory = z.infer<typeof updateServiceCategorySchema>;

/** Defaults when no admin change has been saved. */
export function defaultServiceCategory(category: ProviderCategory): ServiceCategoryDto {
  return {
    category,
    label: CATEGORY_LABELS[category],
    description: null,
    sortOrder: PROVIDER_CATEGORIES.indexOf(category) * 10,
    acceptingNewOfferings: true,
    updatedAt: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Audit search
// ---------------------------------------------------------------------------------------------

export const auditQuerySchema = z
  .object({
    /** Exact action, or a family ending in "." (e.g. "verification."). */
    action: z
      .string()
      .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]*)*$/)
      .max(100)
      .optional(),
    actorEmail: z.email().max(254).optional(),
    actorId: z.uuid().optional(),
    targetType: z
      .string()
      .regex(/^[a-z_]{1,50}$/)
      .optional(),
    targetId: z.string().min(1).max(100).optional(),
    organizationId: z.uuid().optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type AuditQuery = z.input<typeof auditQuerySchema>;

export const auditEntrySchema = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  actorType: z.string(),
  actor: z
    .object({ id: z.uuid(), email: z.string().nullable(), displayName: z.string().nullable() })
    .nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  organizationId: z.uuid().nullable(),
  requestId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type AuditEntryDto = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  items: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
  /** The action families searched (the role's scope, or "all"). */
  scope: z.union([z.literal("all"), z.array(z.string())]),
});
export type AuditPage = z.infer<typeof auditPageSchema>;

// ---------------------------------------------------------------------------------------------
// Support: account metadata only (no documents or message content), through audited cases.
// ---------------------------------------------------------------------------------------------

export const supportAccountSchema = z.object({
  userId: z.uuid(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  displayName: z.string().nullable(),
  status: z.enum(["active", "suspended", "deleted"]),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
  lastSignInProvider: z.string().nullable(),
  organizations: z.array(z.object({ name: z.string(), kind: z.string(), role: z.string() })),
  activeSanctions: z.number().int(),
  openCases: z.number().int(),
});
export type SupportAccountDto = z.infer<typeof supportAccountSchema>;

export const supportCaseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  subjectEmail: z.string().nullable(),
  reason: z.string(),
  status: z.enum(["open", "closed"]),
  resolution: z.string().nullable(),
  openedBy: z.string().nullable(),
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  actions: z.array(z.object({ action: z.string(), at: z.iso.datetime() })),
});
export type SupportCaseDto = z.infer<typeof supportCaseSchema>;

export const openSupportCaseSchema = z
  .object({ userId: z.uuid(), reason: safeText(1000, { min: 5, multiline: true }) })
  .strict();
export type OpenSupportCase = z.infer<typeof openSupportCaseSchema>;

export const closeSupportCaseSchema = z
  .object({ resolution: safeText(1000, { min: 3, multiline: true }) })
  .strict();

export const supportLookupSchema = z
  .object({ email: z.email().max(254).optional(), userId: z.uuid().optional() })
  .strict()
  .refine((value) => (value.email === undefined) !== (value.userId === undefined), {
    message: "Search by email or by user ID",
  });
