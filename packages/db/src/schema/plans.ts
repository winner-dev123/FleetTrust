import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns.js";
import { currencies } from "./currencies.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

/**
 * Subscription catalog and entitlements (SRS FR-03..05, ADR-0008). Plans buy capacity only:
 * nothing here may be read by verification, Power User or search (ADR-0009), and emergency
 * features never consult it (ADR-0010).
 */

export const PLAN_AUDIENCES = ["user", "provider", "fleet"] as const;
export type PlanAudience = (typeof PLAN_AUDIENCES)[number];

export const PLAN_VERSION_STATUSES = ["draft", "published", "retired"] as const;
export const SUBJECT_TYPES = ["user", "organization"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

const KEY_FORMAT = sql.raw(`'^[a-z][a-z_]*\\.[a-z][a-z_]*$'`);

export const plans = pgTable(
  "plans",
  {
    id: id(),
    /** Stable natural key, e.g. `provider-pro`. */
    code: text("code").notNull(),
    audience: text("audience", { enum: PLAN_AUDIENCES }).notNull(),
    name: text("name").notNull(),
    /** The plan everyone in this audience has without an assignment (one per audience). */
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("plans_code_key").on(t.code),
    uniqueIndex("plans_one_default_per_audience")
      .on(t.audience)
      .where(sql`${t.isDefault}`),
    check("plans_audience_valid", sql`${t.audience} IN ('user', 'provider', 'fleet')`),
    check("plans_code_format", sql`${t.code} ~ '^[a-z][a-z0-9-]{1,40}$'`),
  ],
);

/**
 * Immutable once published (enforced by trigger): changing a plan means publishing a new
 * version. Existing assignments keep the version they were given.
 */
export const planVersions = pgTable(
  "plan_versions",
  {
    id: id(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    status: text("status", { enum: PLAN_VERSION_STATUSES }).notNull().default("draft"),
    /** Display only: FleetTrust never charges through the platform (ADR-0008, OQ-18). */
    priceMinor: bigint("price_minor", { mode: "number" }),
    currency: char("currency", { length: 3 }).references(() => currencies.code, {
      onDelete: "restrict",
    }),
    billingPeriod: text("billing_period", { enum: ["month", "year"] }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    unique("plan_versions_plan_version_key").on(t.planId, t.version),
    check("plan_versions_version_positive", sql`${t.version} > 0`),
    check("plan_versions_status_valid", sql`${t.status} IN ('draft', 'published', 'retired')`),
    check(
      "plan_versions_price_complete",
      sql`(${t.priceMinor} IS NULL) = (${t.currency} IS NULL) AND (${t.priceMinor} IS NULL) = (${t.billingPeriod} IS NULL)`,
    ),
    check("plan_versions_price_non_negative", sql`${t.priceMinor} IS NULL OR ${t.priceMinor} >= 0`),
    check("plan_versions_published_at", sql`(${t.status} = 'draft') = (${t.publishedAt} IS NULL)`),
  ],
);

/** One row per capability key. `limit_value` NULL = unlimited; a missing key = not included (0). */
export const planVersionLimits = pgTable(
  "plan_version_limits",
  {
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => planVersions.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    limitValue: integer("limit_value"),
  },
  (t) => [
    primaryKey({ name: "plan_version_limits_pkey", columns: [t.planVersionId, t.key] }),
    check("plan_version_limits_key_format", sql`${t.key} ~ ${KEY_FORMAT}`),
    check("plan_version_limits_non_negative", sql`${t.limitValue} IS NULL OR ${t.limitValue} >= 0`),
  ],
);

/** Exactly one subject column is set, matching subject_type. */
const subjectCheck = (subjectType: unknown, userId: unknown, organizationId: unknown) =>
  sql`(${subjectType} = 'user' AND ${userId} IS NOT NULL AND ${organizationId} IS NULL) OR
      (${subjectType} = 'organization' AND ${organizationId} IS NOT NULL AND ${userId} IS NULL)`;

/**
 * A plan version given to a user or organization by a billing operator after external
 * billing confirmation (ADR-0008). Never deleted: ending one sets ended_at. After an
 * assignment ends, its limits still apply for `grace_days` (downgrade grace period).
 */
export const planAssignments = pgTable(
  "plan_assignments",
  {
    id: id(),
    subjectType: text("subject_type", { enum: SUBJECT_TYPES }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => planVersions.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** Optional fixed term. */
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    graceDays: smallint("grace_days").notNull().default(14),
    /** Where the external confirmation can be found (invoice, transfer reference, ticket). */
    externalReference: text("external_reference").notNull(),
    invoiceNumber: text("invoice_number"),
    note: text("note"),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    endedBy: uuid("ended_by").references(() => users.id, { onDelete: "restrict" }),
    endReason: text("end_reason", { enum: ["superseded", "cancelled"] }),
    ...timestamps(),
  },
  (t) => [
    index("plan_assignments_org_idx").on(t.organizationId, t.startsAt.desc()),
    index("plan_assignments_user_idx").on(t.userId, t.startsAt.desc()),
    check("plan_assignments_subject", subjectCheck(t.subjectType, t.userId, t.organizationId)),
    check("plan_assignments_grace_range", sql`${t.graceDays} BETWEEN 0 AND 90`),
    check("plan_assignments_term", sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
    check(
      "plan_assignments_reference_length",
      sql`char_length(${t.externalReference}) BETWEEN 1 AND 200`,
    ),
    check(
      "plan_assignments_ended_consistent",
      sql`(${t.endedAt} IS NULL) = (${t.endedBy} IS NULL) AND (${t.endedAt} IS NULL) = (${t.endReason} IS NULL)`,
    ),
  ],
);

/**
 * Per-subject limit override (support gestures, pilots, abuse throttling). Replaces the
 * plan-derived limit for one key while open. A new override supersedes the open one.
 */
export const quotaOverrides = pgTable(
  "quota_overrides",
  {
    id: id(),
    subjectType: text("subject_type", { enum: SUBJECT_TYPES }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    key: text("key").notNull(),
    /** NULL = unlimited. */
    limitValue: integer("limit_value"),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    index("quota_overrides_org_idx").on(t.organizationId),
    index("quota_overrides_user_idx").on(t.userId),
    uniqueIndex("quota_overrides_open_key")
      .on(sql`COALESCE(${t.organizationId}, ${t.userId})`, t.key)
      .where(sql`${t.revokedAt} IS NULL`),
    check("quota_overrides_subject", subjectCheck(t.subjectType, t.userId, t.organizationId)),
    check("quota_overrides_key_format", sql`${t.key} ~ ${KEY_FORMAT}`),
    check("quota_overrides_non_negative", sql`${t.limitValue} IS NULL OR ${t.limitValue} >= 0`),
    check("quota_overrides_reason_length", sql`char_length(${t.reason}) BETWEEN 3 AND 500`),
    check(
      "quota_overrides_revoked_consistent",
      sql`(${t.revokedAt} IS NULL) = (${t.revokedBy} IS NULL)`,
    ),
  ],
);

/**
 * Daily usage counters, one row per subject, key and local day. Consumed with a single
 * conditional upsert, so concurrent requests can't overshoot the limit (SRS AB-18).
 * Old periods are disposable (a purge job can drop rows older than a few weeks).
 */
export const quotaCounters = pgTable(
  "quota_counters",
  {
    subjectType: text("subject_type", { enum: SUBJECT_TYPES }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    key: text("key").notNull(),
    /** Local calendar day in the subject's timezone (OQ-08). */
    periodStart: date("period_start", { mode: "string" }).notNull(),
    used: integer("used").notNull(),
  },
  (t) => [
    primaryKey({
      name: "quota_counters_pkey",
      columns: [t.subjectType, t.subjectId, t.key, t.periodStart],
    }),
    check("quota_counters_used_non_negative", sql`${t.used} >= 0`),
  ],
);

/** Idempotency ledger: a retried request with the same key is counted once. */
export const quotaConsumptions = pgTable(
  "quota_consumptions",
  {
    id: id(),
    subjectType: text("subject_type", { enum: SUBJECT_TYPES }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    key: text("key").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("quota_consumptions_idempotency_key").on(
      t.subjectType,
      t.subjectId,
      t.key,
      t.idempotencyKey,
    ),
    check("quota_consumptions_amount_positive", sql`${t.amount} > 0`),
    check(
      "quota_consumptions_idempotency_key_length",
      sql`char_length(${t.idempotencyKey}) BETWEEN 1 AND 200`,
    ),
  ],
);

export const PLATFORM_ROLES = ["billing_operator"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * FleetTrust staff roles (SRS §2.4). Granted from the command line (`pnpm db:staff`), never
 * through the API, until the admin console (Prompt 26) adds MFA-protected management.
 */
export const platformStaff = pgTable(
  "platform_staff",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role", { enum: PLATFORM_ROLES }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "platform_staff_pkey", columns: [t.userId, t.role] }),
    check("platform_staff_role_valid", sql`${t.role} IN ('billing_operator')`),
  ],
);

export type Plan = typeof plans.$inferSelect;
export type PlanVersion = typeof planVersions.$inferSelect;
export type PlanVersionLimit = typeof planVersionLimits.$inferSelect;
export type PlanAssignment = typeof planAssignments.$inferSelect;
export type QuotaOverride = typeof quotaOverrides.$inferSelect;
