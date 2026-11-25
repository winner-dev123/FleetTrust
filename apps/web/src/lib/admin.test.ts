import { describe, expect, it } from "vitest";

import {
  adminSections,
  auditQueryFrom,
  EMPTY_AUDIT_FILTERS,
  isMfaRequiredError,
  needsMfa,
  sectionFor,
} from "./admin";

describe("admin console sections (least privilege)", () => {
  it("shows each role only its own sections, plus the shared ones", () => {
    const labels = (roles: Parameters<typeof adminSections>[0]) =>
      adminSections(roles).map((s) => s.label);
    expect(labels(["billing_operator"])).toEqual([
      "Overview",
      "Plans and quotas",
      "Audit log",
      "Two-step sign-in",
    ]);
    expect(labels(["super_admin"])).toEqual([
      "Overview",
      "Staff roles",
      "Feature settings",
      "Service categories",
      "Audit log",
      "Two-step sign-in",
    ]);
    expect(labels(["support_agent", "trust_safety_moderator"])).toContain("Moderation");
    expect(labels(["support_agent"])).not.toContain("Staff roles");
  });

  it("finds the section a deep page belongs to", () => {
    expect(sectionFor("/app/admin/support/abc")?.label).toBe("Support");
    expect(sectionFor("/app/admin/moderation/user/x")?.label).toBe("Moderation");
    expect(sectionFor("/app/admin")?.label).toBe("Overview");
  });

  it("knows when the sign-in still needs its second step", () => {
    const me = { userId: "u", email: null, roles: [] };
    expect(needsMfa({ ...me, mfa: { required: true, satisfied: false } })).toBe(true);
    expect(needsMfa({ ...me, mfa: { required: true, satisfied: true } })).toBe(false);
    expect(needsMfa({ ...me, mfa: { required: false, satisfied: false } })).toBe(false);
    expect(isMfaRequiredError({ code: "auth/multi-factor-auth-required" })).toBe(true);
    expect(isMfaRequiredError(new Error("x"))).toBe(false);
  });
});

describe("audit search form", () => {
  it("leaves out empty fields and covers whole UTC days", () => {
    expect(auditQueryFrom(EMPTY_AUDIT_FILTERS)).toEqual({ limit: 50 });
    expect(
      auditQueryFrom(
        {
          ...EMPTY_AUDIT_FILTERS,
          action: " verification. ",
          actorEmail: "A@Example.com",
          from: "2026-11-01",
          to: "2026-11-02",
        },
        "next",
      ),
    ).toEqual({
      limit: 50,
      action: "verification.",
      actorEmail: "a@example.com",
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-02T23:59:59.999Z",
      cursor: "next",
    });
  });
});
