import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { moderationActions } from "./articles.js";
import { id, timestamps } from "./columns.js";
import { users } from "./users.js";

export const SANCTION_KIND_VALUES = ["warning", "suspension"] as const;
export const APPEAL_KIND_VALUES = ["sanction", "power_user", "content"] as const;
export const APPEAL_STATUS_VALUES = ["open", "upheld", "overturned"] as const;

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

/**
 * Power User status (F-160, ADR-0030). Earned when the eligibility rules pass; there is no
 * column for a plan, a payment, an endorsement or a rating. `criteria` keeps what was met at
 * the grant, for audit.
 */
export const powerUserStatus = pgTable(
  "power_user_status",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "revoked"] }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull(),
    criteria: jsonb("criteria").$type<Record<string, unknown>>().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
    revokeReason: text("revoke_reason"),
    ...timestamps(),
  },
  (t) => [
    index("power_user_status_active_idx")
      .on(t.grantedAt)
      .where(sql`${t.status} = 'active'`),
    check("power_user_status_valid", sql`${t.status} IN ('active', 'revoked')`),
    check(
      "power_user_status_revoked_consistent",
      sql`(${t.status} = 'revoked') = (${t.revokedAt} IS NOT NULL AND ${t.revokeReason} IS NOT NULL AND char_length(${t.revokeReason}) >= 3)`,
    ),
  ],
);

/** Warnings and suspensions by trust and safety moderators. Kept for history; never deleted. */
export const memberSanctions = pgTable(
  "member_sanctions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SANCTION_KIND_VALUES }).notNull(),
    reason: text("reason").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    /** Suspensions only; null = until lifted. */
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    liftedAt: timestamp("lifted_at", { withTimezone: true, mode: "date" }),
    liftedBy: uuid("lifted_by").references(() => users.id, { onDelete: "set null" }),
    liftReason: text("lift_reason"),
    /** Overturned on appeal: doesn't count against standing. */
    overturned: boolean("overturned").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("member_sanctions_user_idx").on(t.userId, t.createdAt.desc()),
    index("member_sanctions_active_idx")
      .on(t.userId)
      .where(sql`${t.kind} = 'suspension' AND ${t.liftedAt} IS NULL`),
    check("member_sanctions_kind_valid", sql`${t.kind} IN (${list(SANCTION_KIND_VALUES)})`),
    check("member_sanctions_reason_length", sql`char_length(${t.reason}) BETWEEN 3 AND 1000`),
    check(
      "member_sanctions_shape",
      sql`(${t.kind} = 'warning' AND ${t.endsAt} IS NULL AND ${t.liftedAt} IS NULL)
       OR (${t.kind} = 'suspension' AND (${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}))`,
    ),
  ],
);

/**
 * Appeals of moderator decisions: a sanction, a Power User revocation, or a decision about your
 * content (reject or hide). One appeal per decision.
 */
export const moderationAppeals = pgTable(
  "moderation_appeals",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: APPEAL_KIND_VALUES }).notNull(),
    sanctionId: uuid("sanction_id").references(() => memberSanctions.id, { onDelete: "cascade" }),
    moderationActionId: uuid("moderation_action_id").references(() => moderationActions.id, {
      onDelete: "restrict",
    }),
    /** Which revocation a Power User appeal is about. */
    powerUserRevokedAt: timestamp("power_user_revoked_at", { withTimezone: true, mode: "date" }),
    statement: text("statement").notNull(),
    status: text("status", { enum: APPEAL_STATUS_VALUES }).notNull().default("open"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decisionReason: text("decision_reason"),
    ...timestamps(),
  },
  (t) => [
    index("moderation_appeals_user_idx").on(t.userId, t.createdAt.desc()),
    index("moderation_appeals_queue_idx").on(t.status, t.createdAt),
    uniqueIndex("moderation_appeals_sanction_key").on(t.sanctionId),
    uniqueIndex("moderation_appeals_action_key").on(t.moderationActionId),
    uniqueIndex("moderation_appeals_power_user_key").on(t.userId, t.powerUserRevokedAt),
    check("moderation_appeals_kind_valid", sql`${t.kind} IN (${list(APPEAL_KIND_VALUES)})`),
    check("moderation_appeals_status_valid", sql`${t.status} IN (${list(APPEAL_STATUS_VALUES)})`),
    check(
      "moderation_appeals_target",
      sql`(${t.kind} = 'sanction' AND ${t.sanctionId} IS NOT NULL AND ${t.moderationActionId} IS NULL AND ${t.powerUserRevokedAt} IS NULL)
       OR (${t.kind} = 'content' AND ${t.moderationActionId} IS NOT NULL AND ${t.sanctionId} IS NULL AND ${t.powerUserRevokedAt} IS NULL)
       OR (${t.kind} = 'power_user' AND ${t.powerUserRevokedAt} IS NOT NULL AND ${t.sanctionId} IS NULL AND ${t.moderationActionId} IS NULL)`,
    ),
    check(
      "moderation_appeals_decision",
      sql`(${t.status} = 'open') = (${t.decidedAt} IS NULL)
       AND (${t.status} = 'open' OR (${t.decisionReason} IS NOT NULL AND char_length(${t.decisionReason}) >= 3))`,
    ),
    check(
      "moderation_appeals_statement_length",
      sql`char_length(${t.statement}) BETWEEN 20 AND 2000`,
    ),
  ],
);

export type PowerUserStatus = typeof powerUserStatus.$inferSelect;
export type MemberSanction = typeof memberSanctions.$inferSelect;
export type ModerationAppeal = typeof moderationAppeals.$inferSelect;
