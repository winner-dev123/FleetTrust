import { copy } from "@fleettrust/copy";
import type { AdminMe, AuditQuery, StaffRole } from "@fleettrust/types";

const t = copy.web.admin.sections;

/** One section of the admin console and the staff roles that may open it (least privilege). */
export interface AdminSection {
  href: string;
  label: string;
  roles: readonly StaffRole[] | "any";
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { href: "/app/admin", label: t.overview, roles: "any" },
  { href: "/app/admin/verification", label: t.verification, roles: ["verification_reviewer"] },
  { href: "/app/admin/billing", label: t.billing, roles: ["billing_operator"] },
  { href: "/app/admin/moderation", label: t.moderation, roles: ["trust_safety_moderator"] },
  { href: "/app/admin/support", label: t.support, roles: ["support_agent"] },
  { href: "/app/admin/staff", label: t.staff, roles: ["super_admin"] },
  { href: "/app/admin/features", label: t.features, roles: ["super_admin"] },
  { href: "/app/admin/taxonomy", label: t.taxonomy, roles: ["super_admin"] },
  { href: "/app/admin/audit", label: t.audit, roles: "any" },
  { href: "/app/admin/security", label: t.security, roles: "any" },
];

export function canOpen(section: AdminSection, roles: readonly StaffRole[]): boolean {
  return section.roles === "any" || section.roles.some((role) => roles.includes(role));
}

/** The console sections this person may see. The API enforces the same rules (404 otherwise). */
export function adminSections(roles: readonly StaffRole[]): AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => canOpen(section, roles));
}

/** The section a path belongs to, for "may I open this page?" checks. */
export function sectionFor(pathname: string): AdminSection | undefined {
  return [...ADMIN_SECTIONS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`));
}

/** Staff must finish two-step sign-in before any page except the setup page itself. */
export function needsMfa(me: AdminMe): boolean {
  return me.mfa.required && !me.mfa.satisfied;
}

/** Firebase reports a sign-in that still needs the second factor with this error code. */
export function isMfaRequiredError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "auth/multi-factor-auth-required"
  );
}

export interface AuditFilters {
  action: string;
  actorEmail: string;
  targetType: string;
  targetId: string;
  /** yyyy-mm-dd from a date input (UTC). */
  from: string;
  to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  action: "",
  actorEmail: "",
  targetType: "",
  targetId: "",
  from: "",
  to: "",
};

/** Turns the audit form into an API query: empty fields are left out; dates cover whole UTC days. */
export function auditQueryFrom(filters: AuditFilters, cursor?: string): AuditQuery {
  const query: AuditQuery = { limit: 50 };
  if (filters.action.trim()) query.action = filters.action.trim();
  if (filters.actorEmail.trim()) query.actorEmail = filters.actorEmail.trim().toLowerCase();
  if (filters.targetType.trim()) query.targetType = filters.targetType.trim();
  if (filters.targetId.trim()) query.targetId = filters.targetId.trim();
  if (filters.from) query.from = new Date(`${filters.from}T00:00:00.000Z`).toISOString();
  if (filters.to) query.to = new Date(`${filters.to}T23:59:59.999Z`).toISOString();
  if (cursor) query.cursor = cursor;
  return query;
}
