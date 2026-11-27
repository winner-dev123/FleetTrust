import { type Database, queryRows, sql } from "@fleettrust/db";
import { Inject, Injectable, Logger } from "@nestjs/common";

import { API_ENV } from "../../config/config.module.js";
import type { ApiEnv } from "../../config/env.js";
import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { JOB_WAKER, type JobWaker } from "../../platform/worker-wake/index.js";
import { EmergencyDispatcher } from "../emergency/index.js";
import { OutboxRelay } from "../notifications/index.js";

/** What is waiting: an active emergency, and the earliest future delivery or outbox event. */
export interface PendingWork {
  activeIncident: boolean;
  /** Earliest pending emergency delivery or unpublished outbox event, if any. */
  nextDueAt: Date | null;
}

/** Consecutive quiet passes before a run ends (so writes committed just after a wake are seen). */
const QUIET_PASSES = 3;

/**
 * One on-demand worker run (WORKER_MODE=on-demand, ADR-0037 step 3). It does what the `loop` mode
 * timers do, as long as there is work:
 *
 * - every EMERGENCY_TICK_MS (1 s): the emergency pass (expiry, escalation, email fallback, due
 *   deliveries) and the outbox relay;
 * - it stops after a few quiet passes, or after WORKER_RUN_MS;
 * - before it stops it books the next run: right away while an emergency is active (so
 *   escalation keeps its 120 s timing and retries their 5 s / 15 s / 45 s backoff), or at the
 *   earliest future delivery or outbox retry.
 *
 * Runs in one instance never overlap: a request that arrives during a run joins it and makes it
 * do at least one more pass. Several instances are still safe (FOR UPDATE SKIP LOCKED, leases).
 */
@Injectable()
export class WorkerRunner {
  private readonly logger = new Logger("WorkerRunner");
  private active: Promise<{ passes: number }> | null = null;
  private again = false;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_WAKER) private readonly waker: JobWaker,
    private readonly dispatcher: EmergencyDispatcher,
    private readonly relay: OutboxRelay,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  /** Runs (or joins the run in progress). */
  run(): Promise<{ passes: number }> {
    if (this.active) {
      this.again = true;
      return this.active;
    }
    this.active = this.loop().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  private async loop(): Promise<{ passes: number }> {
    const started = this.clock.now().getTime();
    const interval = Math.min(this.env.EMERGENCY_TICK_MS, this.env.OUTBOX_RELAY_INTERVAL_MS);
    let passes = 0;
    let quiet = 0;
    let pending: PendingWork;
    for (;;) {
      this.again = false;
      await this.pass();
      passes += 1;
      pending = await this.pending();
      const now = this.clock.now();
      const dueNow = pending.nextDueAt !== null && pending.nextDueAt <= now;
      quiet = pending.activeIncident || dueNow || this.joinedDuringPass() ? 0 : quiet + 1;
      if (quiet >= QUIET_PASSES) break;
      if (now.getTime() - started + interval >= this.env.WORKER_RUN_MS) break;
      await this.sleep(interval);
    }
    await this.handOver(pending);
    return { passes };
  }

  /** Whether a wake-up arrived (and joined this run) during the last pass. */
  private joinedDuringPass(): boolean {
    return this.again;
  }

  /** One emergency pass and one outbox pass; a failure in one doesn't skip the other. */
  private async pass(): Promise<void> {
    await this.dispatcher.tick().catch((error: unknown) => {
      // Dispatch failures page the on-call (log-based alert, docs/operations).
      this.logger.error(`emergency tick failed: ${(error as Error).message}`);
    });
    await this.relay.drain().catch((error: unknown) => {
      this.logger.error(`relay failed: ${(error as Error).message}`);
    });
  }

  /** Books the next run (see the class comment). */
  private async handOver(pending: PendingWork): Promise<void> {
    const now = this.clock.now();
    try {
      if (pending.activeIncident || (pending.nextDueAt !== null && pending.nextDueAt <= now)) {
        // One continuation per WORKER_RUN_MS window, even if several runs end together.
        const window = Math.floor(now.getTime() / this.env.WORKER_RUN_MS);
        await this.waker.wake({ dedupeKey: `continue-${String(window)}` });
      } else if (pending.nextDueAt !== null) {
        await this.waker.wake({
          at: pending.nextDueAt,
          dedupeKey: `due-${String(Math.floor(pending.nextDueAt.getTime() / 1000))}`,
        });
      }
    } catch (error) {
      // The safety-net schedule starts a run within minutes; an emergency makes this an incident.
      this.logger.error(
        `booking the next worker run failed${pending.activeIncident ? " (emergency active)" : ""}: ${(error as Error).message}`,
      );
    }
  }

  async pending(): Promise<PendingWork> {
    const [row] = await queryRows<{ active: boolean; next_due: Date | string | null }>(
      this.db,
      sql`SELECT
            EXISTS (SELECT 1 FROM emergency_incidents WHERE status = 'active') AS active,
            LEAST(
              (SELECT min(next_attempt_at) FROM incident_deliveries WHERE status = 'pending'),
              (SELECT min(available_at) FROM outbox_events WHERE published_at IS NULL)
            ) AS next_due`,
    );
    const next = row?.next_due ?? null;
    return {
      activeIncident: row?.active === true,
      nextDueAt: next === null ? null : new Date(next),
    };
  }

  /** Waits between passes (replaceable in tests). */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
