import type { Executor } from "./database.js";
import { type AuditEvent, auditEvents, type NewAuditEvent } from "./schema/audit-events.js";
import { type NewOutboxEvent, type OutboxEvent, outboxEvents } from "./schema/outbox-events.js";

export type AuditEventInput = Omit<NewAuditEvent, "id" | "occurredAt">;
export type OutboxEventInput = Pick<
  NewOutboxEvent,
  "aggregateType" | "aggregateId" | "eventType" | "payload" | "availableAt"
>;

/**
 * Appends an audit event. Pass the surrounding transaction so the audit row commits or
 * rolls back together with the change it describes.
 */
export async function recordAuditEvent(
  executor: Executor,
  event: AuditEventInput,
): Promise<AuditEvent> {
  const [row] = await executor.insert(auditEvents).values(event).returning();
  if (!row) throw new Error("audit event insert returned no row");
  return row;
}

/** Enqueues a domain event in the same transaction as the change (transactional outbox). */
export async function enqueueOutboxEvent(
  executor: Executor,
  event: OutboxEventInput,
): Promise<OutboxEvent> {
  const [row] = await executor.insert(outboxEvents).values(event).returning();
  if (!row) throw new Error("outbox insert returned no row");
  return row;
}
