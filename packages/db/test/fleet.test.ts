import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  fleetExpenses,
  fleetIncidents,
  jobs,
  organizations,
  users,
  vehicles,
} from "../src/schema/index.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";
import { pgCode } from "./support/appointment-fixtures.js";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

const failure = (promise: PromiseLike<unknown>) =>
  Promise.resolve(promise).then(
    () => null,
    (error: unknown) => error,
  );

async function setup() {
  const [owner] = await t.db
    .insert(users)
    .values({ firebaseUid: `fleet-${uuidv7()}` })
    .returning();
  if (!owner) throw new Error("no user");
  const org = async (kind: "fleet" | "provider", name: string) => {
    const [row] = await t.db
      .insert(organizations)
      .values({ kind, name, createdBy: owner.id })
      .returning();
    if (!row) throw new Error("no org");
    return row.id;
  };
  const fleetA = await org("fleet", "Fleet A");
  const fleetB = await org("fleet", "Fleet B");
  const provider = await org("provider", "A Garage");
  const [vehicleB] = await t.db
    .insert(vehicles)
    .values({ organizationId: fleetB, vehicleType: "heavy_truck", createdBy: owner.id })
    .returning();
  if (!vehicleB) throw new Error("no vehicle");
  return { owner: owner.id, fleetA, fleetB, provider, vehicleB: vehicleB.id };
}

describe("fleet tenant constraints (ADR-0029)", () => {
  it("never links a fleet's records to another fleet's vehicle", async () => {
    const f = await setup();
    const expense = await failure(
      t.db.insert(fleetExpenses).values({
        organizationId: f.fleetA,
        vehicleId: f.vehicleB,
        category: "fuel",
        amount: "100",
        currency: "ZAR",
        spentOn: "2027-01-10",
        enteredBy: f.owner,
      }),
    );
    expect(pgCode(expense)).toBe("23503");
    const incident = await failure(
      t.db.insert(fleetIncidents).values({
        organizationId: f.fleetA,
        vehicleId: f.vehicleB,
        kind: "breakdown",
        severity: "low",
        occurredAt: new Date(),
        description: "Flat tyre on the N3.",
        reportedBy: f.owner,
      }),
    );
    expect(pgCode(incident)).toBe("23503");
  });

  it("keeps fleet records and jobs on fleet organizations only, and amounts positive", async () => {
    const f = await setup();
    const providerExpense = await failure(
      t.db.insert(fleetExpenses).values({
        organizationId: f.provider,
        category: "fuel",
        amount: "100",
        currency: "ZAR",
        spentOn: "2027-01-10",
        enteredBy: f.owner,
      }),
    );
    expect(pgCode(providerExpense)).toBe("23503");
    const providerJob = await failure(
      t.db.insert(jobs).values({
        organizationId: f.provider,
        createdBy: f.owner,
        title: "Mechanic wanted",
        description: "x".repeat(60),
        role: "mechanic",
        employmentType: "full_time",
        locality: "Durban",
        countryCode: "ZA",
        closesOn: "2027-02-01",
      }),
    );
    expect(pgCode(providerJob)).toBe("23503");
    const zero = await failure(
      t.db.insert(fleetExpenses).values({
        organizationId: f.fleetA,
        category: "fuel",
        amount: "0",
        currency: "ZAR",
        spentOn: "2027-01-10",
        enteredBy: f.owner,
      }),
    );
    expect(pgCode(zero)).toBe("23514");
  });
});
