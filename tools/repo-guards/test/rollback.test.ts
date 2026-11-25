import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkRollbackSafety, migrationNumber, ROLLBACK_BASELINE } from "../src/rollback.ts";

const check = (content: string, file = "packages/db/migrations/0042_next.sql") =>
  checkRollbackSafety({ path: file, content }).map((v) => v.detail);

describe("rollback-safe migrations", () => {
  it.each([
    'ALTER TABLE "users" DROP COLUMN "nickname";',
    'DROP TABLE "old_things";',
    'ALTER TABLE "users" RENAME COLUMN "name" TO "display_name";',
    'ALTER TABLE "users" RENAME TO "people";',
    'ALTER TABLE "users" ALTER COLUMN "age" SET DATA TYPE bigint;',
    'ALTER TABLE "users" ALTER COLUMN "age" TYPE bigint;',
    'ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;',
    'ALTER TABLE "users" ADD COLUMN "tier" text NOT NULL;',
    'TRUNCATE "sessions";',
    'DROP TYPE "status";',
  ])("refuses a statement that breaks the previous release: %s", (statement) => {
    expect(check(statement)).toHaveLength(1);
  });

  it.each([
    'ALTER TABLE "users" ADD COLUMN "tier" text;',
    'ALTER TABLE "users" ADD COLUMN "tier" text DEFAULT \'free\' NOT NULL;',
    'CREATE TABLE "pilot_invites" ("id" uuid PRIMARY KEY);',
    'CREATE INDEX "users_email_idx" ON "users" ("email");',
    'ALTER TABLE "users" ADD CONSTRAINT "users_age_check" CHECK ("age" >= 0) NOT VALID;',
    'DROP INDEX "users_old_idx";',
    "-- we will DROP COLUMN nickname in a later contract release",
  ])("allows an expanding statement: %s", (statement) => {
    expect(check(statement)).toEqual([]);
  });

  it("allows a declared contract migration, and ignores reviewed history", () => {
    expect(
      check(
        '-- contract: nickname unused since release 2027-01 (PR #40)\nALTER TABLE "users" DROP COLUMN "nickname";',
      ),
    ).toEqual([]);
    expect(check('DROP TABLE "x";', "packages/db/migrations/0012_old.sql")).toEqual([]);
    expect(migrationNumber("packages/db/migrations/0042_next.sql")).toBe(42);
    expect(migrationNumber("packages/db/migrations/meta/_journal.json")).toBeNull();
  });

  it("every migration after the baseline in the repository is rollback-safe", () => {
    const dir = path.resolve(import.meta.dirname, "../../../packages/db/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThanOrEqual(ROLLBACK_BASELINE + 1);
    const violations = files.flatMap((f) =>
      checkRollbackSafety({
        path: `packages/db/migrations/${f}`,
        content: readFileSync(path.join(dir, f), "utf8"),
      }),
    );
    expect(violations).toEqual([]);
  });
});
