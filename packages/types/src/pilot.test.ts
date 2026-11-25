import { describe, expect, it } from "vitest";

import { isOnPilotAllowlist, parsePilotAllowlist, pilotAllowlistSchema } from "./admin.js";

describe("pilot allowlist", () => {
  it("reads one entry per line or comma, trimmed and lower-cased; empty means open", () => {
    expect(parsePilotAllowlist(null)).toEqual([]);
    expect(parsePilotAllowlist("  \n ")).toEqual([]);
    expect(parsePilotAllowlist(" Jane@Example.com \n@Acme.co.za, bob@x.io")).toEqual([
      "jane@example.com",
      "@acme.co.za",
      "bob@x.io",
    ]);
  });

  it("matches a full address exactly, or every address at a listed domain", () => {
    const list = parsePilotAllowlist("jane@example.com\n@acme.co.za");
    expect(isOnPilotAllowlist("JANE@example.com", list)).toBe(true);
    expect(isOnPilotAllowlist("anyone@acme.co.za", list)).toBe(true);
    expect(isOnPilotAllowlist("john@example.com", list)).toBe(false);
    // Lookalike domains don't match.
    expect(isOnPilotAllowlist("x@evil-acme.co.za", list)).toBe(false);
    expect(isOnPilotAllowlist("x@acme.co.za.evil.io", list)).toBe(false);
    expect(isOnPilotAllowlist(null, list)).toBe(false);
  });

  it("accepts addresses and domains, and rejects anything else", () => {
    expect(pilotAllowlistSchema.safeParse("jane@example.com\n@acme.co.za").success).toBe(true);
    expect(pilotAllowlistSchema.safeParse("acme.co.za").success).toBe(false);
    expect(pilotAllowlistSchema.safeParse("jane @example.com").success).toBe(false);
    expect(pilotAllowlistSchema.safeParse("@localhost").success).toBe(false);
    expect(pilotAllowlistSchema.safeParse("x".repeat(4_001)).success).toBe(false);
  });
});
