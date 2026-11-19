import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { id } from "./columns.js";

export const ACTOR_TYPES = ["user", "admin", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/**
 * Append-only audit trail (SRS FR-09). UPDATE and DELETE are rejected by a database trigger,
 * so even a compromised application role cannot rewrite history. Retention and archival
 * are decided with the launch jurisdiction (OQ-03).
 *
 * Never store secrets, tokens, document contents or full message bodies in `metadata`.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    actorType: text("actor_type", { enum: ACTOR_TYPES }).notNull(),
    /** Internal users.id (never a Firebase UID). Null for system actions. FK added with users (Prompt 06). */
    actorId: uuid("actor_id"),
    /** Tenant the action happened in, if any. FK added with organizations (Prompt 07). */
    organizationId: uuid("organization_id"),
    /** Dotted verb, e.g. `verification.badge_granted`, `plan.assigned`. */
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    /** Correlates with structured logs and traces (Prompt 05). */
    requestId: text("request_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    // Drizzle's text enum is TypeScript-only; enforce the allowed values in the database too.
    check(
      "audit_events_actor_type_valid",
      sql`${t.actorType} IN (${sql.raw(ACTOR_TYPES.map((v) => `'${v}'`).join(", "))})`,
    ),
    check(
      "audit_events_action_format",
      sql`${t.action} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'`,
    ),
    check("audit_events_actor_present", sql`${t.actorType} = 'system' OR ${t.actorId} IS NOT NULL`),
    index("audit_events_org_time_idx").on(t.organizationId, t.occurredAt.desc()),
    index("audit_events_actor_time_idx").on(t.actorId, t.occurredAt.desc()),
    index("audit_events_target_idx").on(t.targetType, t.targetId),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
