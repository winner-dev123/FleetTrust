import { sql } from "drizzle-orm";
import {
  char,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { geographyPoint, id, timestamps } from "./columns.js";
import { users } from "./users.js";

export const ORGANIZATION_KINDS = ["provider", "fleet"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

/**
 * Role validity per organization kind, enforced in the database (a fleet can't have "staff",
 * a provider can't have "driver"). Must match ROLES_BY_KIND in @fleettrust/types; an API test
 * checks the two agree.
 */
const ROLE_CHECK_SQL = `(
  (organization_kind = 'provider' AND role IN ('owner', 'admin', 'manager', 'staff')) OR
  (organization_kind = 'fleet' AND role IN ('owner', 'admin', 'manager', 'driver', 'recruiter'))
)`;
/** Only these roles can be limited to one branch. */
const BRANCH_SCOPE_CHECK_SQL = `(branch_id IS NULL OR role IN ('manager', 'staff', 'driver'))`;

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    kind: text("kind", { enum: ORGANIZATION_KINDS }).notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "suspended"] })
      .notNull()
      .default("active"),
    /** IANA timezone; daily quotas reset at local midnight (OQ-08). Validated by the API. */
    timezone: text("timezone").notNull().default("UTC"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    // Target of composite FKs that carry the kind into memberships and invitations.
    unique("organizations_id_kind_key").on(t.id, t.kind),
    check("organizations_kind_valid", sql`${t.kind} IN ('provider', 'fleet')`),
    check("organizations_status_valid", sql`${t.status} IN ('active', 'suspended')`),
    check("organizations_name_length", sql`char_length(${t.name}) BETWEEN 2 AND 120`),
    check("organizations_timezone_length", sql`char_length(${t.timezone}) BETWEEN 1 AND 64`),
    index("organizations_created_by_idx").on(t.createdBy),
  ],
);

export const branches = pgTable(
  "branches",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // Public location details (provider profiles, Prompt 10). All optional until publication.
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    locality: text("locality"),
    region: text("region"),
    postalCode: text("postal_code"),
    /** ISO 3166-1 alpha-2. */
    countryCode: char("country_code", { length: 2 }),
    location: geographyPoint("location"),
    /** How far the branch travels to customers (mobile mechanics, towing). */
    serviceRadiusKm: smallint("service_radius_km"),
    phone: text("phone"),
    /** IANA timezone for opening hours (Prompt 11). Null = the organization's timezone. */
    timeZone: text("time_zone"),
    /** When opening hours were last saved. Null = hours not provided (not the same as closed). */
    hoursUpdatedAt: timestamp("hours_updated_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    index("branches_location_gist").using("gist", t.location),
    check(
      "branches_country_code_format",
      sql`${t.countryCode} IS NULL OR ${t.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "branches_service_radius_range",
      sql`${t.serviceRadiusKm} IS NULL OR ${t.serviceRadiusKm} BETWEEN 1 AND 500`,
    ),
    // Target of composite FKs proving a branch belongs to the same organization.
    unique("branches_id_organization_key").on(t.id, t.organizationId),
    uniqueIndex("branches_org_name_key").on(t.organizationId, sql`lower(${t.name})`),
    check("branches_name_length", sql`char_length(${t.name}) BETWEEN 2 AND 120`),
    check(
      "branches_time_zone_length",
      sql`${t.timeZone} IS NULL OR char_length(${t.timeZone}) BETWEEN 1 AND 64`,
    ),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    organizationKind: text("organization_kind", { enum: ORGANIZATION_KINDS }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    /** Null = the whole organization; set = limited to that branch (manager/staff/driver only). */
    branchId: uuid("branch_id"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_key").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
    foreignKey({
      name: "memberships_organization_fk",
      columns: [t.organizationId, t.organizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete("restrict"),
    foreignKey({
      name: "memberships_branch_same_org_fk",
      columns: [t.branchId, t.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("restrict"),
    check("memberships_role_valid_for_kind", sql.raw(ROLE_CHECK_SQL)),
    check("memberships_branch_scope_role", sql.raw(BRANCH_SCOPE_CHECK_SQL)),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    organizationKind: text("organization_kind", { enum: ORGANIZATION_KINDS }).notNull(),
    /** Lower-cased. Only a signed-in user with this verified email can accept. */
    email: text("email").notNull(),
    role: text("role").notNull(),
    branchId: uuid("branch_id"),
    /** SHA-256 of the one-time token. The token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_key").on(t.tokenHash),
    // At most one open invitation per person per organization (new ones supersede old ones).
    uniqueIndex("invitations_open_per_email_key")
      .on(t.organizationId, t.email)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    foreignKey({
      name: "invitations_organization_fk",
      columns: [t.organizationId, t.organizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete("restrict"),
    foreignKey({
      name: "invitations_branch_same_org_fk",
      columns: [t.branchId, t.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("restrict"),
    check("invitations_role_valid_for_kind", sql.raw(ROLE_CHECK_SQL)),
    check("invitations_branch_scope_role", sql.raw(BRANCH_SCOPE_CHECK_SQL)),
    check("invitations_email_lowercase", sql`${t.email} = lower(${t.email})`),
    check(
      "invitations_single_outcome",
      sql`NOT (${t.acceptedAt} IS NOT NULL AND ${t.revokedAt} IS NOT NULL)`,
    ),
    check(
      "invitations_accepted_consistent",
      sql`(${t.acceptedAt} IS NULL) = (${t.acceptedBy} IS NULL)`,
    ),
    check(
      "invitations_revoked_consistent",
      sql`(${t.revokedAt} IS NULL) = (${t.revokedBy} IS NULL)`,
    ),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
