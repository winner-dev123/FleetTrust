import { describe, expect, it } from "vitest";

import {
  answerPartInquirySchema,
  compatibilityEntrySchema,
  normalizePartNumber,
  partSearchQuerySchema,
  stockFreshness,
  stockLabel,
  stockRequestSchema,
} from "./parts.js";
import { createReferralSchema, referralConsentSchema, referralConsentText } from "./referrals.js";

const now = new Date("2027-05-20T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("stock freshness", () => {
  it("ages from fresh to aging, stale and expired", () => {
    expect(stockFreshness(daysAgo(0), now)).toBe("fresh");
    expect(stockFreshness(daysAgo(3), now)).toBe("fresh");
    expect(stockFreshness(daysAgo(3.1), now)).toBe("aging");
    expect(stockFreshness(daysAgo(14), now)).toBe("aging");
    expect(stockFreshness(daysAgo(15), now)).toBe("stale");
    expect(stockFreshness(daysAgo(90), now)).toBe("stale");
    expect(stockFreshness(daysAgo(91), now)).toBe("expired");
  });

  it("never shows stale stock as a plain status", () => {
    expect(stockLabel("in_stock", daysAgo(0.2), now)).toBe("In stock · confirmed today");
    expect(stockLabel("low_stock", daysAgo(1.5), now)).toBe("Low stock · confirmed yesterday");
    expect(stockLabel("out_of_stock", daysAgo(9), now)).toBe("Out of stock · confirmed 9 days ago");
    expect(stockLabel("in_stock", daysAgo(30), now)).toBe(
      "Stock not confirmed for 30 days (last reported: in stock). It may have changed: ask the provider.",
    );
  });
});

describe("parts schemas", () => {
  it("normalises part numbers for comparison", () => {
    expect(normalizePartNumber("0 986-494.104")).toBe("0986494104");
    expect(normalizePartNumber("a1/b2")).toBe("A1B2");
  });

  it("checks compatibility ranges, stock and answers", () => {
    expect(
      compatibilityEntrySchema.safeParse({ vehicleType: "heavy_truck", model: "Actros" }).success,
    ).toBe(false);
    expect(
      compatibilityEntrySchema.safeParse({
        vehicleType: "heavy_truck",
        yearFrom: 2020,
        yearTo: 2010,
      }).success,
    ).toBe(false);
    expect(stockRequestSchema.safeParse({ status: "on_order", quantity: 2 }).success).toBe(false);
    expect(stockRequestSchema.parse({ status: "low_stock", quantity: 1 })).toEqual({
      status: "low_stock",
      quantity: 1,
    });
    expect(
      answerPartInquirySchema.safeParse({ availability: "available", etaDays: 2 }).success,
    ).toBe(false);
    expect(
      answerPartInquirySchema.safeParse({ availability: "can_order", quantityAvailable: 2 })
        .success,
    ).toBe(false);
  });

  it("needs a vehicle type for make, model or year filters", () => {
    expect(partSearchQuerySchema.safeParse({ make: "Volvo" }).success).toBe(false);
    expect(partSearchQuerySchema.safeParse({ vehicleType: "car", model: "Polo" }).success).toBe(
      false,
    );
    expect(
      partSearchQuerySchema.safeParse({
        vehicleType: "car",
        make: "VW",
        model: "Polo",
        year: "2019",
      }).success,
    ).toBe(true);
  });
});

describe("referral schemas", () => {
  const base = { toProvider: "Gearbox-Pros", message: "They rebuild gearboxes." };

  it("requires a described relationship, and only when there is one", () => {
    expect(createReferralSchema.safeParse({ ...base, relationship: "referral_fee" }).success).toBe(
      false,
    );
    expect(
      createReferralSchema.safeParse({
        ...base,
        relationship: "none",
        relationshipDetails: "Friends",
      }).success,
    ).toBe(false);
    expect(
      createReferralSchema.parse({
        ...base,
        relationship: "referral_fee",
        relationshipDetails: "5% of the invoice",
      }).toProvider,
    ).toBe("gearbox-pros");
  });

  it("never implies consent and spells out what is shared", () => {
    expect(referralConsentSchema.safeParse({}).success).toBe(false);
    expect(referralConsentSchema.safeParse({ consent: false }).success).toBe(false);
    expect(referralConsentSchema.parse({ consent: true })).toEqual({
      consent: true,
      sharePhotos: false,
      shareOutcomeWithReferrer: false,
    });
    const text = referralConsentText({
      toName: "Gearbox Pros",
      sharePhotos: false,
      shareOutcomeWithReferrer: false,
    });
    expect(text).toContain("I agree to send my service request to Gearbox Pros.");
    expect(text).toContain("They will not see my photos.");
    expect(text).toContain("The referring provider will not see what happens next.");
  });
});
