import { describe, expect, it } from "@jest/globals";
import { ApiError } from "@fleettrust/sdk";
import type { MessageDto } from "@fleettrust/types";

import { FakeDevice } from "../../test/fake-platform";
import { message } from "../../test/fixtures";
import { MessageOutbox, type SendFn } from "./outbox";

/** A server that dedupes by clientMessageId, like the real API (ADR-0024). */
function server() {
  const stored = new Map<string, MessageDto>();
  const attempts: string[] = [];
  let mode: "up" | "offline" | "refuse" | "error500" = "up";
  const send: SendFn = (conversationId, { clientMessageId, body }) => {
    attempts.push(clientMessageId);
    if (mode === "offline") return Promise.reject(new ApiError("x", "network_error"));
    if (mode === "error500") return Promise.reject(new ApiError("x", "http_error", 503));
    if (mode === "refuse") {
      return Promise.reject(
        new ApiError("x", "http_error", 409, { reason: "conversation_read_only" }),
      );
    }
    const existing = stored.get(clientMessageId);
    if (existing) return Promise.resolve(existing);
    const created = message(stored.size + 1, body, { clientMessageId, conversationId });
    stored.set(clientMessageId, created);
    return Promise.resolve(created);
  };
  return {
    send,
    stored,
    attempts,
    set: (next: typeof mode) => {
      mode = next;
    },
  };
}

describe("message outbox", () => {
  it("keeps messages written offline and sends them, in order, when back online", async () => {
    const device = new FakeDevice();
    const api = server();
    const outbox = new MessageOutbox(device.platform.storage, "u1", api.send);
    api.set("offline");
    await outbox.enqueue("c1", "first", "id-1");
    await outbox.enqueue("c1", "second", "id-2");
    expect(await outbox.flush()).toEqual({ sent: [], offline: true });
    expect((await outbox.list("c1")).map((m) => m.body)).toEqual(["first", "second"]);

    api.set("up");
    const result = await outbox.flush();
    expect(result.sent.map((m) => m.body)).toEqual(["first", "second"]);
    expect(await outbox.list()).toEqual([]);
  });

  it("never duplicates a message when a send is retried", async () => {
    const device = new FakeDevice();
    const api = server();
    // The server stores the message but the reply is lost (signal drops after sending).
    let dropReply = true;
    const flaky: SendFn = async (conversationId, payload) => {
      const result = await api.send(conversationId, payload);
      if (dropReply) {
        dropReply = false;
        throw new ApiError("x", "network_error");
      }
      return result;
    };
    const outbox = new MessageOutbox(device.platform.storage, "u1", flaky);
    await outbox.enqueue("c1", "hello", "id-1");
    await outbox.enqueue("c1", "hello", "id-1");
    expect((await outbox.flush()).offline).toBe(true);
    await outbox.flush();
    expect(api.attempts).toEqual(["id-1", "id-1"]);
    expect(api.stored.size).toBe(1);
  });

  it("marks refused messages as not sent, keeps later ones queued behind them, and never retries silently", async () => {
    const device = new FakeDevice();
    const api = server();
    const outbox = new MessageOutbox(device.platform.storage, "u1", api.send);
    api.set("refuse");
    await outbox.enqueue("c1", "first", "id-1");
    await outbox.enqueue("c1", "second", "id-2");
    await outbox.flush();
    const [first, second] = await outbox.list("c1");
    expect(first).toMatchObject({ state: "failed", error: expect.stringMatching(/can't be done/) });
    expect(second?.state).toBe("queued");

    api.set("up");
    await outbox.flush();
    expect(api.attempts).toEqual(["id-1"]);

    await outbox.retry("id-1");
    await outbox.flush();
    expect(await outbox.list()).toEqual([]);
    expect([...api.stored.values()].map((m) => m.body)).toEqual(["first", "second"]);
  });

  it("treats server errors like a lost connection (kept for later)", async () => {
    const device = new FakeDevice();
    const api = server();
    const outbox = new MessageOutbox(device.platform.storage, "u1", api.send);
    api.set("error500");
    await outbox.enqueue("c1", "hello", "id-1");
    expect((await outbox.flush()).offline).toBe(true);
    expect((await outbox.list())[0]?.state).toBe("queued");
  });

  it("shares one run between concurrent flushes", async () => {
    const device = new FakeDevice();
    const api = server();
    const outbox = new MessageOutbox(device.platform.storage, "u1", api.send);
    await outbox.enqueue("c1", "hello", "id-1");
    await Promise.all([outbox.flush(), outbox.flush(), outbox.flush()]);
    expect(api.attempts).toEqual(["id-1"]);
  });
});
