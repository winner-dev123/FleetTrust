import { describe, expect, it } from "vitest";

import { expenseRequestSchema, fleetDashboardSchema, SPENDING_DISCLAIMER } from "./fleet.js";
import { applyRequestSchema, jobRequestSchema, jobWarnings, salaryLabel } from "./jobs.js";

describe("spending records", () => {
  const base = { category: "fuel", amount: "2450.50", currency: "ZAR", spentOn: "2027-01-10" };

  it("accepts exact amounts and refuses zero, negative and over-precise ones", () => {
    expect(expenseRequestSchema.parse(base)).toMatchObject({ amount: "2450.50", vehicleId: null });
    for (const amount of ["0", "-5", "12.345", "1e3", "abc"]) {
      expect(expenseRequestSchema.safeParse({ ...base, amount }).success).toBe(false);
    }
    expect(
      expenseRequestSchema.safeParse({ ...base, category: "tolls", litres: "5" }).success,
    ).toBe(false);
  });

  it("can't be presented as verified", () => {
    const shape = fleetDashboardSchema.shape.spending.shape;
    expect(shape.verified.safeParse(true).success).toBe(false);
    expect(shape.disclaimer.safeParse(SPENDING_DISCLAIMER).success).toBe(true);
    expect(SPENDING_DISCLAIMER).toMatch(/not verified payments/);
  });
});

describe("job listings", () => {
  it("flags fee and deposit wording", () => {
    expect(jobWarnings("A R500 training fee applies.")).toEqual(["asks_for_payment"]);
    expect(jobWarnings("Pay a deposit to secure your place.")).toEqual(["asks_for_payment"]);
    expect(jobWarnings("Paid via Western Union.")).toEqual(["asks_for_payment"]);
    expect(jobWarnings("Competitive pay, medical aid and a pension fund.")).toEqual([]);
  });

  it("labels salaries as advertised and checks ranges and contacts", () => {
    expect(salaryLabel({ currency: "ZAR", min: "18000", max: "22000", period: "month" })).toBe(
      "ZAR 18000–22000 per month (advertised)",
    );
    expect(salaryLabel({ currency: "USD", min: "25", max: null, period: "hour" })).toBe(
      "USD 25 per hour (advertised)",
    );
    const job = {
      title: "Truck driver",
      description: "x".repeat(60),
      role: "driver",
      employmentType: "full_time",
      locality: "Durban",
      countryCode: "ZA",
      closesOn: "2027-02-01",
    };
    expect(jobRequestSchema.safeParse(job).success).toBe(true);
    expect(
      jobRequestSchema.safeParse({
        ...job,
        salary: { currency: "ZAR", min: "20000", max: "10000", period: "month" },
      }).success,
    ).toBe(false);
    expect(
      applyRequestSchema.safeParse({ message: "I have ten years of experience." }).success,
    ).toBe(false);
    expect(
      applyRequestSchema.safeParse({
        message: "I have ten years of experience.",
        email: "driver@example.test",
      }).success,
    ).toBe(true);
  });
});
