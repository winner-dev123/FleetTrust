import {
  and,
  type Database,
  documentAccessGrants,
  isNotNull,
  isNull,
  lt,
  notifications,
  outboxEvents,
  pushDevices,
  quotaConsumptions,
  recordAuditEvent,
} from "@fleettrust/db";
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
import { ReviewService } from "../verification/index.js";

const DAY = 86_400_000;

/**
 * Data retention rules (Prompt 27, ADR-0034). Each deletes data that is no longer needed.
 * Everything else, and why it's kept, is listed in docs/security/data-retention.md.
 */
export const RETENTION_RULES = [
  { name: "outbox_events_published", days: 30, what: "delivered domain events" },
  { name: "notifications_read", days: 180, what: "read notifications" },
  { name: "notifications_unread", days: 365, what: "unread notifications" },
  {
    name: "document_access_grants_expired",
    days: 1,
    what: "used or expired one-time document links",
  },
  { name: "quota_consumptions", days: 400, what: "quota usage records (kept a year for disputes)" },
  { name: "push_devices_stale", days: 270, what: "push registrations not seen for nine months" },
] as const;

export type RetentionReport = Record<
  (typeof RETENTION_RULES)[number]["name"] | "verification_documents",
  number
>;

@Injectable()
export class RetentionService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly review: ReviewService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  /** Runs every rule once and records what it removed (counts only) in the audit log. */
  async run(): Promise<RetentionReport> {
    const now = this.clock.now().getTime();
    const before = (days: number) => new Date(now - days * DAY);
    const db = this.db;
    const count = (rows: readonly unknown[]) => rows.length;

    const report: RetentionReport = {
      outbox_events_published: count(
        await db
          .delete(outboxEvents)
          .where(and(isNotNull(outboxEvents.publishedAt), lt(outboxEvents.publishedAt, before(30))))
          .returning({ id: outboxEvents.id }),
      ),
      notifications_read: count(
        await db
          .delete(notifications)
          .where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, before(180))))
          .returning({ id: notifications.id }),
      ),
      notifications_unread: count(
        await db
          .delete(notifications)
          .where(and(isNull(notifications.readAt), lt(notifications.createdAt, before(365))))
          .returning({ id: notifications.id }),
      ),
      document_access_grants_expired: count(
        await db
          .delete(documentAccessGrants)
          .where(lt(documentAccessGrants.expiresAt, before(1)))
          .returning({ id: documentAccessGrants.id }),
      ),
      quota_consumptions: count(
        await db
          .delete(quotaConsumptions)
          .where(lt(quotaConsumptions.createdAt, before(400)))
          .returning({ id: quotaConsumptions.id }),
      ),
      push_devices_stale: count(
        await db
          .delete(pushDevices)
          .where(lt(pushDevices.lastSeenAt, before(270)))
          .returning({ fid: pushDevices.fid }),
      ),
      // Identity documents: the verification module's own purge (VERIFICATION_DOCUMENT_RETENTION_DAYS).
      verification_documents: await this.review.purgeExpiredDocuments(null),
    };
    await recordAuditEvent(db, {
      actorType: "system",
      action: "privacy.retention_run",
      targetType: "system",
      metadata: report,
    });
    return report;
  }
}

/** Worker role: applies the retention rules every RETENTION_INTERVAL_MS (daily by default). */
@Injectable()
export class RetentionJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("RetentionJob");
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly retention: RetentionService,
  ) {}

  onApplicationBootstrap(): void {
    // WORKER_MODE=on-demand: Cloud Scheduler calls the worker endpoint instead (WorkerJobsController).
    if (this.env.APP_ROLE !== "worker" || this.env.WORKER_MODE !== "loop") return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.retention
        .run()
        .catch((error: unknown) => {
          this.logger.error(`retention run failed: ${(error as Error).message}`);
        })
        .finally(() => {
          this.running = null;
        });
    }, this.env.RETENTION_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
