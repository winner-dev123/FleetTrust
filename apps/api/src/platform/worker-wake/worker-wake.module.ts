import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { GoogleAuth } from "google-auth-library";

import type { ApiEnv } from "../../config/env.js";
import { CloudTasksJobWaker, type GoogleRequester, JOB_WAKER, NoopJobWaker } from "./job-waker.js";
import { WakeWorkerAfterWrites } from "./wake-after-writes.interceptor.js";

/**
 * Provides JOB_WAKER everywhere: Cloud Tasks with WORKER_MODE=on-demand, otherwise a no-op. On
 * the API role in on-demand mode it also wakes the worker after writes (ADR-0037 step 3).
 */
@Module({})
export class WorkerWakeModule {
  static forRoot(env: ApiEnv): DynamicModule {
    const onDemand = env.WORKER_MODE === "on-demand";
    let client: Promise<GoogleRequester> | null = null;
    const providers: Provider[] = [
      {
        provide: JOB_WAKER,
        useFactory: () =>
          onDemand
            ? new CloudTasksJobWaker(
                env.JOBS_QUEUE ?? "",
                env.WORKER_URL ?? "",
                env.JOBS_SERVICE_ACCOUNT ?? "",
                () =>
                  (client ??= new GoogleAuth({
                    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
                  }).getClient() as Promise<GoogleRequester>),
              )
            : new NoopJobWaker(),
      },
    ];
    if (onDemand && env.APP_ROLE === "api") {
      providers.push({ provide: APP_INTERCEPTOR, useClass: WakeWorkerAfterWrites });
    }
    return { module: WorkerWakeModule, global: true, providers, exports: [JOB_WAKER] };
  }
}
