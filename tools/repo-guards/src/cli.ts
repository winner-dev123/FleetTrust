import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  checkApiRoutes,
  checkConfigKeys,
  checkDependencies,
  checkMigration,
  checkUiRoute,
  type SourceFile,
  type Violation,
} from "./rules.ts";
import { checkCopyUsage } from "./copy-usage.ts";
import { checkRollbackSafety, ROLLBACK_BASELINE } from "./rollback.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

/** Tracked plus new (not ignored) files, so the guard also sees uncommitted work. */
function listFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return output.split("\n").filter((file) => file !== "");
}

function read(file: string): SourceFile {
  return { path: file, content: readFileSync(path.join(repoRoot, file), "utf8") };
}

const isCode = (file: string) =>
  /^(apps|packages)\/[^/]+\/src\/.+\.(ts|tsx)$/.test(file) && !/\.(spec|test)\.tsx?$/.test(file);

export function runGuards(files: readonly string[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (/^packages\/db\/migrations\/.+\.sql$/.test(file))
      violations.push(...checkMigration(read(file)));
    if (isCode(file)) {
      const source = read(file);
      violations.push(...checkApiRoutes(source), ...checkConfigKeys(source));
    }
    if (/(^|\/)\.env(\.[a-z]+)?\.example$/.test(file))
      violations.push(...checkConfigKeys(read(file)));
    if (/(^|\/)package\.json$/.test(file)) violations.push(...checkDependencies(read(file)));
    violations.push(...checkUiRoute(file));
  }
  return violations;
}

const files = listFiles();
const violations = runGuards(files);

// Rollback safety: migrations after the baseline may only expand (docs/operations/release-and-rollback.md).
const migrations = files.filter((file) => /^packages\/db\/migrations\/.+\.sql$/.test(file));
const unsafe = migrations.flatMap((file) => checkRollbackSafety(read(file)));
if (unsafe.length === 0) {
  console.log(
    `Rollback guard: ${String(migrations.length)} migrations checked, every one after ${String(ROLLBACK_BASELINE).padStart(4, "0")} only expands the schema.`,
  );
} else {
  console.error("Rollback guard: these migrations would break the previous release:\n");
  for (const v of unsafe) console.error(`  ${v.path}:${String(v.line)}  ${v.detail}`);
  console.error(
    "\nShip it as a contract release instead: add `-- contract: <reason>` at the top, after no\n" +
      "running version uses what it removes (docs/operations/release-and-rollback.md).",
  );
  process.exitCode = 1;
}
if (violations.length === 0) {
  console.log(
    `ADR-0011 module guard: ${String(files.length)} files checked, no excluded modules found.`,
  );
} else {
  console.error(
    "ADR-0011 module guard found references to excluded modules (payments/escrow, reviews/ratings, rewards/streaks):\n",
  );
  for (const v of violations)
    console.error(`  ${v.path}:${String(v.line)}  [${v.rule}] ${v.detail}`);
  console.error(
    "\nThese modules are specification-only (docs/adr/0011-future-modules-spec-only.md).\n" +
      "If this is a false positive, add `guard-allow: <reason>` on that line and get it reviewed.",
  );
  process.exitCode = 1;
}

// Catalog drift (RFC-0006): every message in @fleettrust/copy is used by a screen.
const catalogFiles = files
  .filter((file) => /^packages\/copy\/src\/[^/]+\.ts$/.test(file) && !file.endsWith(".test.ts"))
  .map(read);
const screens = files
  .filter(
    (file) =>
      /^(apps|packages)\/.+\.tsx?$/.test(file) &&
      !file.startsWith("packages/copy/") &&
      !/(\.(test|spec|e2e-spec)\.tsx?$|\/test\/|\/e2e\/)/.test(file),
  )
  .map(read)
  .filter((source) => source.content.includes("@fleettrust/copy"));
const unused = checkCopyUsage(catalogFiles, screens);
if (unused.length === 0) {
  console.log(
    `Copy guard: every message in @fleettrust/copy is used (${String(screens.length)} files read).`,
  );
} else {
  console.error("Copy guard: these catalog messages are not used by any screen:\n");
  for (const v of unused) console.error(`  ${v.path}:${String(v.line)}  ${v.detail}`);
  console.error(
    "\nRemove them, or end the line with `// copy-unused: <reason>` and get it reviewed.",
  );
  process.exitCode = 1;
}
