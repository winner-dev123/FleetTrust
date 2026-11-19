import { defineConfig } from "drizzle-kit";

/**
 * `pnpm db:generate` diffs src/schema against the migration snapshots and writes a new SQL
 * migration to ./migrations. It never connects to a database. Review every generated file.
 * Extensions, functions and triggers live in hand-written (`--custom`) migrations.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
