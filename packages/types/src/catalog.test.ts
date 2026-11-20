import { describe, expect, it } from "vitest";

import {
  formatIndicativePrice,
  fractionDigits,
  type IndicativePrice,
  indicativePriceSchema,
  INDICATIVE_PRICE_DISCLAIMER,
  offeringRequestSchema,
} from "./catalog.js";

describe("indicative prices", () => {
  it.each<[IndicativePrice, RegExp]>([
    [{ type: "fixed", currency: "ZAR", amount: "450", unit: "job" }, /^ZAR\s450\.00 per job$/],
    [
      { type: "from", currency: "ZAR", amount: "1450.5", unit: "hour" },
      /^From ZAR\s1,450\.50 per hour$/,
    ],
    [
      { type: "range", currency: "USD", min: "80", max: "120", unit: "tyre" },
      /^\$80\.00–\$120\.00 per tyre$/,
    ],
    [{ type: "quote_required" }, /^Price on request \(quote required\)$/],
  ])("labels every price type: %j", (price, label) => {
    expect(formatIndicativePrice(price)).toMatch(label);
  });

  it("never reads like a checkout", () => {
    const prices: IndicativePrice[] = [
      { type: "fixed", currency: "EUR", amount: "99", unit: "item" },
      { type: "from", currency: "EUR", amount: "99", unit: "night" },
      { type: "range", currency: "EUR", min: "1", max: "2", unit: "litre" },
      { type: "quote_required" },
    ];
    for (const price of prices) {
      expect(formatIndicativePrice(price, "en-GB")).not.toMatch(/buy|pay|checkout|cart|order now/i);
    }
    expect(INDICATIVE_PRICE_DISCLAIMER).toMatch(/indicative/);
    expect(INDICATIVE_PRICE_DISCLAIMER).toMatch(/not a binding offer/);
  });

  it("uses currency-appropriate decimals when formatting (JPY has none)", () => {
    expect(
      formatIndicativePrice(
        { type: "fixed", currency: "JPY", amount: "5000", unit: "job" },
        "en-US",
      ),
    ).toBe("¥5,000 per job");
  });

  it.each([
    ["zero", { type: "fixed", currency: "ZAR", amount: "0", unit: "job" }],
    ["negative", { type: "fixed", currency: "ZAR", amount: "-5", unit: "job" }],
    ["five decimals", { type: "fixed", currency: "ZAR", amount: "1.23456", unit: "job" }],
    ["a number instead of a string", { type: "fixed", currency: "ZAR", amount: 450, unit: "job" }],
    ["lower-case currency", { type: "fixed", currency: "zar", amount: "1", unit: "job" }],
    ["missing unit", { type: "from", currency: "ZAR", amount: "1" }],
    [
      "range max below min",
      { type: "range", currency: "ZAR", min: "500", max: "400", unit: "job" },
    ],
    [
      "range max equal to min",
      { type: "range", currency: "ZAR", min: "500", max: "500", unit: "job" },
    ],
    ["quote with an amount", { type: "quote_required", amount: "100" }],
    ["unknown type", { type: "free" }],
  ])("rejects %s", (_name, price) => {
    expect(indicativePriceSchema.safeParse(price).success).toBe(false);
  });

  it("counts fraction digits for per-currency precision checks", () => {
    expect(fractionDigits("450")).toBe(0);
    expect(fractionDigits("450.5")).toBe(1);
    expect(fractionDigits("1.234")).toBe(3);
  });
});

describe("offering requests", () => {
  const base = {
    category: "workshop",
    name: "Brake pad replacement",
    vehicleTypes: ["heavy_truck"],
    price: { type: "from", currency: "ZAR", amount: "1800", unit: "job" },
  };

  it("fills defaults: at the premises, every branch", () => {
    expect(offeringRequestSchema.parse(base)).toMatchObject({
      serviceLocation: "at_premises",
      branchIds: [],
      description: null,
      sortOrder: 0,
    });
  });

  it("requires vehicle compatibility and a known category", () => {
    expect(offeringRequestSchema.safeParse({ ...base, vehicleTypes: [] }).success).toBe(false);
    expect(offeringRequestSchema.safeParse({ ...base, category: "car_wash" }).success).toBe(false);
    expect(offeringRequestSchema.safeParse({ ...base, checkoutUrl: "https://x" }).success).toBe(
      false,
    );
  });
});
