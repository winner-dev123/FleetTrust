import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { enqueueOutboxEvent, recordAuditEvent } from "../src/events.js";
import { auditEvents, outboxEvents } from "../src/schema/index.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

const admin = "0190f4a6-1c2b-7d3e-8f40-123456789abc";

/** Drizzle wraps driver errors ("Failed query: …"); the Postgres message is on `cause`. */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : (error as Error).message;
  }
  throw new Error("expected the database to reject the statement");
}

describe("audit_events", () => {
  it("records events with a time-ordered UUIDv7 id", async () => {
    const first = await recordAuditEvent(t.db, {
      actorType: "admin",
      actorId: admin,
      action: "plan.assigned",
      targetType: "organization",
      targetId: "org-1",
      metadata: { planVersion: "pro-v1", externalReference: "INV-1001" },
    });
    const second = await recordAuditEvent(t.db, {
      actorType: "system",
      action: "badge.expired",
      targetType: "badge",
    });

    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second.id > first.id).toBe(true);
    expect(first.metadata).toEqual({ planVersion: "pro-v1", externalReference: "INV-1001" });
  });

  it("is append-only: UPDATE, DELETE and TRUNCATE are rejected by the database", async () => {
    const event = await recordAuditEvent(t.db, {
      actorType: "system",
      action: "test.created",
      targetType: "test",
    });

    expect(
      await dbError(
        t.db
          .update(auditEvents)
          .set({ action: "test.tampered" })
          .where(eq(auditEvents.id, event.id)),
      ),
    ).toMatch(/UPDATE on audit_events is not allowed: table is append-only/);
    expect(await dbError(t.db.delete(auditEvents).where(eq(auditEvents.id, event.id)))).toMatch(
      /DELETE on audit_events is not allowed/,
    );
    expect(await dbError(t.client.exec("TRUNCATE audit_events"))).toMatch(
      /TRUNCATE on audit_events is not allowed/,
    );

    const [stillThere] = await t.db.select().from(auditEvents).where(eq(auditEvents.id, event.id));
    expect(stillThere?.action).toBe("test.created");
  });

  it("requires an actor id unless the actor is the system", async () => {
    expect(
      await dbError(
        recordAuditEvent(t.db, {
          actorType: "admin",
          action: "plan.assigned",
          targetType: "organization",
        }),
      ),
    ).toMatch(/audit_events_actor_present/);
  });

  it("rejects unknown actor types and malformed action names", async () => {
    expect(
      await dbError(
        t.client.query(
          "INSERT INTO audit_events (actor_type, actor_id, action, target_type) VALUES ('robot', $1, 'a.b', 'x')",
          [admin],
        ),
      ),
    ).toMatch(/audit_events_actor_type_valid/);
    expect(
      await dbError(
        recordAuditEvent(t.db, { actorType: "system", action: "NoDotsAllowed", targetType: "x" }),
      ),
    ).toMatch(/audit_events_action_format/);
  });
});

describe("outbox_events", () => {
  it("commits the event with the change, and rolls it back with the change", async () => {
    await t.db.transaction(async (tx) => {
      await enqueueOutboxEvent(tx, {
        aggregateType: "test",
        aggregateId: "committed",
        eventType: "TestHappened",
        payload: { ok: true },
      });
    });

    await expect(
      t.db.transaction(async (tx) => {
        await enqueueOutboxEvent(tx, {
          aggregateType: "test",
          aggregateId: "rolled-back",
          eventType: "TestHappened",
          payload: {},
        });
        throw new Error("domain change failed");
      }),
    ).rejects.toThrow("domain change failed");

    const rows = await t.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateType, "test"));
    expect(rows.map((row) => row.aggregateId)).toEqual(["committed"]);
    expect(rows[0]).toMatchObject({ publishedAt: null, attempts: 0 });
  });

  it("rejects event types that are not PascalCase", async () => {
    expect(
      await dbError(
        enqueueOutboxEvent(t.db, {
          aggregateType: "x",
          aggregateId: "1",
          eventType: "test_happened",
          payload: {},
        }),
      ),
    ).toMatch(/outbox_events_event_type_format/);
  });
});
