/**
 * Wakes the on-demand worker (ADR-0037 step 3). In `loop` mode (local, CI, an always-on worker)
 * the worker's own timers do the work, so waking is a no-op.
 */
export interface JobWaker {
  /**
   * Asks for one worker run, now or at `at`. `dedupeKey` names the wake-up, so several callers
   * asking for the same one create a single run (later duplicates are ignored).
   */
  wake(options?: { at?: Date; dedupeKey?: string }): Promise<void>;
}

export const JOB_WAKER = Symbol("JOB_WAKER");

export class NoopJobWaker implements JobWaker {
  wake(): Promise<void> {
    return Promise.resolve();
  }
}

/** Minimal surface of google-auth-library's AuthClient used here (injectable for tests). */
export interface GoogleRequester {
  request(options: {
    url: string;
    method: "POST";
    data: unknown;
  }): Promise<{ status: number; data?: unknown }>;
}

/** The path the worker serves for a run (WorkerJobsController). */
export const WORKER_RUN_PATH = "/internal/jobs/run";

/**
 * Cloud Tasks HTTP task to `<WORKER_URL>/internal/jobs/run`, carrying a Google identity token for
 * JOBS_SERVICE_ACCOUNT (the worker service only accepts callers with roles/run.invoker).
 * Free at this volume (first million operations a month).
 */
export class CloudTasksJobWaker implements JobWaker {
  constructor(
    private readonly queue: string,
    private readonly workerUrl: string,
    private readonly serviceAccount: string,
    private readonly client: () => Promise<GoogleRequester>,
  ) {}

  async wake(options: { at?: Date; dedupeKey?: string } = {}): Promise<void> {
    const audience = new URL(this.workerUrl).origin;
    const task: CloudTask = {
      httpRequest: {
        url: new URL(WORKER_RUN_PATH, this.workerUrl).toString(),
        httpMethod: "POST",
        oidcToken: { serviceAccountEmail: this.serviceAccount, audience },
      },
      // A run polls for up to WORKER_RUN_MS; allow it to finish before Cloud Tasks retries.
      dispatchDeadline: "300s",
    };
    if (options.at) task.scheduleTime = options.at.toISOString();
    if (options.dedupeKey) task.name = `${this.queue}/tasks/${sanitize(options.dedupeKey)}`;
    try {
      await (
        await this.client()
      ).request({
        url: `https://cloudtasks.googleapis.com/v2/${this.queue}/tasks`,
        method: "POST",
        data: { task },
      });
    } catch (error) {
      // The same named wake-up already exists (or ran recently): that run covers this request.
      if (statusOf(error) === 409) return;
      throw error;
    }
  }
}

/** The fields of a Cloud Tasks task that FleetTrust sets. */
interface CloudTask {
  httpRequest: {
    url: string;
    httpMethod: "POST";
    oidcToken: { serviceAccountEmail: string; audience: string };
  };
  dispatchDeadline: string;
  scheduleTime?: string;
  name?: string;
}

/** Task IDs allow letters, digits, hyphens and underscores (max 500). */
function sanitize(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 400);
}

function statusOf(error: unknown): number | undefined {
  const e = error as { status?: number; code?: number | string; response?: { status?: number } };
  if (typeof e.response?.status === "number") return e.response.status;
  if (typeof e.status === "number") return e.status;
  return typeof e.code === "number" ? e.code : undefined;
}
