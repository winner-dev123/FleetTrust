import type { SourceFile, Violation } from "./rules.ts";

/**
 * Rollback safety (Prompt 29, docs/development/database.md#rollback-strategy). Rolling back a
 * release means running the previous image against the new schema, so a normal migration may
 * only expand: add tables, nullable columns or columns with defaults, indexes, constraints.
 *
 * Statements that break the previous release are refused unless the migration declares itself a
 * contract step with a line `-- contract: <reason>`. A contract migration ships as its own
 * release, after no running version uses what it removes, with a reviewed plan and a verified
 * backup window.
 *
 * Migrations up to the baseline were written before this rule and are reviewed history.
 */
export const ROLLBACK_BASELINE = 41;

const CONTRACT = /^\s*--\s*contract:\s*\S/im;

const RULES: { pattern: RegExp; detail: string }[] = [
  { pattern: /\bDROP\s+TABLE\b/i, detail: "drops a table the previous release may use" },
  { pattern: /\bDROP\s+COLUMN\b/i, detail: "drops a column the previous release may use" },
  { pattern: /\bRENAME\b/i, detail: "renames something the previous release refers to" },
  {
    pattern: /\bALTER\s+COLUMN\s+"?\w+"?\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    detail: "changes a column type",
  },
  {
    pattern: /\bALTER\s+COLUMN\s+"?\w+"?\s+SET\s+NOT\s+NULL\b/i,
    detail: "makes a column required (the previous release may not fill it)",
  },
  {
    pattern: /\bADD\s+COLUMN\b(?![^;]*\bDEFAULT\b)[^;]*\bNOT\s+NULL\b/i,
    detail: "adds a required column without a default",
  },
  { pattern: /\bTRUNCATE\b/i, detail: "deletes all rows" },
  { pattern: /\bDROP\s+TYPE\b/i, detail: "drops a type the previous release may use" },
];

/** Migration number from a file name like packages/db/migrations/0042_name.sql. */
export function migrationNumber(path: string): number | null {
  const match = /\/(\d{4})_[^/]+\.sql$/.exec(path);
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function checkRollbackSafety(file: SourceFile): Violation[] {
  const number = migrationNumber(file.path);
  if (number === null || number <= ROLLBACK_BASELINE) return [];
  if (CONTRACT.test(file.content)) return [];
  const violations: Violation[] = [];
  file.content.split(/\r?\n/).forEach((line, index) => {
    const code = line.replace(/--.*$/, "");
    for (const rule of RULES) {
      if (rule.pattern.test(code)) {
        violations.push({
          path: file.path,
          line: index + 1,
          rule: "rollback-unsafe-migration",
          detail: rule.detail,
        });
      }
    }
  });
  return violations;
}
