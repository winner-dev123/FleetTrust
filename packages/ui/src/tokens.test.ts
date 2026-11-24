import { describe, expect, it } from "vitest";

import { breakpoints, type ColorScheme, colors, contrastRatio, touchTarget } from "./index.js";

/** WCAG 2.2 AA: 4.5:1 for normal text, 3:1 for user-interface components and focus. */
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

const textPairs = [
  ["text", "background"],
  ["text", "surface"],
  ["textMuted", "background"],
  ["textMuted", "surface"],
  ["onPrimary", "primary"],
  ["onDanger", "danger"],
  ["verified", "background"],
  ["caution", "background"],
  ["primary", "background"],
  ["danger", "background"],
] as const;

const nonTextPairs = [
  ["borderStrong", "background"],
  ["borderStrong", "surface"],
  ["focus", "background"],
  ["focus", "surface"],
  ["primary", "surface"],
  ["danger", "surface"],
] as const;

describe("contrastRatio", () => {
  it("matches known reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("rejects malformed colours", () => {
    expect(() => contrastRatio("red", "#ffffff")).toThrow(/#rrggbb/);
  });
});

describe.each<ColorScheme>(["light", "dark"])("%s colour tokens", (scheme) => {
  it.each(textPairs)("%s on %s meets WCAG AA for text", (fg, bg) => {
    const palette = colors[scheme];
    expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe.each<ColorScheme>(["light", "dark"])("%s non-text colour tokens", (scheme) => {
  it.each(nonTextPairs)("%s on %s meets WCAG AA for controls and focus", (fg, bg) => {
    const palette = colors[scheme];
    expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe("layout tokens", () => {
  it("breakpoints grow and touch targets exceed WCAG 2.5.8", () => {
    const values = Object.values(breakpoints);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(touchTarget).toBeGreaterThanOrEqual(24);
  });
});
