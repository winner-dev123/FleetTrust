import { describe, expect, it } from "vitest";

import {
  createServiceRequestSchema,
  evidenceSchema,
  PAYMENT_DISCLAIMER,
  QUOTE_SCAM_WARNING,
  submitQuoteSchema,
} from "./requests.js";

const base = {
  clientRequestId: "0196f2a8-0000-7000-8000-000000000001",
  category: "towing",
  vehicle: { vehicleType: "heavy_truck", registration: " ca 123-456 " },
  location: { lng: 18.4, lat: -33.9 },
  description: "Truck won't start at the depot.",
  target: { mode: "match" },
};

describe("service request schemas", () => {
  it("fills defaults and normalises the registration", () => {
    expect(createServiceRequestSchema.parse(base)).toMatchObject({
      urgency: "routine",
      photoIds: [],
      fleetBranchId: null,
      locationNote: null,
      target: { mode: "match", radiusKm: 25 },
      vehicle: { registration: "CA 123-456", make: null },
    });
  });

  it("rejects unknown fields, including anything payment-like", () => {
    expect(createServiceRequestSchema.safeParse({ ...base, depositAmount: "100" }).success).toBe(
      false,
    );
    expect(
      submitQuoteSchema.safeParse({
        price: { type: "quote_required" },
        paymentLink: "https://pay.example",
      }).success,
    ).toBe(false);
  });

  it("quotes use indicative price types and a bounded validity", () => {
    expect(submitQuoteSchema.parse({ price: { type: "quote_required" } })).toMatchObject({
      validDays: 7,
      message: null,
    });
    expect(
      submitQuoteSchema.safeParse({ price: { type: "quote_required" }, validDays: 60 }).success,
    ).toBe(false);
  });

  it("evidence needs a note or a photo", () => {
    expect(evidenceSchema.safeParse({}).success).toBe(false);
    expect(evidenceSchema.safeParse({ note: "Pads worn to the metal" }).success).toBe(true);
  });

  it("the disclaimers say payment happens outside FleetTrust", () => {
    expect(PAYMENT_DISCLAIMER).toBe(
      "Payment is arranged directly with the provider. FleetTrust doesn't process or verify payments.",
    );
    expect(QUOTE_SCAM_WARNING).toMatch(/Never pay a deposit/);
  });
});
