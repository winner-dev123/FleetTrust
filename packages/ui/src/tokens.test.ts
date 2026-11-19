import { describe, expect, it } from "vitest";

import { type ColorScheme, colors, contrastRatio } from "./index.js";

/** WCAG 2.2 AA: 4.5:1 for normal text. */
const AA_TEXT = 4.5;

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
