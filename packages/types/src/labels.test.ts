import { describe, expect, it } from "vitest";

import { openingStatusLabel, verificationLabel } from "./labels.js";

const base = {
  known: true,
  isOpen: false,
  localTime: "2027-03-01T10:00",
  closesAt: null,
  opensAt: null,
  exception: null,
};

describe("openingStatusLabel", () => {
  it("never says closed when hours are unknown", () => {
    expect(openingStatusLabel({ ...base, known: false })).toBe("Hours not provided");
  });

  it("describes open, 24-hour and closed states", () => {
    expect(openingStatusLabel({ ...base, isOpen: true, closesAt: "2027-03-01T17:00" })).toBe(
      "Open until 17:00",
    );
    expect(openingStatusLabel({ ...base, isOpen: true })).toBe("Open 24 hours");
    expect(openingStatusLabel({ ...base, opensAt: "2027-03-01T14:00" })).toBe(
      "Closed (opens 14:00)",
    );
    expect(openingStatusLabel({ ...base, opensAt: "2027-03-02T08:00" })).toBe(
      "Closed (opens Tue 08:00)",
    );
    expect(openingStatusLabel({ ...base, exception: "Public holiday" })).toBe(
      "Closed · Public holiday",
    );
  });
});

describe("verificationLabel", () => {
  it("states what was checked, in words", () => {
    expect(verificationLabel("business", "verified")).toBe("Business registration: verified");
    expect(verificationLabel("location", "unverified")).toBe("Business location: not verified");
  });
});
