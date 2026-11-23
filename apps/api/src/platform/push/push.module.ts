import { type DynamicModule, Module } from "@nestjs/common";

import type { ApiEnv } from "../../config/env.js";
import { FcmPushSender, PUSH_SENDER, type PushSender, RecordingPushSender } from "./push-sender.js";

/** PUSH_SENDER: FCM when PUSH_PROVIDER=fcm (required when deployed), otherwise recorded. */
@Module({})
export class PushModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: PushModule,
      global: true,
      providers: [
        {
          provide: PUSH_SENDER,
          useFactory: (): PushSender =>
            env.PUSH_PROVIDER === "fcm"
              ? new FcmPushSender(env.FIREBASE_PROJECT_ID)
              : new RecordingPushSender(),
        },
      ],
      exports: [PUSH_SENDER],
    };
  }
}
