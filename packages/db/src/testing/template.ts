import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { postgis } from "@electric-sql/pglite-postgis";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { migrationsFolder } from "../database.js";
import * as schema from "../schema/index.js";
import { runSeed } from "../seed/index.js";

/**
 * A migrated PGlite data directory, cached on disk and keyed by the migration files' content.
 * Booting PGlite + PostGIS and running every migration costs seconds per test file, and much
 * more on a loaded CI runner. Loading the snapshot skips the migrations. Any change to a
 * migration changes the key, so a stale snapshot is never used.
 */
const CACHE_DIR = path.join(tmpdir(), "fleettrust-pglite-templates");

async function templateKey(): Promise<string> {
  const hash = createHash("sha256");
  const files = (await readdir(migrationsFolder, { recursive: true })).map(String).sort();
  for (const file of files) {
    if (!file.endsWith(".sql") && !file.endsWith(".json")) continue;
    hash.update(file).update(await readFile(path.join(migrationsFolder, file)));
  }
  // Seed data is baked in too: hash the seed modules' source.
  const seedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "seed");
  for (const file of (await readdir(seedDir)).sort()) {
    hash.update(file).update(await readFile(path.join(seedDir, file)));
  }
  // The snapshot must match the engine that loads it: the resolved paths carry the versions.
  const require = createRequire(import.meta.url);
  hash.update(require.resolve("@electric-sql/pglite"));
  hash.update(require.resolve("@electric-sql/pglite-postgis"));
  return hash.digest("hex").slice(0, 24);
}

let pending: Promise<string> | undefined;

/**
 * Returns the path of the migrated snapshot, building it if needed. Safe to call from
 * parallel processes: each writes to a unique temp file and renames it into place atomically.
 * Call it from a Vitest `globalSetup` to build it once before test files start.
 */
export function ensureTestDatabaseTemplate(): Promise<string> {
  pending ??= (async () => {
    const file = path.join(CACHE_DIR, `${await templateKey()}.tar`);
    try {
      await access(file);
      return file;
    } catch {
      // not built yet
    }
    const client = await PGlite.create({ extensions: { postgis, btree_gist } });
    try {
      await migrate(drizzle(client), { migrationsFolder });
      // Reference data (currencies, plan catalog) belongs in a realistic test database.
      await runSeed(drizzle(client, { schema }));
      const dump = await client.dumpDataDir("none");
      await mkdir(CACHE_DIR, { recursive: true });
      const partial = `${file}.${randomUUID()}.partial`;
      await writeFile(partial, Buffer.from(await dump.arrayBuffer()));
      await rename(partial, file).catch(async (error: unknown) => {
        await rm(partial, { force: true });
        throw error;
      });
    } finally {
      await client.close();
    }
    return file;
  })();
  return pending;
}

export async function loadTemplate(): Promise<Blob> {
  return new Blob([await readFile(await ensureTestDatabaseTemplate())]);
}
