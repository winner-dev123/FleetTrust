import { Logger } from "@nestjs/common";
import { getMessaging } from "firebase-admin/messaging";

import { firebaseAdminApp } from "../../modules/identity/firebase-adapters.js";

export interface PushMessage {
  title: string;
  body: string;
  /** String values only (FCM data payload): IDs for deep links. */
  data: Record<string, string>;
}

export interface PushResult {
  sent: number;
  /** Installations FCM reported as gone; the caller deletes them. */
  invalid: string[];
}

/** Push delivery port (FCM in staging and production, ADR-0007). */
export interface PushSender {
  /** Sends to Firebase Installation IDs. */
  send(fids: readonly string[], message: PushMessage): Promise<PushResult>;
}

export const PUSH_SENDER = Symbol("PUSH_SENDER");

/** Development and tests: records pushes instead of sending them. */
export class RecordingPushSender implements PushSender {
  readonly sent: { fids: string[]; message: PushMessage }[] = [];
  /** Installations to report as gone (tests). */
  readonly gone = new Set<string>();

  send(fids: readonly string[], message: PushMessage): Promise<PushResult> {
    const invalid = fids.filter((f) => this.gone.has(f));
    const valid = fids.filter((f) => !this.gone.has(f));
    if (valid.length > 0) this.sent.push({ fids: valid, message });
    return Promise.resolve({ sent: valid.length, invalid });
  }
}

const GONE = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

export class FcmPushSender implements PushSender {
  private readonly logger = new Logger("FcmPushSender");

  constructor(private readonly projectId: string) {}

  async send(fids: readonly string[], message: PushMessage): Promise<PushResult> {
    if (fids.length === 0) return { sent: 0, invalid: [] };
    const messaging = getMessaging(firebaseAdminApp(this.projectId));
    const invalid: string[] = [];
    let sent = 0;
    // FCM accepts up to 500 targets per multicast.
    for (let i = 0; i < fids.length; i += 500) {
      const batch = fids.slice(i, i + 500);
      const response = await messaging.sendEachForMulticast({
        fids: batch,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: "high" },
        apns: { payload: { aps: { sound: "default" } } },
      });
      sent += response.successCount;
      response.responses.forEach((r, index) => {
        const code = r.error?.code;
        const fid = batch[index];
        if (code !== undefined && fid !== undefined && GONE.has(code)) {
          invalid.push(fid);
        } else if (code !== undefined) {
          this.logger.warn(`push failed: ${code}`);
        }
      });
    }
    return { sent, invalid };
  }
}
