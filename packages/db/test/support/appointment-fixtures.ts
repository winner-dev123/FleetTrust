import { uuidv7 } from "uuidv7";

import type { Executor } from "../../src/database.js";
import { appointments, branches, organizations, users } from "../../src/schema/index.js";

/** A provider with one branch and two staff users, for appointment constraint tests. */
export async function bookingFixture(db: Executor) {
  const make = async () => {
    const [row] = await db
      .insert(users)
      .values({ firebaseUid: `appointment-${uuidv7()}` })
      .returning();
    if (!row) throw new Error("no user");
    return row.id;
  };
  const owner = await make();
  const staffA = await make();
  const staffB = await make();
  const [org] = await db
    .insert(organizations)
    .values({ kind: "provider", name: "Booking Garage", createdBy: owner })
    .returning();
  if (!org) throw new Error("no org");
  const [branch] = await db
    .insert(branches)
    .values({ organizationId: org.id, name: "Main", locality: "Testville", countryCode: "ZA" })
    .returning();
  if (!branch) throw new Error("no branch");
  const bookWith = (
    executor: Executor,
    staffUserId: string,
    startsAt: string,
    endsAt: string,
    status = "booked",
  ) =>
    executor.insert(appointments).values({
      organizationId: org.id,
      branchId: branch.id,
      staffUserId,
      title: "Service",
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      status: status as "booked",
      cancelReason: status === "cancelled" ? "Customer asked" : null,
      createdBy: owner,
    });
  const book = (staffUserId: string, startsAt: string, endsAt: string, status = "booked") =>
    bookWith(db, staffUserId, startsAt, endsAt, status);
  return { owner, staffA, staffB, organizationId: org.id, branchId: branch.id, book, bookWith };
}

/** The Postgres error code of a failed query (drizzle wraps driver errors in `cause`). */
export function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 4 && current; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
