import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { geographyPoint, id, timestamps } from "./columns.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const INCIDENT_CATEGORY_VALUES = [
  "breakdown",
  "accident",
  "medical",
  "security",
  "stranded",
  "other",
] as const;
export const INCIDENT_STATUS_VALUES = ["active", "resolved", "cancelled", "expired"] as const;

/**
 * Official emergency numbers per country (OQ-03). Ships empty: until the launch country is
 * decided, guidance falls back to "Call your local emergency number".
 */
export const emergencyGuidance = pgTable(
  "emergency_guidance",
  {
    countryCode: char("country_code", { length: 2 }).primaryKey(),
    emergencyNumber: text("emergency_number").notNull(),
    label: text("label").notNull(),
    guidance: text("guidance").notNull(),
    ...timestamps(),
  },
  (t) => [
    check("emergency_guidance_country_format", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    check("emergency_guidance_number_format", sql`${t.emergencyNumber} ~ '^[0-9+ ]{2,20}$'`),
  ],
);

/** Trusted contacts with mutual consent (F-061): the contact must accept. */
export const trustedContacts = pgTable(
  "trusted_contacts",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactUserId: uuid("contact_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "active", "declined"] })
      .notNull()
      .default("pending"),
    priority: text("priority", { enum: ["primary", "backup"] })
      .notNull()
      .default("primary"),
    /** Set by the contact: alerts are paused (AB-03). */
    muted: boolean("muted").notNull().default(false),
    respondedAt: timestamp("responded_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("trusted_contacts_pair_key").on(t.ownerUserId, t.contactUserId),
    index("trusted_contacts_contact_idx").on(t.contactUserId, t.status),
    check("trusted_contacts_status_valid", sql`${t.status} IN ('pending', 'active', 'declined')`),
    check("trusted_contacts_priority_valid", sql`${t.priority} IN ('primary', 'backup')`),
    check("trusted_contacts_not_self", sql`${t.ownerUserId} <> ${t.contactUserId}`),
  ],
);

/**
 * Emergency incidents (F-060, F-064). Never linked to plans or quotas (ADR-0010). The location
 * is stored only with consent for this incident and erased when it closes.
 */
export const emergencyIncidents = pgTable(
  "emergency_incidents",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientIncidentId: uuid("client_incident_id").notNull(),
    category: text("category", { enum: INCIDENT_CATEGORY_VALUES }).notNull(),
    note: text("note"),
    status: text("status", { enum: INCIDENT_STATUS_VALUES }).notNull().default("active"),
    locationShared: boolean("location_shared").notNull().default(false),
    location: geographyPoint("location"),
    locationAccuracyM: integer("location_accuracy_m"),
    locationUpdatedAt: timestamp("location_updated_at", { withTimezone: true, mode: "date" }),
    countryCode: char("country_code", { length: 2 }),
    notifyProviders: boolean("notify_providers").notNull().default(false),
    /** Over the soft per-user threshold: flagged for review, never blocked (ADR-0010). */
    flagged: boolean("flagged").notNull().default(false),
    wave: smallint("wave").notNull().default(1),
    nextEscalationAt: timestamp("next_escalation_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("emergency_incidents_client_key").on(t.ownerUserId, t.clientIncidentId),
    uniqueIndex("emergency_incidents_one_active_key")
      .on(t.ownerUserId)
      .where(sql`${t.status} = 'active'`),
    index("emergency_incidents_owner_idx").on(t.ownerUserId, t.createdAt.desc()),
    index("emergency_incidents_escalation_idx")
      .on(t.nextEscalationAt)
      .where(sql`${t.status} = 'active'`),
    index("emergency_incidents_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active'`),
    check(
      "emergency_incidents_status_valid",
      sql`${t.status} IN (${list(INCIDENT_STATUS_VALUES)})`,
    ),
    check(
      "emergency_incidents_category_valid",
      sql`${t.category} IN (${list(INCIDENT_CATEGORY_VALUES)})`,
    ),
    check(
      "emergency_incidents_location_consent",
      sql`${t.location} IS NULL OR ${t.locationShared}`,
    ),
    check(
      "emergency_incidents_note_length",
      sql`${t.note} IS NULL OR char_length(${t.note}) <= 500`,
    ),
  ],
);

/** Who was alerted: trusted contacts (by wave) and opted-in providers. */
export const incidentRecipients = pgTable(
  "incident_recipients",
  {
    id: id(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => emergencyIncidents.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["contact", "provider"] }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    priority: text("priority", { enum: ["primary", "backup"] }),
    wave: smallint("wave").notNull().default(1),
    notifiedAt: timestamp("notified_at", { withTimezone: true, mode: "date" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true, mode: "date" }),
    distanceM: integer("distance_m"),
    offeredAt: timestamp("offered_at", { withTimezone: true, mode: "date" }),
    offerMessage: text("offer_message"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("incident_recipients_user_key").on(t.incidentId, t.userId),
    uniqueIndex("incident_recipients_org_key").on(t.incidentId, t.organizationId),
    index("incident_recipients_org_idx").on(t.organizationId, t.createdAt.desc()),
    index("incident_recipients_user_idx").on(t.userId, t.createdAt.desc()),
    check(
      "incident_recipients_kind_fields",
      sql`(${t.kind} = 'contact' AND ${t.userId} IS NOT NULL AND ${t.organizationId} IS NULL)
       OR (${t.kind} = 'provider' AND ${t.organizationId} IS NOT NULL AND ${t.userId} IS NULL)`,
    ),
  ],
);

/**
 * The emergency delivery queue (ADR-0007, ADR-0025): one row per person, channel and wave, with
 * retries and backoff. Push first; email when push isn't possible or isn't acknowledged in time.
 */
export const incidentDeliveries = pgTable(
  "incident_deliveries",
  {
    id: id(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => emergencyIncidents.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => incidentRecipients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["push", "email"] }).notNull(),
    purpose: text("purpose", { enum: ["alert", "reminder", "acknowledged", "closed", "offer"] })
      .notNull()
      .default("alert"),
    wave: smallint("wave").notNull().default(1),
    status: text("status", { enum: ["pending", "sent", "failed", "skipped"] })
      .notNull()
      .default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("incident_deliveries_key").on(
      t.recipientId,
      t.userId,
      t.channel,
      t.purpose,
      t.wave,
    ),
    index("incident_deliveries_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index("incident_deliveries_incident_idx").on(t.incidentId),
    check("incident_deliveries_channel_valid", sql`${t.channel} IN ('push', 'email')`),
    check(
      "incident_deliveries_status_valid",
      sql`${t.status} IN ('pending', 'sent', 'failed', 'skipped')`,
    ),
  ],
);

/** Providers who opted in to nearby emergency alerts (F-063). */
export const providerEmergencySettings = pgTable(
  "provider_emergency_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    optedIn: boolean("opted_in").notNull().default(false),
    radiusKm: smallint("radius_km").notNull().default(25),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [check("provider_emergency_settings_radius", sql`${t.radiusKm} BETWEEN 1 AND 100`)],
);

export type EmergencyIncident = typeof emergencyIncidents.$inferSelect;
export type IncidentRecipient = typeof incidentRecipients.$inferSelect;
export type IncidentDelivery = typeof incidentDeliveries.$inferSelect;
export type TrustedContact = typeof trustedContacts.$inferSelect;
