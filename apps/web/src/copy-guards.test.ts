import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { FORBIDDEN_EMERGENCY_WORDING } from "@fleettrust/types";
import { describe, expect, it } from "vitest";

/** Every source file of the web app (tests excluded). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const root = join(import.meta.dirname);
const files = sourceFiles(root).map((path) => ({
  path: relative(root, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

describe("product copy guards", () => {
  it("scans the app", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("emergency screens never imply that help is certain (SRS J3, ADR-0010)", () => {
    const emergency = files.filter((file) => file.path.includes("emergency"));
    expect(emergency.length).toBeGreaterThanOrEqual(3);
    for (const file of emergency) {
      expect(FORBIDDEN_EMERGENCY_WORDING.test(file.text), file.path).toBe(false);
    }
  });

  it("no screen offers checkout, card payment or verified payments (ADR-0008, FR-07)", () => {
    const forbidden =
      /\b(?:checkout|add to cart|pay now|buy now|card number|payment (?:verified|confirmed|successful)|escrow)\b/i;
    for (const file of files) {
      expect(forbidden.test(file.text), file.path).toBe(false);
    }
  });

  it("scrollable table boxes are keyboard-reachable and named (WCAG 2.1.1, axe scrollable-region-focusable)", () => {
    // Whether a table overflows depends on fonts and screen width, so the browser checks can
    // miss it on one machine; every table box must be focusable regardless.
    const boxes = files.flatMap((file) =>
      [...file.text.matchAll(/<div\s+className="table-wrap"([^>]*)>/g)].map((match) => ({
        path: file.path,
        attributes: match[1] ?? "",
      })),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(6);
    for (const box of boxes) {
      expect(box.attributes, box.path).toMatch(
        // The name is a literal or comes from the text catalog (@fleettrust/copy).
        /tabIndex=\{0\}\s+role="region"\s+aria-label=(?:"[^"]+"|\{[^}]+\})/,
      );
    }
  });

  it("no screen shows star ratings or review scores (ADR-0011)", () => {
    const forbidden = /★|☆|\b(?:star rating|rate this provider|leave a review|average rating)\b/i;
    for (const file of files) {
      expect(forbidden.test(file.text), file.path).toBe(false);
    }
  });
});
