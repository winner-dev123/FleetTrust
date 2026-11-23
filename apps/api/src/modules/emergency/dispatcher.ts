import {
  and,
  asc,
  type Database,
  emergencyIncidents,
  eq,
  type Executor,
  type IncidentDelivery,
  incidentDeliveries,
  incidentRecipients,
  inArray,
  isNull,
  lte,
  pushDevices,
  queryRows,
  recordAuditEvent,
  sql,
  trustedContacts,
  users,
} from "@fleettrust/db";
import { EMERGENCY_DISCLAIMER, INCIDENT_CATEGORY_LABELS } from "@fleettrust/types";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";

import { API_ENV } from "../../config/config.module.js";
import type { ApiEnv } from "../../config/env.js";
import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { EMAIL_SENDER, type EmailSender } from "../../platform/email/index.js";
import { PUSH_SENDER, type PushSender } from "../../platform/push/index.js";

const MAX_ATTEMPTS = 5;
const MAX_WAVES = 3;
/** A claimed delivery is retried after this long if the process dies mid-send. */
const LEASE_MS = 60_000;
const FALLBACK_NAME = "A FleetTrust member";

/** 5 s, 15 s, 45 s, 135 s: quick at first, without hammering a failing provider. */
export const backoffMs = (attempt: number) => 5_000 * 3 ** Math.max(0, attempt - 1);

type Purpose = IncidentDelivery["purpose"];

/**
 * Emergency delivery queue (F-062, ADR-0007, ADR-0025): separate from the notification outbox
 * so ordinary traffic can't delay it, and never checked against plans or quotas (ADR-0010).
 * - The first push is attempted inline when the incident is created.
 * - Failed sends retry with backoff; after the last attempt, email takes over.
 * - Contacts who don't acknowledge a push within the fallback window are emailed.
 * - If nobody acknowledges, the next wave alerts backup contacts (or reminds everyone).
 * - Incidents expire automatically and their location is erased.
 * Retries are idempotent: each delivery row is claimed with a lease and sent at most once per
 * attempt; at-least-once delivery is accepted for safety.
 */
