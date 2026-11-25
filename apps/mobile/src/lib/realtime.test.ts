import { describe, expect, it } from "@jest/globals";
import type { MessageDto } from "@fleettrust/types";

import { message } from "../../test/fixtures";
import { BACKOFF_MS, RealtimeClient, type RealtimeStatus, type SocketLike } from "./realtime";

const CONVERSATION = "0190c000-0000-7000-8000-00000000c001";

class FakeSocket implements SocketLike {
  readonly sent: Record<string, unknown>[] = [];
  closed: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code = 1000) {
    this.closed = code;
  }
  frame(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(token: string | null = "a-firebase-id-token-0123456789") {
  const sockets: FakeSocket[] = [];
  const timers: { callback: () => void; ms: number }[] = [];
  const received: MessageDto[] = [];
  const statuses: RealtimeStatus[] = [];
  const client = new RealtimeClient({
    url: "wss://api.test/v1/realtime",
    token: () => Promise.resolve(token),
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    onMessage: (_id, m) => received.push(m),
    onStatus: (status) => statuses.push(status),
    setTimer: (callback, ms) => {
      timers.push({ callback, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { client, sockets, timers, received, statuses };
}

async function connect(socket: FakeSocket) {
  socket.onopen?.();
  await flush();
  socket.frame({ type: "ready", userId: "u1" });
}

describe("realtime chat client", () => {
  it("sends the token in the first frame, never in the URL", async () => {
    const { client, sockets } = setup();
    client.watch(CONVERSATION, 4);
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    expect(socket.url).toBe("wss://api.test/v1/realtime");
    await connect(socket);
    expect(socket.sent).toEqual([
      { type: "auth", token: "a-firebase-id-token-0123456789" },
      { type: "subscribe", conversationId: CONVERSATION, after: 4 },
    ]);
  });

  it("drops duplicates and replays from the last seq after a reconnect", async () => {
    const { client, sockets, timers, received, statuses } = setup();
    client.watch(CONVERSATION, 1);
    const first = sockets[0];
    if (!first) throw new Error("no socket");
    await connect(first);
    first.frame({
      type: "message",
      conversationId: CONVERSATION,
      message: message(2, "two"),
      replay: true,
    });
    first.frame({
      type: "message",
      conversationId: CONVERSATION,
      message: message(2, "two"),
      replay: false,
    });
    first.frame({
      type: "message",
      conversationId: CONVERSATION,
      message: message(3, "three"),
      replay: false,
    });
    expect(received.map((m) => m.seq)).toEqual([2, 3]);

    first.drop();
    expect(timers.map((t) => t.ms)).toEqual([BACKOFF_MS[0]]);
    timers[0]?.callback();
    const second = sockets[1];
    if (!second) throw new Error("no reconnect");
    await connect(second);
    expect(second.sent.at(-1)).toEqual({
      type: "subscribe",
      conversationId: CONVERSATION,
      after: 3,
    });
    second.frame({
      type: "message",
      conversationId: CONVERSATION,
      message: message(3, "three"),
      replay: true,
    });
    second.frame({
      type: "message",
      conversationId: CONVERSATION,
      message: message(4, "four"),
      replay: true,
    });
    expect(received.map((m) => m.seq)).toEqual([2, 3, 4]);
    expect(statuses).toEqual(["connecting", "live", "waiting", "connecting", "live"]);
  });

  it("backs off up to 30 seconds and resets after a good connection", async () => {
    const { client, sockets, timers } = setup();
    client.watch(CONVERSATION, 0);
    for (let i = 0; i < 8; i++) {
      sockets.at(-1)?.drop();
      timers.at(-1)?.callback();
    }
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    const latest = sockets.at(-1);
    if (!latest) throw new Error("no socket");
    await connect(latest);
    latest.drop();
    expect(timers.at(-1)?.ms).toBe(1000);
  });

  it("waits while offline or in the background, and reconnects when either ends", () => {
    const { client, sockets, timers } = setup();
    client.watch(CONVERSATION, 0);
    client.setOnline(false);
    expect(sockets[0]?.closed).toBe(1000);
    sockets[0]?.drop(1000);
    expect(timers).toEqual([]);
    client.setOnline(true);
    expect(sockets).toHaveLength(2);
    client.setForeground(false);
    client.setForeground(true);
    expect(sockets).toHaveLength(3);
  });

  it("stops for good when the account is suspended or signed out", async () => {
    const suspended = setup();
    suspended.client.watch(CONVERSATION, 0);
    suspended.sockets[0]?.drop(4403);
    expect(suspended.timers).toEqual([]);
    expect(suspended.client.getStatus()).toBe("stopped");

    const signedOut = setup(null);
    signedOut.client.watch(CONVERSATION, 0);
    signedOut.sockets[0]?.onopen?.();
    await flush();
    expect(signedOut.sockets[0]?.sent).toEqual([]);
    expect(signedOut.client.getStatus()).toBe("stopped");
  });

  it("disconnects when the last conversation is closed", () => {
    const { client, sockets } = setup();
    const stop = client.watch(CONVERSATION, 0);
    stop();
    expect(sockets[0]?.closed).toBe(1000);
  });
});
