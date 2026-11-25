import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns.js";

/** "deleted": the person erased their account (Prompt 27); the row remains as an anonymous tombstone. */
export const USER_STATUSES = ["active", "suspended", "deleted"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Internal user accounts (ADR-0005). Firebase Authentication proves identity; this row is
 * what the rest of the system references. Created just-in-time on the first verified API
 * call, so signup needs nothing beyond a Firebase sign-in (SRS FR-01).
 *
 * Firebase UIDs never appear outside this table: everything else references `users.id`.
 */
export const users = pgTable(
  "users",
  {
    id: id(),
    firebaseUid: text("firebase_uid").notNull(),
    /** Lower-cased copy from the verified token, for support lookups. Firebase owns the address. */
    email: text("email"),
    emailVerified: boolean("email_verified").notNull().default(false),
    /** Optional until the user's first public contribution (articles, groups, …). */
    displayName: text("display_name"),
    status: text("status", { enum: USER_STATUSES }).notNull().default("active"),
    /** e.g. `emailLink`, `google.com`, `apple.com` (from the token's firebase.sign_in_provider). */
    lastSignInProvider: text("last_sign_in_provider"),
    /** IANA timezone; daily quotas reset at local midnight (OQ-08). Validated by the API. */
    timezone: text("timezone").notNull().default("UTC"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
    /** When the account was erased; the row keeps references (audit, shared content) intact. */
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("users_firebase_uid_key").on(t.firebaseUid),
    index("users_email_idx").on(t.email),
    check("users_status_valid", sql`${t.status} IN ('active', 'suspended', 'deleted')`),
    // A deleted account keeps no personal data.
    check(
      "users_deleted_anonymous",
      sql`(${t.status} = 'deleted') = (${t.deletedAt} IS NOT NULL)
        AND (${t.status} <> 'deleted' OR (${t.email} IS NULL AND ${t.displayName} IS NULL AND ${t.lastSeenAt} IS NULL))`,
    ),
    check("users_firebase_uid_length", sql`char_length(${t.firebaseUid}) BETWEEN 1 AND 128`),
    check("users_timezone_length", sql`char_length(${t.timezone}) BETWEEN 1 AND 64`),
    check("users_email_lowercase", sql`${t.email} IS NULL OR ${t.email} = lower(${t.email})`),
    check(
      "users_display_name_length",
      sql`${t.displayName} IS NULL OR char_length(${t.displayName}) BETWEEN 1 AND 50`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/** Consent purposes (Prompt 27, ADR-0034). Append-only: each change is a new row. */
export const CONSENT_PURPOSES = ["terms", "privacy", "analytics", "marketing_email"] as const;

export const consents = pgTable(
  "consents",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: CONSENT_PURPOSES }).notNull(),
    /** Version of the document or purpose text the person saw (e.g. "2026-11-01"). */
    version: text("version").notNull(),
    granted: boolean("granted").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("consents_user_purpose_idx").on(t.userId, t.purpose, t.recordedAt),
    check(
      "consents_purpose_valid",
      sql`${t.purpose} IN ('terms', 'privacy', 'analytics', 'marketing_email')`,
    ),
    check("consents_version_length", sql`char_length(${t.version}) BETWEEN 1 AND 40`),
  ],
);

export type Consent = typeof consents.$inferSelect;
