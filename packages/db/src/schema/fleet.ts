import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns.js";
import { currencies } from "./currencies.js";
import { branches, organizations } from "./organizations.js";
import { providerProfiles } from "./provider-profiles.js";
import { users } from "./users.js";
import { vehicles } from "./vehicles.js";

export const FLEET_INCIDENT_KIND_VALUES = [
  "breakdown",
  "accident",
  "damage",
  "theft",
  "traffic_fine",
  "other",
] as const;
export const FLEET_INCIDENT_SEVERITY_VALUES = ["low", "medium", "high"] as const;
export const EXPENSE_CATEGORY_VALUES = [
  "fuel",
  "maintenance",
  "tyres",
  "parts",
  "tolls",
  "parking",
  "insurance",
  "licensing",
  "fines",
  "cleaning",
  "other",
] as const;
export const JOB_ROLE_VALUES = [
  "driver",
  "mechanic",
  "dispatcher",
  "fleet_manager",
  "other",
] as const;
export const EMPLOYMENT_TYPE_VALUES = ["full_time", "part_time", "contract", "temporary"] as const;
export const SALARY_PERIOD_VALUES = ["hour", "day", "week", "month", "year"] as const;
export const JOB_STATUS_VALUES = [
  "draft",
  "pending_moderation",
  "published",
  "rejected",
  "hidden",
  "closed",
] as const;
export const APPLICATION_STATUS_VALUES = [
  "submitted",
  "shortlisted",
  "rejected",
  "hired",
  "withdrawn",
] as const;

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

/** `organization_kind` is always 'fleet': carried into the composite FK so providers can't own rows. */
const fleetKind = () =>
  text("organization_kind", { enum: ["fleet"] })
    .notNull()
    .default("fleet");

/**
 * Operational incidents on fleet vehicles (F-150, ADR-0029). Not personal emergency alerts
 * (Prompt 18): those stay with the person and never reach a fleet.
 */
