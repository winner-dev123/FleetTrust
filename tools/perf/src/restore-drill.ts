import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

import pg from "pg";

/**
 * Backup restore drill (Prompt 28). Takes a logical backup of the live database, restores it
 * into a new database, and proves the copy is complete: every table has the same row count,
 * sampled tables have identical content checksums, the migration history matches, and the
 * restored copy answers a real query (a geospatial search). Timings give the logical-restore
 * RTO. Cloud SQL point-in-time recovery is drilled separately on staging (docs/operations).
 *
 * PG_EXEC: a command prefix to run pg_dump/pg_restore/psql where the server's own tools live
 * (CI: "docker exec -i <container>"), so client and server versions match.
 */

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
};

const source = new URL(env("DATABASE_URL"));
const prefix = env("PG_EXEC", "").split(" ").filter(Boolean);
const user = decodeURIComponent(source.username);
const password = decodeURIComponent(source.password);
const sourceDb = source.pathname.slice(1);
const drillDb = `${sourceDb}_restore_drill`;

function tool(cmd: string, args: string[], input?: Buffer): Buffer {
  const [bin, ...rest] =
    prefix.length > 0 ? [...prefix, "env", `PGPASSWORD=${password}`, cmd, ...args] : [cmd, ...args];
  if (!bin) throw new Error("no command");
  return execFileSync(bin, rest, {
    input,
    maxBuffer: 1024 * 1024 * 1024,
    env: { ...process.env, PGPASSWORD: password },
  });
}

const connect = async (database: string) => {
  const url = new URL(source.toString());
  url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
};

const ms = (t0: number) => Math.round(performance.now() - t0);
const host = prefix.length > 0 ? "127.0.0.1" : source.hostname;
const port = prefix.length > 0 ? "5432" : source.port || "5432";
const conn = ["-h", host, "-p", port, "-U", user];

// 1. Backup.
let t0 = performance.now();
const dump = tool("pg_dump", [...conn, "-d", sourceDb, "-Fc", "--no-owner"]);
const backupMs = ms(t0);

// 2. Restore into a fresh database.
const admin = await connect(sourceDb);
await admin.query(`DROP DATABASE IF EXISTS ${drillDb}`);
await admin.query(`CREATE DATABASE ${drillDb}`);
t0 = performance.now();
tool("pg_restore", [...conn, "-d", drillDb, "--no-owner", "--exit-on-error"], dump);
const restoreMs = ms(t0);

// 3. Verify.
const original = await connect(sourceDb);
const restored = await connect(drillDb);
const tables = (
  await original.query<{ name: string }>(
    `SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) AS name FROM pg_tables
      WHERE schemaname IN ('public', 'drizzle') ORDER BY 1`,
  )
).rows.map((r) => r.name);
const mismatches: string[] = [];
let rows = 0;
for (const table of tables) {
  const count = async (client: pg.Client) =>
    Number(
      (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]?.n ??
        -1,
    );
  const [a, b] = [await count(original), await count(restored)];
  rows += a;
  if (a !== b) mismatches.push(`${table}: ${String(a)} rows vs ${String(b)} restored`);
}
const checksum = async (client: pg.Client, sql: string) =>
  (
    await client.query<{ h: string | null }>(
      `SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS h FROM (${sql}) t`,
    )
  ).rows[0]?.h;
const sampled = [
  "SELECT id, email, status, created_at FROM users",
  "SELECT id, action, target_type, target_id, occurred_at FROM audit_events",
  "SELECT branch_id, slug, ST_AsText(location::geometry) AS location FROM provider_search_entries",
  "SELECT id, conversation_id, seq, body FROM messages",
  "SELECT id, owner_user_id, status, created_at FROM emergency_incidents",
];
for (const sql of sampled) {
  if ((await checksum(original, sql)) !== (await checksum(restored, sql)))
    mismatches.push(`checksum differs: ${sql}`);
}
const migrations = async (client: pg.Client) =>
  (
    await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
    )
  ).rows[0]?.n;
const migrationsMatch = (await migrations(original)) === (await migrations(restored));
if (!migrationsMatch) mismatches.push("migration history differs");
const near = await restored.query<{ n: string }>(
  `SELECT count(*)::text AS n FROM provider_search_entries
    WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(28.04, -26.2), 4326)::geography, 25000)`,
);
const nearCount = Number(near.rows[0]?.n ?? 0);
if (nearCount === 0) mismatches.push("restored database answered no geospatial query results");

await original.end();
await restored.end();
await admin.query(`DROP DATABASE IF EXISTS ${drillDb}`);
await admin.end();

const report = {
  at: new Date().toISOString(),
  tables: tables.length,
  rows,
  backupBytes: dump.length,
  backupMs,
  restoreMs,
  checksumsCompared: sampled.length,
  geospatialRowsNearJohannesburg: nearCount,
  migrationsMatch,
  mismatches,
  passed: mismatches.length === 0,
};
writeFileSync(env("DRILL_OUT", "restore-drill.json"), JSON.stringify(report, null, 2));
const markdown = [
  "### Restore drill",
  "",
  `- ${report.passed ? "PASS" : "FAIL"}: ${String(report.tables)} tables, ${String(report.rows)} rows; backup ${String(Math.round(report.backupBytes / 1024))} KiB in ${String(report.backupMs)} ms; restore in ${String(report.restoreMs)} ms`,
  `- Row counts identical for every table; ${String(report.checksumsCompared)} content checksums compared; migration history ${migrationsMatch ? "matches" : "differs"}; geospatial query on the copy returned ${String(nearCount)} branches`,
  ...mismatches.map((m) => `- MISMATCH: ${m}`),
  "",
].join("\n");
console.log(markdown);
if (process.env["GITHUB_STEP_SUMMARY"])
  appendFileSync(process.env["GITHUB_STEP_SUMMARY"], markdown);
if (!report.passed) process.exit(1);
