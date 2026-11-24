import { z } from "zod";

import { safeText } from "./articles.js";
import { REPORT_REASONS, REPORT_TARGET_TYPES } from "./moderation.js";

/** Appeals use the same window as verification appeals (APPEAL_WINDOW_DAYS, Prompt 09). */
export { APPEAL_WINDOW_DAYS as MODERATION_APPEAL_WINDOW_DAYS } from "./verification.js";

/**
 * Power User status, member sanctions, appeals and the trust and safety dashboard (SRS F-160,
 * F-161, AB-12, ADR-0030). Power User is earned from verified identity, account age, meaningful
 * activity and moderation standing. It never depends on a plan, a payment or a rating: there is
 * no input for any of those (SRS §8.2 invariant 1).
 */

/** The rules, published so people can see what counts (SRS §8.2 invariant 4). */
export const POWER_USER_RULES = {
  /** An active `driver` verification badge: a reviewer checked identity evidence (Prompt 09). */
  identityBadge: "driver",
  minAccountAgeDays: 180,
  /** Activity in this window counts. */
  activityWindowDays: 365,
  /** Points: published articles 3 (max 10 counted), visible comments 1 (max 30), completed service requests 2 (max 10). */
  minActivityScore: 20,
  /** Different days with activity: one burst doesn't count as a habit. */
  minActiveDays: 10,
  /** At least this many different kinds of activity. */
  minActivityKinds: 2,
  /** No upheld moderation action or sanction in this window. */
  standingWindowDays: 180,
} as const;

export const POWER_USER_MEANING =
  "Earned through verified identity, account age, activity and good standing. Not a staff, moderator or professional endorsement, and it can't be bought.";

export const powerUserCriterionSchema = z.object({
  met: z.boolean(),
  detail: z.string(),
});

export const powerUserEligibilitySchema = z.object({
  eligible: z.boolean(),
  criteria: z.object({
    verifiedIdentity: powerUserCriterionSchema,
    accountAge: powerUserCriterionSchema.extend({ days: z.number().int() }),
    activity: powerUserCriterionSchema.extend({
      score: z.number().int(),
      activeDays: z.number().int(),
      kinds: z.number().int(),
      counts: z.object({
        publishedArticles: z.number().int(),
        visibleComments: z.number().int(),
        completedRequests: z.number().int(),
      }),
    }),
    standing: powerUserCriterionSchema.extend({ upheldActions: z.number().int() }),
  }),
});
export type PowerUserEligibility = z.infer<typeof powerUserEligibilitySchema>;

export const POWER_USER_STATUSES = ["none", "active", "revoked"] as const;

export const myPowerUserSchema = z.object({
  status: z.enum(POWER_USER_STATUSES),
  /** Shown publicly only while active and the identity badge is still valid. */
  shown: z.boolean(),
  since: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  revokeReason: z.string().nullable(),
  /** An open or decided appeal of the latest revocation. */
  appeal: z.object({ id: z.uuid(), status: z.enum(["open", "upheld", "overturned"]) }).nullable(),
  eligibility: powerUserEligibilitySchema,
  rules: z.custom<typeof POWER_USER_RULES>(),
  meaning: z.literal(POWER_USER_MEANING),
});
export type MyPowerUserDto = z.infer<typeof myPowerUserSchema>;

/** Public label for anyone (visitors included). */
export const userStatusSchema = z.object({
  userId: z.uuid(),
  powerUser: z.boolean(),
  since: z.iso.datetime().nullable(),
  meaning: z.literal(POWER_USER_MEANING),
});
export type UserStatusDto = z.infer<typeof userStatusSchema>;

// --- Sanctions --------------------------------------------------------------------------------

export const SANCTION_KINDS = ["warning", "suspension"] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];

export const sanctionRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("warning"),
      reason: safeText(1000, { min: 3, multiline: true }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("suspension"),
      reason: safeText(1000, { min: 3, multiline: true }),
      /** Null: until lifted. */
      days: z.number().int().min(1).max(365).nullable().default(null),
    })
    .strict(),
]);
export type SanctionRequest = z.input<typeof sanctionRequestSchema>;

export const sanctionSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  kind: z.enum(SANCTION_KINDS),
  reason: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  liftedAt: z.iso.datetime().nullable(),
  liftReason: z.string().nullable(),
  /** Overturned on appeal: doesn't count against standing. */
  overturned: z.boolean(),
  createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type SanctionDto = z.infer<typeof sanctionSchema>;

