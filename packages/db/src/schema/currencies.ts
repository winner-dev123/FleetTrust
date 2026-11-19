import { sql } from "drizzle-orm";
import { boolean, check, char, pgTable, smallint, text } from "drizzle-orm/pg-core";

import { timestamps } from "./columns.js";

/**
 * ISO 4217 reference data, seeded by `pnpm db:seed`. Referenced by plan prices (Prompt 08)
 * and indicative service prices (Prompt 11).
 */
export const currencies = pgTable(
  "currencies",
  {
    code: char("code", { length: 3 }).primaryKey(),
    name: text("name").notNull(),
    /** CLDR display precision. Not the ISO minor unit; never use it to store amounts. */
    displayDecimals: smallint("display_decimals").notNull(),
    /** Lets operators hide a currency without deleting rows that reference it. */
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    check("currencies_code_format", sql`${t.code} ~ '^[A-Z]{3}$'`),
    check("currencies_display_decimals_range", sql`${t.displayDecimals} BETWEEN 0 AND 4`),
  ],
);

export type Currency = typeof currencies.$inferSelect;
