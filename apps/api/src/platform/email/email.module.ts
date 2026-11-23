import { type DynamicModule, Module } from "@nestjs/common";

import type { ApiEnv } from "../../config/env.js";
import { EMAIL_SENDER, type EmailSender, RecordingEmailSender } from "./email-sender.js";

/** EMAIL_SENDER. Only the recording adapter exists until the vendor is chosen (OQ-06). */
@Module({})
export class EmailModule {
  static forRoot(_env: ApiEnv): DynamicModule {
    return {
      module: EmailModule,
      global: true,
      providers: [
        { provide: EMAIL_SENDER, useFactory: (): EmailSender => new RecordingEmailSender() },
      ],
      exports: [EMAIL_SENDER],
    };
  }
}
