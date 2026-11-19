import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { id } from "./columns.js";

/**
 * Transactional outbox (ADR-0002, ADR-0007). Domain changes and their events are written in
 * the same transaction; a relay publishes unpublished rows to Cloud Tasks / Pub/Sub and sets
 * `published_at`. Consumers must be idempotent (at-least-once delivery), keyed by `id`.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    /** e.g. `service_request`, `emergency_incident`. */
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    /** PascalCase event name, e.g. `IncidentRaised`. */
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** Earliest publish time; lets the relay back off after failures. */
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    check("outbox_events_event_type_format", sql`${t.eventType} ~ '^[A-Z][A-Za-z0-9]+$'`),
    check("outbox_events_attempts_non_negative", sql`${t.attempts} >= 0`),
    // The relay only ever scans unpublished rows, so keep that index small.
    index("outbox_events_unpublished_idx")
      .on(t.availableAt)
      .where(sql`${t.publishedAt} IS NULL`),
    index("outbox_events_aggregate_idx").on(t.aggregateType, t.aggregateId, t.occurredAt),
  ],
);

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
