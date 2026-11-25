import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { id } from "./columns.js";
import { users } from "./users.js";

/**
 * Admin feature settings (Prompt 26, ADR-0033). Keys are a fixed list in code
 * (FEATURE_SETTINGS in @fleettrust/types); a missing row means the default value.
 */
export const featureSettings = pgTable(
  "feature_settings",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check("feature_settings_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'`),
  ],
);

/**
 * Admin settings per service category. The category codes are fixed in code (offerings and
 * requests check them); a missing row means the defaults.
 */
export const serviceCategorySettings = pgTable(
  "service_category_settings",
  {
    category: text("category").primaryKey(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull(),
    acceptingNewOfferings: boolean("accepting_new_offerings").notNull().default(true),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "service_category_settings_category_valid",
      sql`${t.category} IN ('workshop', 'fuel_station', 'towing', 'tyres', 'parts', 'parking', 'mobile_mechanic')`,
    ),
    check(
      "service_category_settings_description_length",
      sql`char_length(${t.description}) <= 500`,
    ),
    check("service_category_settings_sort_order_range", sql`${t.sortOrder} BETWEEN 0 AND 1000`),
  ],
);

export const SUPPORT_CASE_STATUSES = ["open", "closed"] as const;

/**
 * Support cases (SRS §2.3): every support action on an account belongs to an open case, so
 * the audit log shows why someone looked at or acted on it.
 */
export const supportCases = pgTable(
  "support_cases",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    status: text("status", { enum: SUPPORT_CASE_STATUSES }).notNull().default("open"),
    resolution: text("resolution"),
    openedBy: uuid("opened_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "restrict" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("support_cases_user_idx").on(t.userId, t.openedAt),
    index("support_cases_open_idx").on(t.status, t.openedAt),
    check("support_cases_status_valid", sql`${t.status} IN ('open', 'closed')`),
    check("support_cases_reason_length", sql`char_length(${t.reason}) BETWEEN 5 AND 1000`),
    check(
      "support_cases_closed_consistent",
      sql`(${t.status} = 'open' AND ${t.closedAt} IS NULL AND ${t.closedBy} IS NULL AND ${t.resolution} IS NULL)
        OR (${t.status} = 'closed' AND ${t.closedAt} IS NOT NULL AND ${t.closedBy} IS NOT NULL AND ${t.resolution} IS NOT NULL)`,
    ),
  ],
);

export type FeatureSetting = typeof featureSettings.$inferSelect;
export type ServiceCategorySetting = typeof serviceCategorySettings.$inferSelect;
export type SupportCase = typeof supportCases.$inferSelect;
