import { ensureTestDatabaseTemplate } from "@fleettrust/db/testing";

/** Build the migrated PGlite snapshot once, before test files boot their databases in parallel. */
export default async function setup(): Promise<void> {
  await ensureTestDatabaseTemplate();
}
