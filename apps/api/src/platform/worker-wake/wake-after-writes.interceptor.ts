import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import { concatMap, type Observable } from "rxjs";

import { JOB_WAKER, type JobWaker } from "./job-waker.js";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** At most one wake-up per instance in this window: one worker run drains everything written. */
export const WAKE_DEBOUNCE_MS = 2_000;
/** Never hold a response longer than this for a wake-up (the safety-net schedule catches up). */
const WAKE_TIMEOUT_MS = 3_000;

/**
 * API role with WORKER_MODE=on-demand: after a successful write (which may have queued outbox
 * events or emergency deliveries), wake the worker. The wake-up is awaited before the response is
 * sent, because Cloud Run gives an instance almost no CPU once its response is out. Emergency
 * routes are never debounced. A failed wake-up is logged and doesn't fail the request.
 */
@Injectable()
export class WakeWorkerAfterWrites implements NestInterceptor {
  private readonly logger = new Logger("WakeWorker");
  private lastWake = Number.NEGATIVE_INFINITY;
  /** Time source (replaceable in tests). */
  now: () => number = Date.now;

  constructor(@Inject(JOB_WAKER) private readonly waker: JobWaker) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest<{ method?: string; url?: string }>();
    if (!WRITES.has(req.method ?? "")) return next.handle();
    const urgent = (req.url ?? "").includes("/emergency");
    return next.handle().pipe(
      concatMap(async (value: unknown) => {
        await this.wake(urgent);
        return value;
      }),
    );
  }

  private async wake(urgent: boolean): Promise<void> {
    const now = this.now();
    if (!urgent && now - this.lastWake < WAKE_DEBOUNCE_MS) return;
    this.lastWake = now;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.waker.wake(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("timed out"));
          }, WAKE_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      // Severity ERROR: an emergency wake-up that failed is caught by the safety-net schedule.
      this.logger.error(
        `worker wake-up failed${urgent ? " (emergency)" : ""}: ${(error as Error).message}`,
      );
      this.lastWake = Number.NEGATIVE_INFINITY;
    } finally {
      clearTimeout(timer);
    }
  }
}
