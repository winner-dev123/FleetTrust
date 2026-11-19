import { sql } from "drizzle-orm";

import type { Database, Executor } from "../database.js";
import { currencies } from "../schema/currencies.js";
import { CURRENCIES } from "./currencies.data.js";

/**
 * Seed steps must be idempotent: running `pnpm db:seed` any number of times converges on the
 * same data. Use natural keys or deterministic IDs with ON CONFLICT, never blind inserts.
 * Seeds hold reference data only; demo/test fixtures live with the tests that use them.
 */
export interface SeedStep {
  name: string;
  run(executor: Executor): Promise<{ upserted: number }>;
}

const currenciesStep: SeedStep = {
  name: "currencies",
  async run(executor) {
    const rows = CURRENCIES.map(([code, name, displayDecimals]) => ({
      code,
      name,
      displayDecimals,
    }));
    await executor
      .insert(currencies)
      .values(rows)
      .onConflictDoUpdate({
        target: currencies.code,
        set: {
          name: sql`excluded.name`,
          displayDecimals: sql`excluded.display_decimals`,
          updatedAt: sql`now()`,
        },
        // Only touch rows whose reference data actually changed, so re-runs are no-ops.
        setWhere: sql`(${currencies.name}, ${currencies.displayDecimals}) IS DISTINCT FROM (excluded.name, excluded.display_decimals)`,
      });
    return { upserted: rows.length };
  },
};

/** Ordered seed steps. Later prompts append steps (plans in 08, service taxonomy in 11). */
export const seedSteps: readonly SeedStep[] = [currenciesStep];

export interface SeedReport {
  step: string;
  upserted: number;
}

/** Runs every seed step in one transaction: all or nothing. */
export async function runSeed(
  db: Database,
  steps: readonly SeedStep[] = seedSteps,
): Promise<SeedReport[]> {
  return db.transaction(async (tx) => {
    const report: SeedReport[] = [];
    for (const step of steps) {
      const { upserted } = await step.run(tx);
      report.push({ step: step.name, upserted });
    }
    return report;
  });
}