@Injectable()
export class EmergencyDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("EmergencyDispatcher");
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE !== "worker" || this.database === null) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.tick()
        .catch((error: unknown) => {
          // Dispatch failures page the on-call (log-based alert, docs/operations).
          this.logger.error(`emergency tick failed: ${(error as Error).message}`);
        })
        .finally(() => {
          this.running = null;
        });
    }, this.env.EMERGENCY_TICK_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** One pass: expiry, escalation, email fallback, then every due delivery. */
  async tick(): Promise<{ sent: number; failed: number }> {
    await this.expire();
    await this.escalate();
    await this.emailFallback();
    return this.deliverDue();
  }

  // -------------------------------------------------------------------------------------------
  // Queueing
  // -------------------------------------------------------------------------------------------

  /** Queues a push to each user of a recipient (contacts: one person; providers: their team). */
  async enqueue(
    executor: Executor,
    incidentId: string,
    recipientId: string,
    userIds: readonly string[],
    purpose: Purpose,
    wave: number,
    channel: "push" | "email" = "push",
  ): Promise<void> {
    if (userIds.length === 0) return;
    await executor
      .insert(incidentDeliveries)
      .values(
        userIds.map((userId) => ({
          incidentId,
          recipientId,
          userId,
          channel,
          purpose,
          wave,
          nextAttemptAt: this.clock.now(),
        })),
      )
      .onConflictDoNothing();
  }

  // -------------------------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------------------------

  /** Sends every due delivery (optionally for one incident). */
  async deliverDue(incidentId?: string): Promise<{ sent: number; failed: number }> {
    const due = await this.db
      .select({ id: incidentDeliveries.id })
      .from(incidentDeliveries)
      .where(
        and(
          eq(incidentDeliveries.status, "pending"),
          lte(incidentDeliveries.nextAttemptAt, this.clock.now()),
          incidentId === undefined ? undefined : eq(incidentDeliveries.incidentId, incidentId),
        ),
      )
      .orderBy(asc(incidentDeliveries.nextAttemptAt))
      .limit(500);
    let sent = 0;
    let failed = 0;
    for (const { id } of due) {
      const outcome = await this.attempt(id);
      if (outcome === "sent") sent += 1;
      if (outcome === "retry" || outcome === "failed") failed += 1;
    }
    return { sent, failed };
  }

  private async attempt(id: string): Promise<"sent" | "retry" | "failed" | "skipped" | "busy"> {
    const now = this.clock.now();
    // Claim with a lease so another worker (or a crash) can't send it twice at once.
    const claimed = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(incidentDeliveries)
        .where(
          and(
            eq(incidentDeliveries.id, id),
            eq(incidentDeliveries.status, "pending"),
            lte(incidentDeliveries.nextAttemptAt, now),
          ),
        )
        .for("update", { skipLocked: true });
      if (!row) return null;
      const [incident] = await tx
        .select()
        .from(emergencyIncidents)
        .where(eq(emergencyIncidents.id, row.incidentId));
      const closingNotice = row.purpose === "closed";
      if (!incident || (incident.status !== "active" && !closingNotice)) {
        await tx
          .update(incidentDeliveries)
          .set({ status: "skipped", lastError: "incident closed" })
          .where(eq(incidentDeliveries.id, row.id));
        return { row, incident: null };
      }
      await tx
        .update(incidentDeliveries)
        .set({ attempts: row.attempts + 1, nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
        .where(eq(incidentDeliveries.id, row.id));
      return { row: { ...row, attempts: row.attempts + 1 }, incident };
    });
    if (!claimed) return "busy";
    const { row, incident } = claimed;
    if (!incident) return "skipped";

    const message = await this.message(row, incident);
    try {
      if (row.channel === "push") {
        const devices = await this.db
          .select({ fid: pushDevices.fid })
          .from(pushDevices)
          .where(eq(pushDevices.userId, row.userId));
        if (devices.length === 0) {
          await this.finish(row, "skipped", "no push devices");
          if (row.purpose === "alert" || row.purpose === "reminder") {
            await this.enqueue(
              this.db,
              row.incidentId,
              row.recipientId,
              [row.userId],
              row.purpose,
              row.wave,
              "email",
            );
          }
          return "skipped";
        }
        const result = await this.push.send(
          devices.map((d) => d.fid),
          {
            title: message.title,
            body: message.body,
            data: { type: "emergency", incidentId: row.incidentId },
          },
        );
        if (result.invalid.length > 0) {
          await this.db.delete(pushDevices).where(inArray(pushDevices.fid, result.invalid));
        }
        if (result.sent === 0) throw new Error("no device accepted the push");
      } else {
        const [user] = await this.db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, row.userId));
        if (!user?.email) {
          await this.finish(row, "skipped", "no email address");
          return "skipped";
        }
        await this.email.send({
          to: user.email,
          subject: message.title,
          text: `${message.body}\n\n${EMERGENCY_DISCLAIMER}\n\nOpen FleetTrust to see the alert (reference ${row.incidentId}).`,
        });
      }
      await this.finish(row, "sent", null);
      return "sent";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (row.attempts >= MAX_ATTEMPTS) {
        await this.finish(row, "failed", reason);
        this.logger.error(
          `emergency delivery ${row.id} failed after ${String(row.attempts)} attempts: ${reason}`,
        );
        // Push gave up: email takes over (email failures have nothing left to fall back to).
        if (row.channel === "push" && (row.purpose === "alert" || row.purpose === "reminder")) {
          await this.enqueue(
            this.db,
            row.incidentId,
            row.recipientId,
            [row.userId],
            row.purpose,
            row.wave,
            "email",
          );
        }
        return "failed";
      }
      await this.db
        .update(incidentDeliveries)
        .set({
          lastError: reason.slice(0, 300),
          nextAttemptAt: new Date(this.clock.now().getTime() + backoffMs(row.attempts)),
        })
        .where(eq(incidentDeliveries.id, row.id));
      return "retry";
    }
  }

  private async finish(
    row: IncidentDelivery,
    status: "sent" | "failed" | "skipped",
    error: string | null,
  ) {
    await this.db
      .update(incidentDeliveries)
      .set({
        status,
        lastError: error?.slice(0, 300) ?? null,
        ...(status === "sent" ? { sentAt: this.clock.now() } : {}),
      })
      .where(eq(incidentDeliveries.id, row.id));
  }

  /** Copy never promises that help is coming (FORBIDDEN_EMERGENCY_WORDING is tested). */
  private async message(
    row: IncidentDelivery,
    incident: typeof emergencyIncidents.$inferSelect,
  ): Promise<{ title: string; body: string }> {
    const name = async (id: string) => {
      const [u] = await this.db
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, id));
      return u?.name ?? FALLBACK_NAME;
    };
    const label = INCIDENT_CATEGORY_LABELS[incident.category];
    const [recipient] = await this.db
      .select()
      .from(incidentRecipients)
      .where(eq(incidentRecipients.id, row.recipientId));
    switch (row.purpose) {
      case "alert":
      case "reminder": {
        if (recipient?.kind === "provider") {
          const km =
            recipient.distanceM === null
              ? null
              : Math.max(1, Math.round(recipient.distanceM / 1000));
          return {
            title: "Nearby emergency alert",
            body: `${label}${km === null ? "" : ` about ${String(km)} km from your business`}. Open FleetTrust if you can offer help.`,
          };
        }
        const prefix = row.purpose === "reminder" ? "Reminder: e" : "E";
        return {
          title: `${prefix}mergency alert from ${await name(incident.ownerUserId)}`,
          body: `${label}. Open FleetTrust to see their details and let them know you've seen it. If anyone is in danger, contact local emergency services.`,
        };
      }
      case "acknowledged":
        return {
          title: "Your alert was seen",
          body: `${recipient?.userId ? await name(recipient.userId) : "A contact"} has seen your alert. If anyone is in danger, call your local emergency number.`,
        };
      case "offer":
        return {
          title: "A nearby provider offered to help",
          body: "Open FleetTrust to see their details and contact them directly. Payment is arranged directly with the provider.",
        };
      case "closed":
        return {
          title: `${await name(incident.ownerUserId)} closed their alert`,
          body:
            incident.status === "resolved"
              ? "They marked themselves as safe."
              : "The alert is no longer active.",
        };
    }
  }

  // -------------------------------------------------------------------------------------------
  // Timers
  // -------------------------------------------------------------------------------------------

  /** Contacts who haven't acknowledged a push alert in time get an email too. */
  async emailFallback(): Promise<void> {
    const cutoff = new Date(
      this.clock.now().getTime() - this.env.EMERGENCY_EMAIL_FALLBACK_SECONDS * 1000,
    );
    const rows = await queryRows<{
      incident_id: string;
      recipient_id: string;
      user_id: string;
      purpose: Purpose;
      wave: number;
    }>(
      this.db,
      sql`SELECT d.incident_id, d.recipient_id, d.user_id, d.purpose, d.wave
          FROM incident_deliveries d
          JOIN incident_recipients r ON r.id = d.recipient_id
          JOIN emergency_incidents i ON i.id = d.incident_id
          WHERE d.channel = 'push' AND d.purpose IN ('alert', 'reminder') AND d.status = 'sent'
            AND d.sent_at <= ${cutoff} AND r.kind = 'contact' AND r.acknowledged_at IS NULL
            AND i.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM incident_deliveries e
              WHERE e.recipient_id = d.recipient_id AND e.user_id = d.user_id
                AND e.channel = 'email' AND e.purpose = d.purpose AND e.wave = d.wave)
          LIMIT 500`,
    );
    for (const r of rows) {
      await this.enqueue(
        this.db,
        r.incident_id,
        r.recipient_id,
        [r.user_id],
        r.purpose,
        r.wave,
        "email",
      );
    }
  }

  /**
   * Nobody acknowledged in time: alert the next contacts (backups first, then anyone not yet
   * alerted). With nobody left, remind everyone already alerted. At most three waves.
   */
  async escalate(): Promise<void> {
    const now = this.clock.now();
    const due = await this.db
      .select()
      .from(emergencyIncidents)
      .where(
        and(eq(emergencyIncidents.status, "active"), lte(emergencyIncidents.nextEscalationAt, now)),
      );
    for (const incident of due) {
      await this.db.transaction(async (tx) => {
        const recipients = await tx
          .select()
          .from(incidentRecipients)
          .where(
            and(
              eq(incidentRecipients.incidentId, incident.id),
              eq(incidentRecipients.kind, "contact"),
            ),
          );
        if (recipients.some((r) => r.acknowledgedAt !== null) || incident.wave >= MAX_WAVES) {
          await tx
            .update(emergencyIncidents)
            .set({ nextEscalationAt: null })
            .where(eq(emergencyIncidents.id, incident.id));
          return;
        }
        const wave = incident.wave + 1;
        const alerted = new Set(recipients.map((r) => r.userId));
        const pool = await tx
          .select()
          .from(trustedContacts)
          .where(
            and(
              eq(trustedContacts.ownerUserId, incident.ownerUserId),
              eq(trustedContacts.status, "active"),
              eq(trustedContacts.muted, false),
            ),
          );
        const blocked = await queryRows<{ id: string }>(
          tx,
          sql`SELECT blocked_id AS id FROM user_blocks WHERE blocker_id = ${incident.ownerUserId}
              UNION SELECT blocker_id FROM user_blocks WHERE blocked_id = ${incident.ownerUserId}`,
        );
        const blockedIds = new Set(blocked.map((b) => b.id));
        const fresh = pool.filter(
          (c) => !alerted.has(c.contactUserId) && !blockedIds.has(c.contactUserId),
        );
        const next = wave === 2 ? fresh.filter((c) => c.priority === "backup") : fresh;
        const chosen = next.length > 0 ? next : wave === 2 ? fresh : [];
        if (chosen.length > 0) {
          const inserted = await tx
            .insert(incidentRecipients)
            .values(
              chosen.map((c) => ({
                incidentId: incident.id,
                kind: "contact" as const,
                userId: c.contactUserId,
                priority: c.priority,
                wave,
                notifiedAt: now,
              })),
            )
            .onConflictDoNothing()
            .returning();
          for (const r of inserted) {
            if (r.userId !== null)
              await this.enqueue(tx, incident.id, r.id, [r.userId], "alert", wave);
          }
        } else {
          for (const r of recipients) {
            if (r.userId !== null)
              await this.enqueue(tx, incident.id, r.id, [r.userId], "reminder", wave);
          }
        }
        await tx
          .update(emergencyIncidents)
          .set({
            wave,
            nextEscalationAt:
              wave < MAX_WAVES
                ? new Date(now.getTime() + this.env.EMERGENCY_ESCALATION_SECONDS * 1000)
                : null,
          })
          .where(eq(emergencyIncidents.id, incident.id));
        await recordAuditEvent(tx, {
          actorType: "system",
          action: "emergency.escalated",
          targetType: "emergency_incident",
          targetId: incident.id,
          metadata: {
            wave,
            newContacts: chosen.length,
            reminders: chosen.length === 0 ? recipients.length : 0,
          },
        });
      });
    }
  }

  /** Incidents close on their own; their location is erased. */
  async expire(): Promise<void> {
    const now = this.clock.now();
    const expired = await this.db
      .update(emergencyIncidents)
      .set({
        status: "expired",
        closedAt: now,
        location: null,
        locationAccuracyM: null,
        nextEscalationAt: null,
      })
      .where(and(eq(emergencyIncidents.status, "active"), lte(emergencyIncidents.expiresAt, now)))
      .returning({ id: emergencyIncidents.id });
    for (const { id } of expired) {
      await recordAuditEvent(this.db, {
        actorType: "system",
        action: "emergency.incident_expired",
        targetType: "emergency_incident",
        targetId: id,
        metadata: {},
      });
    }
    if (expired.length > 0) {
      // Pending alerts for expired incidents are skipped when attempted.
      await this.db
        .update(incidentDeliveries)
        .set({ status: "skipped", lastError: "incident expired" })
        .where(
          and(
            inArray(
              incidentDeliveries.incidentId,
              expired.map((e) => e.id),
            ),
            eq(incidentDeliveries.status, "pending"),
            isNull(incidentDeliveries.sentAt),
          ),
        );
    }
  }
}
