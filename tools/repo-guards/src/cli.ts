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
