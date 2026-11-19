import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { currencies } from "../src/schema/index.js";
import { CURRENCIES } from "../src/seed/currencies.data.js";
import { runSeed } from "../src/seed/index.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

async function snapshot() {
  return t.db.select().from(currencies).orderBy(currencies.code);
}

describe("runSeed", () => {
  it("seeds ISO 4217 currencies", async () => {
    const report = await runSeed(t.db);
    expect(report).toEqual([{ step: "currencies", upserted: CURRENCIES.length }]);

    const rows = await snapshot();
    expect(rows).toHaveLength(CURRENCIES.length);
    expect(rows.find((row) => row.code === "JPY")).toMatchObject({
      name: "Japanese Yen",
      displayDecimals: 0,
    });
    expect(rows.find((row) => row.code === "KWD")?.displayDecimals).toBe(3);
  });

  it("is repeatable: a second run changes nothing, not even updated_at", async () => {
    const before = await snapshot();
    await runSeed(t.db);
    expect(await snapshot()).toEqual(before);
  });

  it("repairs drifted reference data and keeps operator flags", async () => {
    await t.db
      .update(currencies)
      .set({ name: "Edited by hand", isActive: false })
      .where(eq(currencies.code, "ZAR"));

    await runSeed(t.db);
    const [zar] = await t.db.select().from(currencies).where(eq(currencies.code, "ZAR"));
    expect(zar?.name).toBe("South African Rand");
    // is_active is an operator decision, so seeding must not flip it back.
    expect(zar?.isActive).toBe(false);
  });

  it("rolls back every step if one fails", async () => {
    const before = await snapshot();
    await expect(
      runSeed(t.db, [
        {
          name: "delete-then-fail",
          async run(executor) {
            await executor.delete(currencies);
            throw new Error("boom");
          },
        },
      ]),
    ).rejects.toThrow("boom");
    expect(await snapshot()).toEqual(before);
  });

  it("the database rejects malformed currency rows", async () => {
    await expect(
      t.db.insert(currencies).values({ code: "usd", name: "lowercase", displayDecimals: 2 }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(currencies).values({ code: "XQZ", name: "too precise", displayDecimals: 9 }),
    ).rejects.toThrow();
  });
});
