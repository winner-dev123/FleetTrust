import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

/**
 * Schema conventions (docs/architecture/data-conventions.md), checked against the real
 * migrated catalog. These run for every table later prompts add, so a new table that
 * forgets a convention fails CI instead of slipping into production.
 */

let t: TestDatabase;
let tables: string[];

beforeAll(async () => {
  t = await createTestDatabase();
  const { rows } = await t.client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'spatial_ref_sys'`,
  );
  tables = rows.map((row) => row.table_name);
});

afterAll(async () => {
  await t.close();
});

async function columns(table: string) {
  const { rows } = await t.client.query<{ column_name: string; data_type: string }>(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
    [table],
  );
  return new Map(rows.map((row) => [row.column_name, row.data_type]));
}

describe("schema conventions", () => {
  it("every table has a primary key", async () => {
    const { rows } = await t.client.query<{ table_name: string }>(
      `SELECT tc.table_name FROM information_schema.table_constraints tc
       WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'`,
    );
    const withPk = new Set(rows.map((row) => row.table_name));
    expect(tables.filter((table) => !withPk.has(table))).toEqual([]);
  });

  it("all timestamps are timestamptz", async () => {
    const { rows } = await t.client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`,
    );
    expect(rows).toEqual([]);
  });

  it("every table with updated_at has the set_updated_at trigger", async () => {
    const { rows } = await t.client.query<{ table: string }>(
      `SELECT c.relname AS table FROM pg_trigger tg
       JOIN pg_class c ON c.oid = tg.tgrelid
       JOIN pg_proc p ON p.oid = tg.tgfoid
       WHERE NOT tg.tgisinternal AND p.proname = 'set_updated_at'`,
    );
    const withTrigger = new Set(rows.map((row) => row.table));
    const missing: string[] = [];
    for (const table of tables) {
      if ((await columns(table)).has("updated_at") && !withTrigger.has(table)) missing.push(table);
    }
    expect(missing).toEqual([]);
  });

  it("every organization_id column is uuid and leads an index (tenant-scoped queries stay fast)", async () => {
    const problems: string[] = [];
    for (const table of tables) {
      const type = (await columns(table)).get("organization_id");
      if (type === undefined) continue;
      if (type !== "uuid") problems.push(`${table}.organization_id is ${type}`);
      const { rows } = await t.client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
         WHERE c.relname = $1 AND a.attname = 'organization_id'`,
        [table],
      );
      if ((rows[0]?.count ?? 0) === 0)
        problems.push(`${table} has no index led by organization_id`);
    }
    expect(problems).toEqual([]);
  });

  it("primary keys named id are uuid", async () => {
    const problems: string[] = [];
    for (const table of tables) {
      const type = (await columns(table)).get("id");
      if (type !== undefined && type !== "uuid") problems.push(`${table}.id is ${type}`);
    }
    expect(problems).toEqual([]);
  });
});