export const fleetIncidents = pgTable(
  "fleet_incidents",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    organizationKind: fleetKind(),
    vehicleId: uuid("vehicle_id").notNull(),
    /** The vehicle's branch when reported (branch-scoped managers see their branch). */
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    kind: text("kind", { enum: FLEET_INCIDENT_KIND_VALUES }).notNull(),
    severity: text("severity", { enum: FLEET_INCIDENT_SEVERITY_VALUES }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    location: text("location"),
    description: text("description").notNull(),
    status: text("status", { enum: ["open", "resolved"] })
      .notNull()
      .default("open"),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    reportedBy: uuid("reported_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "fleet_incidents_org_fk",
      columns: [t.organizationId, t.organizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete("restrict"),
    foreignKey({
      name: "fleet_incidents_vehicle_fk",
      columns: [t.vehicleId, t.organizationId],
      foreignColumns: [vehicles.id, vehicles.organizationId],
    }).onDelete("cascade"),
    index("fleet_incidents_org_idx").on(t.organizationId, t.occurredAt.desc()),
    index("fleet_incidents_vehicle_idx").on(t.vehicleId, t.occurredAt.desc()),
    index("fleet_incidents_reporter_idx").on(t.reportedBy),
    check("fleet_incidents_kind_valid", sql`${t.kind} IN (${list(FLEET_INCIDENT_KIND_VALUES)})`),
    check(
      "fleet_incidents_severity_valid",
      sql`${t.severity} IN (${list(FLEET_INCIDENT_SEVERITY_VALUES)})`,
    ),
    check("fleet_incidents_status_valid", sql`${t.status} IN ('open', 'resolved')`),
    check(
      "fleet_incidents_resolved_consistent",
      sql`(${t.status} = 'resolved') = (${t.resolvedAt} IS NOT NULL)`,
    ),
    check(
      "fleet_incidents_text_length",
      sql`char_length(${t.description}) BETWEEN 5 AND 2000
       AND (${t.location} IS NULL OR char_length(${t.location}) <= 200)
       AND (${t.resolutionNote} IS NULL OR char_length(${t.resolutionNote}) <= 1000)`,
    ),
  ],
);

/**
 * Spending records typed in by the fleet's people (F-152, ADR-0029). There is deliberately no
 * "verified", "paid" or payment-reference column: these are records, not payments (SRS J5).
 */
export const fleetExpenses = pgTable(
  "fleet_expenses",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    organizationKind: fleetKind(),
    /** Null: an organization-level cost. */
    vehicleId: uuid("vehicle_id"),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    category: text("category", { enum: EXPENSE_CATEGORY_VALUES }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 })
      .notNull()
      .references(() => currencies.code, { onDelete: "restrict" }),
    spentOn: date("spent_on", { mode: "string" }).notNull(),
    vendor: text("vendor"),
    description: text("description"),
    odometerKm: integer("odometer_km"),
    litres: numeric("litres", { precision: 7, scale: 2 }),
    enteredBy: uuid("entered_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "fleet_expenses_org_fk",
      columns: [t.organizationId, t.organizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete("restrict"),
    foreignKey({
      name: "fleet_expenses_vehicle_fk",
      columns: [t.vehicleId, t.organizationId],
      foreignColumns: [vehicles.id, vehicles.organizationId],
    }).onDelete("cascade"),
    index("fleet_expenses_org_idx").on(t.organizationId, t.spentOn.desc()),
    index("fleet_expenses_vehicle_idx").on(t.vehicleId, t.spentOn.desc()),
    check(
      "fleet_expenses_category_valid",
      sql`${t.category} IN (${list(EXPENSE_CATEGORY_VALUES)})`,
    ),
    check("fleet_expenses_amount_positive", sql`${t.amount} > 0`),
    check(
      "fleet_expenses_litres_fuel",
      sql`${t.litres} IS NULL OR (${t.category} = 'fuel' AND ${t.litres} > 0)`,
    ),
    check(
      "fleet_expenses_text_length",
      sql`(${t.vendor} IS NULL OR char_length(${t.vendor}) <= 120)
       AND (${t.description} IS NULL OR char_length(${t.description}) <= 500)`,
    ),
    check("fleet_expenses_odometer", sql`${t.odometerKm} IS NULL OR ${t.odometerKm} >= 0`),
  ],
);

/** A fleet's preferred providers (F-151), for the whole fleet or one branch. */
export const fleetPreferredProviders = pgTable(
  "fleet_preferred_providers",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    organizationKind: fleetKind(),
    providerOrganizationId: uuid("provider_organization_id")
      .notNull()
      .references(() => providerProfiles.organizationId, { onDelete: "cascade" }),
    branchId: uuid("branch_id"),
    categories: text("categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    note: text("note"),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "fleet_preferred_providers_org_fk",
      columns: [t.organizationId, t.organizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete("cascade"),
    foreignKey({
      name: "fleet_preferred_providers_branch_fk",
      columns: [t.branchId, t.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("cascade"),
    unique("fleet_preferred_providers_key")
      .on(t.organizationId, t.providerOrganizationId, t.branchId)
      .nullsNotDistinct(),
    index("fleet_preferred_providers_provider_idx").on(t.providerOrganizationId),
    check(
      "fleet_preferred_providers_note_length",
      sql`${t.note} IS NULL OR char_length(${t.note}) <= 500`,
    ),
    check("fleet_preferred_providers_categories", sql`cardinality(${t.categories}) <= 7`),
  ],
);

/**
 * Job listings (F-153, F-154, ADR-0029). Published straight away only for verified employers
 * without scam signs; otherwise `pending_moderation`. Salaries are what the employer advertises.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    organizationKind: fleetKind(),
    /** Single-column FK: a composite one would null organization_id on branch deletion. */
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    role: text("role", { enum: JOB_ROLE_VALUES }).notNull(),
    employmentType: text("employment_type", { enum: EMPLOYMENT_TYPE_VALUES }).notNull(),
    licenceClasses: text("licence_classes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    locality: text("locality").notNull(),
    countryCode: char("country_code", { length: 2 }).notNull(),
    salaryCurrency: char("salary_currency", { length: 3 }).references(() => currencies.code, {
      onDelete: "restrict",
    }),
    salaryMin: numeric("salary_min", { precision: 12, scale: 2 }),
    salaryMax: numeric("salary_max", { precision: 12, scale: 2 }),
    salaryPeriod: text("salary_period", { enum: SALARY_PERIOD_VALUES }),
    closesOn: date("closes_on", { mode: "string" }).notNull(),
    status: text("status", { enum: JOB_STATUS_VALUES }).notNull().default("draft"),
    moderationNote: text("moderation_note"),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "jobs_org_fk",
      columns: [t.organizationId, t.organizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete("restrict"),
    unique("jobs_id_organization_key").on(t.id, t.organizationId),
    index("jobs_org_idx").on(t.organizationId, t.createdAt.desc()),
    index("jobs_public_idx")
      .on(t.publishedAt.desc())
      .where(sql`${t.status} = 'published'`),
    check("jobs_status_valid", sql`${t.status} IN (${list(JOB_STATUS_VALUES)})`),
    check("jobs_role_valid", sql`${t.role} IN (${list(JOB_ROLE_VALUES)})`),
    check(
      "jobs_employment_type_valid",
      sql`${t.employmentType} IN (${list(EMPLOYMENT_TYPE_VALUES)})`,
    ),
    check(
      "jobs_text_length",
      sql`char_length(${t.title}) BETWEEN 5 AND 120 AND char_length(${t.description}) BETWEEN 50 AND 5000
       AND char_length(${t.locality}) BETWEEN 2 AND 80`,
    ),
    check("jobs_licence_classes", sql`cardinality(${t.licenceClasses}) <= 10`),
    check(
      "jobs_salary_shape",
      sql`(${t.salaryCurrency} IS NULL AND ${t.salaryMin} IS NULL AND ${t.salaryMax} IS NULL AND ${t.salaryPeriod} IS NULL)
       OR (${t.salaryCurrency} IS NOT NULL AND ${t.salaryMin} > 0 AND ${t.salaryPeriod} IN (${list(SALARY_PERIOD_VALUES)})
           AND (${t.salaryMax} IS NULL OR ${t.salaryMax} >= ${t.salaryMin}))`,
    ),
    check(
      "jobs_published_consistent",
      sql`${t.status} NOT IN ('published', 'closed') OR ${t.publishedAt} IS NOT NULL`,
    ),
  ],
);

/** Applications. The applicant shares only the contact details they type in. */
export const jobApplications = pgTable(
  "job_applications",
  {
    id: id(),
    jobId: uuid("job_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    applicantUserId: uuid("applicant_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    phone: text("phone"),
    email: text("email"),
    status: text("status", { enum: APPLICATION_STATUS_VALUES }).notNull().default("submitted"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "job_applications_job_fk",
      columns: [t.jobId, t.organizationId],
      foreignColumns: [jobs.id, jobs.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("job_applications_one_per_person").on(t.jobId, t.applicantUserId),
    index("job_applications_org_idx").on(t.organizationId, t.jobId),
    index("job_applications_applicant_idx").on(t.applicantUserId, t.createdAt.desc()),
    check(
      "job_applications_status_valid",
      sql`${t.status} IN (${list(APPLICATION_STATUS_VALUES)})`,
    ),
    check(
      "job_applications_contact",
      sql`(${t.phone} IS NOT NULL OR ${t.email} IS NOT NULL)
       AND char_length(${t.message}) BETWEEN 20 AND 3000`,
    ),
  ],
);

export type FleetIncident = typeof fleetIncidents.$inferSelect;
export type FleetExpense = typeof fleetExpenses.$inferSelect;
export type FleetPreferredProvider = typeof fleetPreferredProviders.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobApplication = typeof jobApplications.$inferSelect;
