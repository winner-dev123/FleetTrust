import { EventEmitter } from "node:events";

import { Logger } from "@nestjs/common";
import { createClient } from "redis";

/**
 * Fan-out between API instances for realtime delivery (ADR-0007, ADR-0024). Channels:
 * `conversation:<id>` (messages, updates, receipts) and `user:<id>` (inbox updates).
 * Best effort: durable history lives in Postgres, and clients replay from their cursor.
 */
export interface RealtimeBus {
  publish(channel: string, payload: unknown): Promise<void>;
  /** Returns an unsubscribe function. */
  subscribe(channel: string, handler: (payload: unknown) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export const REALTIME_BUS = Symbol("REALTIME_BUS");

/** Single-instance bus (local development and tests). */
export class MemoryRealtimeBus implements RealtimeBus {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  publish(channel: string, payload: unknown): Promise<void> {
    // Deliver asynchronously, like a network bus, with a copy (no shared references).
    const copy: unknown = JSON.parse(JSON.stringify(payload));
    setImmediate(() => this.emitter.emit(channel, copy));
    return Promise.resolve();
  }

  subscribe(channel: string, handler: (payload: unknown) => void) {
    this.emitter.on(channel, handler);
    return Promise.resolve(() => {
      this.emitter.off(channel, handler);
      return Promise.resolve();
    });
  }

  close(): Promise<void> {
    this.emitter.removeAllListeners();
    return Promise.resolve();
  }
}

/** Redis pub/sub (Memorystore in production). Publisher and subscriber need separate connections. */
export class RedisRealtimeBus implements RealtimeBus {
  private readonly logger = new Logger("RealtimeBus");
  private readonly publisher;
  private readonly subscriber;
  private readonly ready: Promise<void>;
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor(url: string) {
    const options = {
      url,
      socket: {
        connectTimeout: 2_000,
        reconnectStrategy: (retries: number) => Math.min(retries * 200, 2_000),
      },
    };
    this.publisher = createClient(options);
    this.subscriber = createClient(options);
    for (const client of [this.publisher, this.subscriber]) {
      client.on("error", (error: Error) => {
        this.logger.warn(`Redis error: ${error.message}`);
      });
    }
    this.ready = Promise.all([this.publisher.connect(), this.subscriber.connect()]).then(
      () => undefined,
    );
    this.ready.catch((error: unknown) => {
      this.logger.warn(`Redis connect failed: ${(error as Error).message}`);
    });
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    try {
      await this.ready;
      await this.publisher.publish(channel, JSON.stringify(payload));
    } catch (error) {
      // Clients still get the message on their next replay.
      this.logger.warn(`publish failed on ${channel}: ${(error as Error).message}`);
    }
  }

  async subscribe(channel: string, handler: (payload: unknown) => void) {
    await this.ready;
    let set = this.handlers.get(channel);
    if (!set) {
      const listeners = new Set<(payload: unknown) => void>();
      set = listeners;
      this.handlers.set(channel, listeners);
      await this.subscriber.subscribe(channel, (raw: string) => {
        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return;
        }
        for (const h of listeners) h(payload);
      });
    }
    set.add(handler);
    return async () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        await this.subscriber.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  async close(): Promise<void> {
    for (const client of [this.publisher, this.subscriber]) {
      if (client.isOpen) await client.close().catch(() => undefined);
    }
  }
}
