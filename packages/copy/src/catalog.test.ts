import { FORBIDDEN_EMERGENCY_WORDING } from "@fleettrust/types";
import { describe, expect, it } from "vitest";

import { en } from "./en.js";
import { fill, plural } from "./fill.js";

/** Every message in the catalog with its dotted key, plural forms included. */
function messages(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) =>
      messages(value, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

const all = messages(en);

describe("catalog text", () => {
  it("holds the product text", () => {
    expect(all.length).toBeGreaterThan(250);
  });

  it("has no empty, padded or double-spaced messages", () => {
    const bad = all.filter(
      ([, text]) => text === "" || text !== text.trim() || text.includes("  "),
    );
    expect(bad).toEqual([]);
  });

  it("uses only well-formed {placeholders}", () => {
    const bad = all.filter(([, text]) => {
      const stripped = text.replace(/\{[a-zA-Z][a-zA-Z0-9]*\}/g, "");
      return /[{}]/.test(stripped);
    });
    expect(bad).toEqual([]);
  });

  it("gives every plural both forms with {count}", () => {
    const plurals = all.filter(([key]) => /\.(one|other)$/.test(key));
    expect(plurals.length).toBeGreaterThan(0);
    expect(plurals.filter(([, text]) => !text.includes("{count}"))).toEqual([]);
  });
});

describe("product rules (the same as the screen guards)", () => {
  it("emergency text never implies that help is certain (SRS J3, ADR-0010)", () => {
    const emergency = all.filter(([key]) =>
      /^(web\.)?(app\.)?(emergency|incident|trustedContacts|tabs)\./.test(key),
    );
    expect(emergency.length).toBeGreaterThan(50);
    expect(emergency.filter(([, text]) => FORBIDDEN_EMERGENCY_WORDING.test(text))).toEqual([]);
  });

  it("offers no checkout, card payment or verified payments (ADR-0008)", () => {
    const forbidden =
      /\b(?:checkout|add to cart|pay now|buy now|card number|payment (?:verified|confirmed|successful)|escrow)\b/i;
    expect(all.filter(([, text]) => forbidden.test(text))).toEqual([]);
  });

  it("shows no star ratings or review scores (ADR-0011)", () => {
    const forbidden = /★|☆|\b(?:star rating|rate this provider|leave a review|average rating)\b/i;
    expect(all.filter(([, text]) => forbidden.test(text))).toEqual([]);
  });
});

describe("fill and plural", () => {
  it("fills every placeholder", () => {
    expect(fill(en.find.resultTitle, { number: 2, name: "Acme" })).toBe("2. Acme");
  });

  it("refuses a missing or an unused value, so typos fail in tests", () => {
    expect(() => fill(en.find.resultTitle, { number: 2 })).toThrow(/missing value for \{name\}/);
    expect(() => fill(en.find.resultTitle, { number: 2, name: "A", extra: 1 })).toThrow(
      /unused value/,
    );
  });

  it("picks the English plural form", () => {
    expect(plural(1, en.find.resultCount)).toBe("1 result");
    expect(plural(0, en.find.resultCount)).toBe("0 results");
    expect(plural(3, en.emergency.alertsGoTo, { names: "A, B, C" })).toBe(
      "Alerts go to 3 trusted contacts: A, B, C.",
    );
  });
});
