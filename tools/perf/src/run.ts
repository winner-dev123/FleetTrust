import { appendFileSync, writeFileSync } from "node:fs";

import pg from "pg";

import { Api, testUser } from "./http.ts";
import {
  emergencyScenario,
  messagingScenario,
  quotaScenario,
  requestCreateScenario,
  type ScenarioResult,
  searchScenario,
} from "./scenarios.ts";
import { cloneProviders, publishTemplate } from "./seed.ts";
import { evaluate } from "./slo.ts";

/**
 * Load test run (Prompt 28). Needs a migrated PostgreSQL + PostGIS database, the API running
 * in the api role (API_URL) and the worker role, and the Firebase Auth emulator. Writes
 * results to PERF_OUT (JSON) and a Markdown table to GITHUB_STEP_SUMMARY when set.
 * Exits non-zero when a correctness check fails; latency misses are reported only.
 */

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
};

const api = new Api(env("API_URL", "http://127.0.0.1:8080"));
const emulator = env("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
const db = new pg.Client({ connectionString: env("DATABASE_URL") });
/** Pilot volume (SRS §7: 1k provider organisations), then a dense stress volume. */
const pilotProviders = Number(env("PERF_PILOT_PROVIDERS", "1000"));
const providers = Number(env("PERF_PROVIDERS", "20000"));

await db.connect();
const results: ScenarioResult[] = [];
const started = new Date().toISOString();
try {
  const owner = await testUser(api, emulator, "perf-owner@perf.test");
  const template = await publishTemplate(api, owner);
  const pilot = await cloneProviders(db, template, 1, pilotProviders - 1);
  console.log(`seeded ${String(pilot)} provider branches`);
  results.push(
    await searchScenario(api, db, { concurrency: 16, durationMs: 30_000, providers: pilot }),
  );
  const dense = await cloneProviders(db, template, pilotProviders, providers - 1);
  console.log(`seeded ${String(dense)} provider branches`);
  results.push(
    await searchScenario(api, db, {
      concurrency: 16,
      durationMs: 30_000,
      providers: dense,
      stress: true,
    }),
  );
  console.log("search done");
  results.push(
    await requestCreateScenario(api, db, emulator, { users: 60, perUser: 25, concurrency: 8 }),
  );
  console.log("request create done");
  results.push(await quotaScenario(api, emulator, { users: 25, burst: 10, dailyLimit: 3 }));
  console.log("quota done");
  results.push(
    ...(await messagingScenario(api, db, emulator, {
      members: 50,
      senders: 10,
      messagesPerSender: 10,
    })),
  );
  console.log("messaging done");
  results.push(await emergencyScenario(api, db, emulator, { owners: 40, contactsEach: 5 }));
  console.log("emergency done");
} finally {
  await db.end();
}

const verdicts = results.map((r) => ({
  ...evaluate(r.key, r.summary),
  checks: r.checks,
  notes: r.notes,
  samples: r.samples,
}));
const failedChecks = verdicts.flatMap((v) =>
  v.checks.filter((c) => !c.ok).map((c) => `${v.key}: ${c.name} (${c.detail})`),
);
const report = {
  started,
  finished: new Date().toISOString(),
  providers: { pilot: pilotProviders, stress: providers },
  verdicts,
  failedChecks,
};
writeFileSync(env("PERF_OUT", "perf-results.json"), JSON.stringify(report, null, 2));

const rows = verdicts.map(
  (v) =>
    `| ${v.target.name} | ${String(v.summary.count)} | ${String(v.summary.p50)} | ${String(v.summary.p95)} | ${String(v.summary.p99)} | ${String(v.summary.max)} | ${String(v.summary.throughput)} | ${String(v.summary.errorRate)} | ${String(v.target.p95Ms)} / ${String(v.target.p99Ms)} | ${v.met ? "met" : `missed: ${v.misses.join("; ")}`} |`,
);
const markdown = [
  `### Load test (${String(pilotProviders)} then ${String(providers)} provider branches)`,
  "",
  "| Scenario | Samples | p50 ms | p95 ms | p99 ms | max ms | per s | error rate | target p95 / p99 ms | SLO |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
  "**Correctness checks**",
  ...verdicts.flatMap((v) =>
    v.checks.map((c) => `- ${c.ok ? "PASS" : "FAIL"} ${v.key}: ${c.name} (${c.detail})`),
  ),
  "",
  ...verdicts.flatMap((v) => v.notes.map((n) => `- ${v.key}: ${n}`)),
  ...verdicts.flatMap((v) => v.samples.map((s) => `- sample error (${v.key}): ${s}`)),
  "",
].join("\n");
console.log(markdown);
if (process.env["GITHUB_STEP_SUMMARY"])
  appendFileSync(process.env["GITHUB_STEP_SUMMARY"], markdown);
if (failedChecks.length > 0) {
  console.error(`correctness checks failed:\n${failedChecks.join("\n")}`);
  process.exit(1);
}
