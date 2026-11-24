import { describe, expect, it } from "vitest";

import { EMPTY_PRICE, priceFromDraft } from "./price";

describe("priceFromDraft", () => {
  it("accepts fixed, range and quote-required prices", () => {
    expect(priceFromDraft({ ...EMPTY_PRICE, amount: "450" })).toEqual({
      ok: true,
      price: { type: "fixed", currency: "ZAR", amount: "450", unit: "job" },
    });
    expect(priceFromDraft({ ...EMPTY_PRICE, type: "range", min: "100", max: "250.50" }).ok).toBe(
      true,
    );
    expect(priceFromDraft({ ...EMPTY_PRICE, type: "quote_required" })).toEqual({
      ok: true,
      price: { type: "quote_required" },
    });
  });

  it("explains problems in plain words", () => {
    const bad = (draft: Partial<typeof EMPTY_PRICE>) => {
      const result = priceFromDraft({ ...EMPTY_PRICE, ...draft });
      return result.ok ? "" : result.error;
    };
    expect(bad({ amount: "abc" })).toMatch(/amount/);
    expect(bad({ amount: "10", currency: "rand" })).toMatch(/Currency/);
    expect(bad({ type: "range", min: "300", max: "100" })).toMatch(/more than the minimum/);
  });
});
