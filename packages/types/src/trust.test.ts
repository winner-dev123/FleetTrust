import { describe, expect, it } from "vitest";

import {
  moderationAppealRequestSchema,
  POWER_USER_MEANING,
  POWER_USER_RULES,
  powerUserEligibilitySchema,
  sanctionRequestSchema,
} from "./trust.js";

describe("Power User rules", () => {
  it("are earned only: identity, age, activity, standing; nothing about plans or ratings", () => {
    expect(Object.keys(POWER_USER_RULES).sort()).toEqual([
      "activityWindowDays",
      "identityBadge",
      "minAccountAgeDays",
      "minActiveDays",
      "minActivityKinds",
      "minActivityScore",
      "standingWindowDays",
    ]);
    expect(Object.keys(powerUserEligibilitySchema.shape.criteria.shape).sort()).toEqual([
      "accountAge",
      "activity",
      "standing",
      "verifiedIdentity",
    ]);
    expect(JSON.stringify(POWER_USER_RULES)).not.toMatch(/plan|paid|rating|review|endorse/i);
    expect(POWER_USER_MEANING).toMatch(/can't be bought/);
  });
});

describe("sanctions and appeals", () => {
  it("validates suspensions and appeal statements", () => {
    expect(sanctionRequestSchema.parse({ kind: "suspension", reason: "Harassment" })).toEqual({
      kind: "suspension",
      reason: "Harassment",
      days: null,
    });
    expect(
      sanctionRequestSchema.safeParse({ kind: "warning", reason: "Spam", days: 3 }).success,
    ).toBe(false);
    expect(
      sanctionRequestSchema.safeParse({ kind: "suspension", reason: "x", days: 3 }).success,
    ).toBe(false);
    expect(
      moderationAppealRequestSchema.safeParse({
        kind: "power_user",
        statement: "Please look again",
      }).success,
    ).toBe(false);
    expect(
      moderationAppealRequestSchema.safeParse({
        kind: "content",
        moderationActionId: "01a20e21-a03d-76ac-a216-72c219084645",
        statement: "It is a how-to article, not an advert.",
      }).success,
    ).toBe(true);
  });
});
