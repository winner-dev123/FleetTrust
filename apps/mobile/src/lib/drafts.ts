import type { z } from "zod";

import type { KeyValueStore } from "../platform/types";

/**
 * Offline drafts (ADR-0032): unfinished service requests, messages and comments are kept on
 * the device so a lost connection or a closed app doesn't lose what someone typed.
 *
 * - Stored per signed-in user and erased at sign-out (`clearUserData`).
 * - Expire after 7 days.
 * - Validated with a schema on load; anything unreadable is dropped, never shown half-parsed.
 * - Drafts are never sent automatically. Only queued chat messages are (see `outbox.ts`),
 *   because sending them again is safe (idempotent `clientMessageId`).
 */

export type DraftKind = "request" | "message" | "comment";

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = "ft:";

export const draftKey = (userId: string, kind: DraftKind, id: string) =>
  `${PREFIX}draft:${userId}:${kind}:${id}`;

export interface LoadedDraft<T> {
  value: T;
  savedAt: string;
}

export class DraftStore {
  constructor(
    private readonly storage: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  async load<T>(
    userId: string,
    kind: DraftKind,
    id: string,
    schema: z.ZodType<T>,
  ): Promise<LoadedDraft<T> | null> {
    const key = draftKey(userId, kind, id);
    const raw = await this.storage.get(key);
    if (raw === null) return null;
    let stored: unknown;
    try {
      stored = JSON.parse(raw);
    } catch {
      await this.storage.remove(key);
      return null;
    }
    const savedAt =
      typeof stored === "object" && stored !== null && "savedAt" in stored ? stored.savedAt : null;
    const value =
      typeof stored === "object" && stored !== null && "value" in stored ? stored.value : undefined;
    const parsed = schema.safeParse(value);
    const time = typeof savedAt === "string" ? Date.parse(savedAt) : Number.NaN;
    if (!parsed.success || Number.isNaN(time) || this.now() - time > DRAFT_TTL_MS) {
      await this.storage.remove(key);
      return null;
    }
    return { value: parsed.data, savedAt: savedAt as string };
  }

  async save(userId: string, kind: DraftKind, id: string, value: unknown): Promise<void> {
    await this.storage.set(
      draftKey(userId, kind, id),
      JSON.stringify({ savedAt: new Date(this.now()).toISOString(), value }),
    );
  }

  async discard(userId: string, kind: DraftKind, id: string): Promise<void> {
    await this.storage.remove(draftKey(userId, kind, id));
  }
}

/** Erases everything the app stored for a user (drafts, queued messages). Run at sign-out. */
export async function clearUserData(storage: KeyValueStore, userId: string): Promise<number> {
  const mine = (await storage.keys()).filter(
    (key) =>
      key.startsWith(`${PREFIX}draft:${userId}:`) || key.startsWith(`${PREFIX}outbox:${userId}`),
  );
  for (const key of mine) await storage.remove(key);
  return mine.length;
}
