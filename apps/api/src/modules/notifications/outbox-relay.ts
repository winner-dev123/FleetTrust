import { and, asc, type Database, eq, isNull, lte, outboxEvents } from "@fleettrust/db";
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
import { type Effect, NotificationsService } from "./notifications.service.js";

const MAX_BACKOFF_MS = 60 * 60 * 1000;

/**
 * Transactional outbox relay (ADR-0007). Each event is handled in its own transaction with
 * `FOR UPDATE SKIP LOCKED`, so several workers can run safely; the inbox rows it writes are
 * idempotent, so at-least-once delivery doesn't notify twice. Push and realtime effects run after
 * the commit. Failures back off exponentially (up to an hour) and keep the error for operators.
 *
 * The worker role polls every OUTBOX_RELAY_INTERVAL_MS. Production may switch to Pub/Sub push
 * (Prompt 29) by calling `drain()` from an authenticated worker endpoint.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("OutboxRelay");
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly notifications: NotificationsService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  onApplicationBootstrap(): void {
    // WORKER_MODE=on-demand: WorkerRunner calls drain()/tick() when Cloud Tasks wakes the worker.
    if (
      this.env.APP_ROLE !== "worker" ||
      this.env.WORKER_MODE !== "loop" ||
      this.database === null
    ) {
      return;
    }
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.drain()
        .catch((error: unknown) => {
          this.logger.error(`relay failed: ${(error as Error).message}`);
        })
        .finally(() => {
          this.running = null;
        });
    }, this.env.OUTBOX_RELAY_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Processes up to `limit` due events. Returns how many were published and how many failed. */
  async drain(limit = 200): Promise<{ published: number; failed: number }> {
    const due = await this.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(and(isNull(outboxEvents.publishedAt), lte(outboxEvents.availableAt, this.clock.now())))
      .orderBy(asc(outboxEvents.availableAt), asc(outboxEvents.id))
      .limit(limit);
    let published = 0;
    let failed = 0;
    for (const { id } of due) {
      let effects: Effect[] = [];
      try {
        const done = await this.db.transaction(async (tx) => {
          const [event] = await tx
            .select()
            .from(outboxEvents)
            .where(and(eq(outboxEvents.id, id), isNull(outboxEvents.publishedAt)))
            .for("update", { skipLocked: true });
          if (!event) return false;
          effects = await this.notifications.handle(tx, event);
          await tx
            .update(outboxEvents)
            .set({ publishedAt: this.clock.now(), attempts: event.attempts + 1, lastError: null })
            .where(eq(outboxEvents.id, id));
          return true;
        });
        if (!done) continue;
        published += 1;
      } catch (error) {
        failed += 1;
        await this.fail(id, error);
        continue;
      }
      for (const effect of effects) {
        await effect().catch((error: unknown) => {
          this.logger.warn(`effect failed: ${(error as Error).message}`);
        });
      }
    }
    return { published, failed };
  }

  private async fail(id: string, error: unknown): Promise<void> {
    const [row] = await this.db
      .select({ attempts: outboxEvents.attempts })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id));
    const attempts = (row?.attempts ?? 0) + 1;
    const delay = Math.min(5_000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
    await this.db
      .update(outboxEvents)
      .set({
        attempts,
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        availableAt: new Date(this.clock.now().getTime() + delay),
      })
      .where(eq(outboxEvents.id, id));
    this.logger.warn(
      `event ${id} failed (attempt ${String(attempts)}): ${(error as Error).message}`,
    );
  }
}
