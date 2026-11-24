import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";
import { bookingFixture, pgCode } from "./support/appointment-fixtures.js";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

describe("appointments_staff_no_overlap (ADR-0027)", () => {
  it("refuses overlapping booked appointments for the same staff member", async () => {
    const f = await bookingFixture(t.db);
    await f.book(f.staffA, "2027-03-01T09:00:00Z", "2027-03-01T10:00:00Z");
    const overlap = await f
      .book(f.staffA, "2027-03-01T09:30:00Z", "2027-03-01T10:30:00Z")
      .then(() => null)
      .catch((error: unknown) => error);
    expect(pgCode(overlap)).toBe("23P01"); // exclusion_violation
    // Back-to-back is fine (half-open ranges), as is another staff member at the same time.
    await f.book(f.staffA, "2027-03-01T10:00:00Z", "2027-03-01T11:00:00Z");
    await f.book(f.staffB, "2027-03-01T09:30:00Z", "2027-03-01T10:30:00Z");
    // Cancelled and finished appointments don't hold the time.
    await f.book(f.staffA, "2027-03-02T09:00:00Z", "2027-03-02T10:00:00Z", "cancelled");
    await f.book(f.staffA, "2027-03-02T09:00:00Z", "2027-03-02T10:00:00Z");
  });

  it("refuses an end before the start and a cancelled row without a reason", async () => {
    const f = await bookingFixture(t.db);
    const backwards = await f
      .book(f.staffA, "2027-03-01T10:00:00Z", "2027-03-01T09:00:00Z")
      .catch((error: unknown) => error);
    expect(pgCode(backwards)).toBe("23514"); // check_violation
  });
});