// --- Appeals ----------------------------------------------------------------------------------

export const APPEAL_KINDS = ["sanction", "power_user", "content"] as const;
export type AppealKind = (typeof APPEAL_KINDS)[number];
export const APPEAL_STATUSES = ["open", "upheld", "overturned"] as const;

export const moderationAppealRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("sanction"),
      sanctionId: z.uuid(),
      statement: safeText(2000, { min: 20, multiline: true }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("power_user"),
      statement: safeText(2000, { min: 20, multiline: true }),
    })
    .strict(),
  z
    .object({
      /** A moderator's reject or hide decision about your content. */
      kind: z.literal("content"),
      moderationActionId: z.uuid(),
      statement: safeText(2000, { min: 20, multiline: true }),
    })
    .strict(),
]);
export type ModerationAppealRequest = z.input<typeof moderationAppealRequestSchema>;

export const moderationAppealDecisionSchema = z
  .object({
    outcome: z.enum(["upheld", "overturned"]),
    reason: safeText(1000, { min: 3, multiline: true }),
  })
  .strict();

export const moderationAppealSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  kind: z.enum(APPEAL_KINDS),
  sanctionId: z.uuid().nullable(),
  moderationActionId: z.uuid().nullable(),
  /** For content appeals: what was decided about. */
  target: z.object({ type: z.enum(REPORT_TARGET_TYPES), id: z.uuid() }).nullable(),
  statement: z.string(),
  status: z.enum(APPEAL_STATUSES),
  decisionReason: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ModerationAppealDto = z.infer<typeof moderationAppealSchema>;

export const moderationAppealQuerySchema = z
  .object({
    status: z.enum(APPEAL_STATUSES).optional(),
    kind: z.enum(APPEAL_KINDS).optional(),
  })
  .strict();

// --- Dashboard and history --------------------------------------------------------------------

export const trustDashboardSchema = z.object({
  reports: z.object({
    open: z.number().int(),
    byTarget: z.array(
      z.object({ targetType: z.enum(REPORT_TARGET_TYPES), open: z.number().int() }),
    ),
    byReason: z.array(z.object({ reason: z.enum(REPORT_REASONS), open: z.number().int() })),
    /** Reports received per day, oldest first. */
    last14Days: z.array(z.object({ date: z.string(), count: z.number().int() })),
  }),
  pendingModeration: z.object({ articles: z.number().int(), jobs: z.number().int() }),
  appeals: z.object({
    open: z.number().int(),
    byKind: z.array(z.object({ kind: z.enum(APPEAL_KINDS), open: z.number().int() })),
    verificationOpen: z.number().int(),
  }),
  members: z.object({
    activeSuspensions: z.number().int(),
    warningsLast30Days: z.number().int(),
    powerUsers: z.number().int(),
    powerUserRevocationsLast30Days: z.number().int(),
  }),
  verification: z.object({ casesWaiting: z.number().int() }),
  emergency: z.object({ flaggedActive: z.number().int() }),
  recentActions: z.array(
    z.object({
      at: z.iso.datetime(),
      action: z.string(),
      targetType: z.string(),
      targetId: z.string().nullable(),
      actorId: z.uuid().nullable(),
    }),
  ),
});
export type TrustDashboardDto = z.infer<typeof trustDashboardSchema>;

export const memberHistorySchema = z.object({
  userId: z.uuid(),
  status: z.enum(["active", "suspended"]),
  powerUser: z.enum(POWER_USER_STATUSES),
  sanctions: z.array(sanctionSchema),
  appeals: z.array(moderationAppealSchema),
  /** Moderation decisions about this member's content. */
  contentActions: z.array(
    z.object({
      id: z.uuid(),
      targetType: z.enum(REPORT_TARGET_TYPES),
      targetId: z.uuid(),
      action: z.string(),
      reason: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  reportsAgainst: z.number().int(),
  /** From the append-only audit log. */
  audit: z.array(
    z.object({ at: z.iso.datetime(), action: z.string(), actorId: z.uuid().nullable() }),
  ),
});
export type MemberHistoryDto = z.infer<typeof memberHistorySchema>;

export const trustErrorReasonSchema = z.enum([
  "not_eligible",
  "already_power_user",
  "not_revocable",
  "own_account",
  "own_decision",
  "already_suspended",
  "not_appealable",
  "appeal_window_closed",
  "already_appealed",
  "invalid_transition",
]);
export type TrustErrorReason = z.infer<typeof trustErrorReasonSchema>;
