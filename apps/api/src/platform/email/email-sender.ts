import { Logger } from "@nestjs/common";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Transactional email port (emergency fallback first, ADR-0025). The vendor isn't chosen yet
 * (OQ-06): `log` records messages and never sends them; production refuses it.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol("EMAIL_SENDER");

/** Development and tests: records emails. `failNext` makes the next sends throw (retry tests). */
export class RecordingEmailSender implements EmailSender {
  private readonly logger = new Logger("Email");
  readonly sent: EmailMessage[] = [];
  failNext = 0;

  send(message: EmailMessage): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new Error("email provider unavailable"));
    }
    this.sent.push(message);
    this.logger.log(`email recorded (not sent): ${message.subject}`);
    return Promise.resolve();
  }
}
