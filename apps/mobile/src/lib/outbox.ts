import { ApiError, errorMessage, isOffline } from "@fleettrust/sdk";
import type { MessageDto } from "@fleettrust/types";
import { z } from "zod";

import type { KeyValueStore } from "../platform/types";

/**
 * Chat messages wait here until the API confirms them (ADR-0032). Every message keeps the
 * `clientMessageId` it was given when typed, and the API returns the original message for a
 * repeated ID (ADR-0024), so resending after a dropped connection can never duplicate it.
 *
 * - Offline or unreachable: the message stays `queued` and is sent when the app is online.
 * - Refused by the API (blocked, read-only conversation, too long): `failed`, with the reason;
 *   the person can retry or delete it. It's never retried silently.
 * - Messages are sent in the order they were written, per conversation.
 */

const queuedSchema = z.object({
  clientMessageId: z.string().min(1),
  conversationId: z.string().min(1),
  body: z.string(),
  queuedAt: z.string(),
  state: z.enum(["queued", "failed"]),
  error: z.string().nullable(),
});
export type QueuedMessage = z.infer<typeof queuedSchema>;

export type SendFn = (
  conversationId: string,
  message: { clientMessageId: string; body: string },
) => Promise<MessageDto>;

export interface FlushResult {
  sent: MessageDto[];
  /** True if the network failed part-way; the rest stays queued. */
  offline: boolean;
}

export class MessageOutbox {
  private readonly key: string;
  private flushing: Promise<FlushResult> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: KeyValueStore,
    userId: string,
    private readonly send: SendFn,
    private readonly now: () => number = Date.now,
  ) {
    this.key = `ft:outbox:${userId}`;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async list(conversationId?: string): Promise<QueuedMessage[]> {
    const raw = await this.storage.get(this.key);
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    const items = z.array(queuedSchema).safeParse(parsed);
    if (!items.success) return [];
    return conversationId === undefined
      ? items.data
      : items.data.filter((item) => item.conversationId === conversationId);
  }

  private async write(items: QueuedMessage[]): Promise<void> {
    if (items.length === 0) await this.storage.remove(this.key);
    else await this.storage.set(this.key, JSON.stringify(items));
    for (const listener of this.listeners) listener();
  }

  async enqueue(conversationId: string, body: string, clientMessageId: string): Promise<void> {
    const items = await this.list();
    if (items.some((item) => item.clientMessageId === clientMessageId)) return;
    items.push({
      clientMessageId,
      conversationId,
      body,
      queuedAt: new Date(this.now()).toISOString(),
      state: "queued",
      error: null,
    });
    await this.write(items);
  }

  async retry(clientMessageId: string): Promise<void> {
    const items = await this.list();
    await this.write(
      items.map((item) =>
        item.clientMessageId === clientMessageId ? { ...item, state: "queued", error: null } : item,
      ),
    );
  }

  async remove(clientMessageId: string): Promise<void> {
    const items = await this.list();
    await this.write(items.filter((item) => item.clientMessageId !== clientMessageId));
  }

  /** Sends every queued message. Concurrent calls share one run. */
  flush(): Promise<FlushResult> {
    this.flushing ??= this.run().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async run(): Promise<FlushResult> {
    const sent: MessageDto[] = [];
    // A refused message blocks later ones in the same conversation, so order is kept.
    const blocked = new Set<string>();
    for (const item of await this.list()) {
      if (item.state !== "queued" || blocked.has(item.conversationId)) {
        blocked.add(item.conversationId);
        continue;
      }
      try {
        const message = await this.send(item.conversationId, {
          clientMessageId: item.clientMessageId,
          body: item.body,
        });
        sent.push(message);
        await this.remove(item.clientMessageId);
      } catch (error) {
        if (isOffline(error) || (error instanceof ApiError && (error.status ?? 0) >= 500)) {
          return { sent, offline: true };
        }
        blocked.add(item.conversationId);
        const items = await this.list();
        await this.write(
          items.map((other) =>
            other.clientMessageId === item.clientMessageId
              ? { ...other, state: "failed", error: errorMessage(error) }
              : other,
          ),
        );
      }
    }
    return { sent, offline: false };
  }
}
