import pg from "pg";

import { createDatabase, runMigrations } from "../database.js";
import { runSeed } from "../seed/index.js";
import { describeUrl, isLocalDatabase, runCli, targetUrl } from "./shared.js";

/**
 * Drops and rebuilds the application schema, then migrates and seeds. Local databases only:
 * refuses non-localhost hosts and deployed APP_ENV values, and requires --yes.
 */
await runCli(async () => {
  const argv = process.argv.slice(2);
  const { url, variable } = targetUrl(argv);
  const appEnv = process.env["APP_ENV"] ?? "local";

  if (!isLocalDatabase(url) || !["local", "test"].includes(appEnv)) {
    throw new Error(`Refusing to reset ${describeUrl(url)}: only local databases can be reset.`);
  }
  if (!argv.includes("--yes")) {
    throw new Error(
      `This DELETES all data in ${describeUrl(url)} (${variable}). Re-run with --yes to confirm.`,
    );
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }

  await runMigrations(url);
  const handle = createDatabase({ url, maxConnections: 1 });
  try {
    await runSeed(handle.db);
  } finally {
    await handle.close();
  }
  console.warn(`Reset, migrated and seeded ${describeUrl(url)}.`);
});
