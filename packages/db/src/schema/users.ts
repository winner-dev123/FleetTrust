import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns.js";

export const USER_STATUSES = ["active", "suspended"] as const;
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
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("users_firebase_uid_key").on(t.firebaseUid),
    index("users_email_idx").on(t.email),
    check("users_status_valid", sql`${t.status} IN ('active', 'suspended')`),
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
