import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { auditEvents, eq, outboxEvents, platformStaff, pushDevices, sql } from "@fleettrust/db";
import type {
  ConversationDto,
  InboxDto,
  MessageDto,
  MessagePage,
  ModerationCase,
  SendFriendRequestResult,
  ServerFrame,
  ServiceRequestDto,
  InquiryDto,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { GAP_WAIT_MS } from "../src/modules/messaging/index.js";
import { OutboxRelay } from "../src/modules/notifications/index.js";
import { PUSH_SENDER, type RecordingPushSender } from "../src/platform/push/index.js";
import { REALTIME_BUS, type RealtimeBus } from "../src/platform/realtime/index.js";
import { samplePng } from "./support/images.js";
import { makePerson, type Person, publishProvider } from "./support/providers.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;
let port: number;

beforeAll(async () => {
  t = await createTestApp();
  await new Promise<void>((resolve) => t.server.listen(0, "127.0.0.1", resolve));
  port = (t.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await t.close();
});

const reason = (body: unknown) => (body as { reason?: string }).reason;

interface Member extends Person {
  id: string;
}

async function person(uid: string): Promise<Member> {
  const p = makePerson(t, uid);
  const me = (await p.patch("/v1/me", { displayName: uid }).expect(200)).body as { id: string };
  return { ...p, id: me.id };
}

async function befriend(a: Member, b: Member) {
  const sent = (await a.post("/v1/me/friend-requests", { userId: b.id }).expect(201))
    .body as SendFriendRequestResult;
  if (sent.outcome !== "sent") throw new Error("expected sent");
  await b.post(`/v1/me/friend-requests/${sent.request.id}/accept`).expect(200);
}

async function direct(a: Member, b: Member): Promise<ConversationDto> {
  return (await a.post("/v1/conversations/direct", { userId: b.id }).expect(201))
    .body as ConversationDto;
}

async function say(
  p: Person,
  conversationId: string,
  body: string,
  extra: object = {},
): Promise<MessageDto> {
  return (
    await p
      .post(`/v1/conversations/${conversationId}/messages`, {
        clientMessageId: randomUUID(),
        body,
        ...extra,
      })
      .expect(201)
  ).body as MessageDto;
}

/** A WebSocket client that records frames and can wait for one. */
class Client {
  readonly frames: ServerFrame[] = [];
  private waiters: { match: (f: ServerFrame) => boolean; resolve: (f: ServerFrame) => void }[] = [];
  readonly closed: Promise<number>;

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (data: Buffer) => {
      const frame = JSON.parse(data.toString("utf8")) as ServerFrame;
      this.frames.push(frame);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(frame)) return true;
        w.resolve(frame);
        return false;
      });
    });
    this.closed = new Promise((resolve) =>
      ws.on("close", (code) => {
        resolve(code);
      }),
    );
  }

  static async open(): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/v1/realtime`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => {
        resolve();
      });
      ws.once("error", reject);
    });
    return new Client(ws);
  }

  static async signedIn(uid: string): Promise<Client> {
    const client = await Client.open();
    client.send({ type: "auth", token: t.auth.issue(uid, { email: `${uid}@example.test` }) });
    await client.next((f) => f.type === "ready");
    return client;
  }

  send(frame: object): void {
    this.ws.send(JSON.stringify(frame));
  }

  next(match: (f: ServerFrame) => boolean, timeoutMs = 3_000): Promise<ServerFrame> {
    const seen = this.frames.find(match);
    if (seen) {
      this.frames.splice(this.frames.indexOf(seen), 1);
      return Promise.resolve(seen);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for a frame"));
      }, timeoutMs);
      this.waiters.push({
        match,
        resolve: (f) => {
          clearTimeout(timer);
          this.frames.splice(this.frames.indexOf(f), 1);
          resolve(f);
        },
      });
    });
  }

  /** Subscribes and collects the replayed messages until `subscribed`. */
  async subscribe(
    conversationId: string,
    after = 0,
  ): Promise<{ replay: MessageDto[]; lastSeq: number }> {
    this.send({ type: "subscribe", conversationId, after });
    const done = (await this.next(
      (f) => f.type === "subscribed" && f.conversationId === conversationId,
    )) as Extract<ServerFrame, { type: "subscribed" }>;
    const replay: MessageDto[] = [];
    for (;;) {
      const i = this.frames.findIndex(
        (f) => f.type === "message" && f.replay && f.conversationId === conversationId,
      );
      if (i < 0) break;
      const [f] = this.frames.splice(i, 1);
      if (f?.type === "message") replay.push(f.message);
    }
    return { replay, lastSeq: done.lastSeq };
  }

  async close(): Promise<void> {
    this.ws.close();
    await this.closed;
  }
}

const quiet = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

describe("direct conversations and access", () => {
  it("friends can message; strangers can't read, send or subscribe; blocks stop sending", async () => {
    const a = await person("d1-a");
    const b = await person("d1-b");
    const stranger = await person("d1-stranger");
    await befriend(a, b);
    const conv = await direct(a, b);
    expect(conv).toMatchObject({ kind: "direct", peer: { userId: b.id }, canSend: true });
    const again = await direct(b, a);
    expect(again.id).toBe(conv.id);

    const first = await say(a, conv.id, "Morning, are you on the N1 today?");
    expect(first).toMatchObject({
      seq: 1,
      sender: { userId: a.id, mine: true },
      body: "Morning, are you on the N1 today?",
    });
    const list = (await b.get("/v1/conversations").expect(200)).body as ConversationDto[];
    expect(list.find((c) => c.id === conv.id)).toMatchObject({ unread: 1, lastSeq: 1 });

    for (const path of [`/v1/conversations/${conv.id}`, `/v1/conversations/${conv.id}/messages`]) {
      await stranger.get(path).expect(404);
    }
    await stranger
      .post(`/v1/conversations/${conv.id}/messages`, { clientMessageId: randomUUID(), body: "hi" })
      .expect(404);
    await stranger.post(`/v1/conversations/${conv.id}/read`, { seq: 1 }).expect(404);
    await request(t.server).get(`/v1/conversations/${conv.id}/messages`).expect(401);

    const ws = await Client.signedIn("d1-stranger");
    ws.send({ type: "subscribe", conversationId: conv.id, after: 0 });
    expect(await ws.next((f) => f.type === "error")).toEqual({
      type: "error",
      code: "not_found",
      conversationId: conv.id,
    });
    await ws.close();

    // Default privacy: direct messages from friends only.
    expect(
      reason((await stranger.post("/v1/conversations/direct", { userId: a.id }).expect(403)).body),
    ).toBe("cannot_message");
    await a.patch("/v1/me/messaging-preferences", { directMessagesFrom: "everyone" }).expect(200);
    await stranger.post("/v1/conversations/direct", { userId: a.id }).expect(201);

    await b.put(`/v1/me/blocks/${a.id}`).expect(204);
    const blocked = await a
      .post(`/v1/conversations/${conv.id}/messages`, {
        clientMessageId: randomUUID(),
        body: "hello?",
      })
      .expect(403);
    expect(reason(blocked.body)).toBe("cannot_message");
    expect(
      ((await a.get(`/v1/conversations/${conv.id}`).expect(200)).body as ConversationDto).canSend,
    ).toBe(false);
    const history = (await a.get(`/v1/conversations/${conv.id}/messages`).expect(200))
      .body as MessagePage;
    expect(history.items.map((m) => m.seq)).toEqual([1]);
  });

  it("sending is idempotent per clientMessageId and sequences are ordered", async () => {
    const a = await person("d2-a");
    const b = await person("d2-b");
    await befriend(a, b);
    const conv = await direct(a, b);
    const clientMessageId = randomUUID();
    const body = { clientMessageId, body: "Same message twice" };
    const [one, two] = await Promise.all([
      a.post(`/v1/conversations/${conv.id}/messages`, body),
      a.post(`/v1/conversations/${conv.id}/messages`, body),
    ]);
    expect((one.body as MessageDto).id).toBe((two.body as MessageDto).id);
    for (let i = 0; i < 5; i += 1) await say(i % 2 === 0 ? b : a, conv.id, `Message ${String(i)}`);
    const page = (
      await a.get(`/v1/conversations/${conv.id}/messages?after=0&limit=100`).expect(200)
    ).body as MessagePage;
    expect(page.items.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    const older = (
      await a.get(`/v1/conversations/${conv.id}/messages?before=4&limit=2`).expect(200)
    ).body as MessagePage;
    expect(older).toMatchObject({ more: true });
    expect(older.items.map((m) => m.seq)).toEqual([2, 3]);
  });
});

describe("WebSocket delivery", () => {
  it("refuses unauthenticated sockets and invalid tokens; tokens never go in the URL", async () => {
    const noAuth = await Client.open();
    noAuth.send({ type: "subscribe", conversationId: randomUUID(), after: 0 });
    expect(await noAuth.closed).toBe(4401);
    const badToken = await Client.open();
    badToken.send({ type: "auth", token: "x".repeat(40) });
    expect(await badToken.closed).toBe(4401);
    const garbage = await Client.open();
    garbage.ws.send("not json");
    expect(await garbage.closed).toBe(4400);
    // Other upgrade paths are refused.
    const wrong = new WebSocket(`ws://127.0.0.1:${String(port)}/v1/other`);
    await new Promise((resolve) => wrong.once("error", resolve));
  });

  it("delivers live, replays exactly the missed messages after reconnecting, and shares receipts", async () => {
    const a = await person("w1-a");
    const b = await person("w1-b");
    await befriend(a, b);
    const conv = await direct(a, b);
    await say(a, conv.id, "one");
    await say(a, conv.id, "two");

    const bSocket = await Client.signedIn("w1-b");
    const first = await bSocket.subscribe(conv.id, 0);
    expect(first.replay.map((m) => m.body)).toEqual(["one", "two"]);
    expect(first.lastSeq).toBe(2);
    await say(a, conv.id, "three (live)");
    const live = await bSocket.next((f) => f.type === "message");
    expect(live).toMatchObject({
      type: "message",
      replay: false,
      message: { seq: 3, body: "three (live)", sender: { mine: false } },
    });
    await bSocket.close();

    // While B is offline.
    await say(a, conv.id, "four");
    await say(b, conv.id, "five (from B elsewhere)");
    await say(a, conv.id, "six");

    const reconnected = await Client.signedIn("w1-b");
    const resumed = await reconnected.subscribe(conv.id, 3);
    expect(resumed.replay.map((m) => [m.seq, m.body])).toEqual([
      [4, "four"],
      [5, "five (from B elsewhere)"],
      [6, "six"],
    ]);
    expect(resumed.replay.every((m) => m.seq > 3)).toBe(true);
    await say(a, conv.id, "seven");
    expect((await reconnected.next((f) => f.type === "message")) as unknown).toMatchObject({
      message: { seq: 7 },
    });

    // Receipts: B reads over the socket; A sees it live and in the conversation.
    const aSocket = await Client.signedIn("w1-a");
    await aSocket.subscribe(conv.id, 7);
    reconnected.send({ type: "read", conversationId: conv.id, seq: 7 });
    expect(await aSocket.next((f) => f.type === "receipt")).toEqual({
      type: "receipt",
      conversationId: conv.id,
      side: "peer",
      seq: 7,
    });
    expect(
      ((await a.get(`/v1/conversations/${conv.id}`).expect(200)).body as ConversationDto)
        .peerReadSeq,
    ).toBe(7);

    // Receipts off: nothing is shared, in either direction.
    await b.patch("/v1/me/messaging-preferences", { readReceipts: false }).expect(200);
    await say(a, conv.id, "eight");
    reconnected.send({ type: "read", conversationId: conv.id, seq: 8 });
    await quiet();
    expect(aSocket.frames.filter((f) => f.type === "receipt")).toEqual([]);
    expect(
      ((await a.get(`/v1/conversations/${conv.id}`).expect(200)).body as ConversationDto)
        .peerReadSeq,
    ).toBeNull();
    expect(
      (await b.get(`/v1/conversations/${conv.id}`).expect(200)).body as ConversationDto,
    ).toMatchObject({ peerReadSeq: null, unread: 0 });
    await reconnected.close();
    await aSocket.close();
  });

  it("delivers in seq order when events arrive out of order, and fills a gap the bus lost", async () => {
    const a = await person("w2-a");
    const b = await person("w2-b");
    await befriend(a, b);
    const conv = await direct(a, b);
    const bSocket = await Client.signedIn("w2-b");
    await bSocket.subscribe(conv.id, 0);
    const channel = `conversation:${conv.id}`;
    const bus = t.app.get<RealtimeBus>(REALTIME_BUS);

    // Hold the bus events of three sends (concurrent sends can publish in any order).
    const held: unknown[] = [];
    const publish = vi.spyOn(bus, "publish").mockImplementation((ch, payload) => {
      if (ch === channel && (payload as { type: string }).type === "message") held.push(payload);
      return Promise.resolve();
    });
    for (const body of ["one", "two", "three"]) await say(a, conv.id, body);
    publish.mockRestore();
    expect(held).toHaveLength(3);
    const seqOf = (f: ServerFrame) => (f as { message: { seq: number } }).message.seq;

    // "two" arrives before "one": both are delivered, in order.
    await bus.publish(channel, held[1]);
    await bus.publish(channel, held[0]);
    const first = await bSocket.next((f) => f.type === "message");
    const second = await bSocket.next((f) => f.type === "message");
    expect([seqOf(first), seqOf(second)]).toEqual([1, 2]);

    // "three" is never published (lost); "four" arrives live. After a short wait the gap is
    // filled from the database, still in order, with no duplicates.
    const started = Date.now();
    await say(a, conv.id, "four");
    const third = await bSocket.next((f) => f.type === "message");
    const fourth = await bSocket.next((f) => f.type === "message");
    expect([seqOf(third), seqOf(fourth)]).toEqual([3, 4]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(GAP_WAIT_MS - 50);
    await say(a, conv.id, "five");
    expect(seqOf(await bSocket.next((f) => f.type === "message"))).toBe(5);
    await quiet();
    expect(bSocket.frames.filter((f) => f.type === "message")).toEqual([]);
    await bSocket.close();
  });
});

describe("group conversations", () => {
  it("members only; group moderators remove messages; blocked members are filtered", async () => {
    const owner = await person("g1-owner");
    const member = await person("g1-member");
    const troll = await person("g1-troll");
    const outsider = await person("g1-outsider");
    const group = (
      await owner
        .post("/v1/groups", { name: "G1 drivers", kind: "region", locationLabel: "Karoo" })
        .expect(201)
    ).body as { id: string };
    for (const p of [member, troll]) await p.post(`/v1/groups/${group.id}/join`).expect(200);
    const conv = (await member.post("/v1/conversations/group", { groupId: group.id }).expect(201))
      .body as ConversationDto;
    await outsider.post("/v1/conversations/group", { groupId: group.id }).expect(404);
    await outsider.get(`/v1/conversations/${conv.id}/messages`).expect(404);

    const socket = await Client.signedIn("g1-member");
    await socket.subscribe(conv.id);
    const hello = await say(owner, conv.id, "Welcome all");
    expect((await socket.next((f) => f.type === "message")) as unknown).toMatchObject({
      message: { id: hello.id, sender: { userId: owner.id } },
    });
    expect(
      ((await member.get(`/v1/conversations/${conv.id}`).expect(200)).body as ConversationDto)
        .peerReadSeq,
    ).toBeNull();

    const spam = await say(troll, conv.id, "Buy cheap tyres at my shop!!!");
    await member.del(`/v1/conversations/${conv.id}/messages/${spam.id}`).expect(403);
    const removed = (
      await owner.del(`/v1/conversations/${conv.id}/messages/${spam.id}`).expect(200)
    ).body as MessageDto;
    expect(removed).toMatchObject({ status: "removed", body: null });
    expect((await socket.next((f) => f.type === "message_updated")) as unknown).toMatchObject({
      message: { id: spam.id, status: "removed", body: null },
    });
    const audit = await t.db.db.select().from(auditEvents).where(eq(auditEvents.targetId, spam.id));
    expect(audit.map((x) => x.action)).toEqual(["group.message_removed"]);

    // A member's own block hides that person's messages for them.
    await member.put(`/v1/me/blocks/${troll.id}`).expect(204);
    await say(troll, conv.id, "Still here");
    const page = (await member.get(`/v1/conversations/${conv.id}/messages`).expect(200))
      .body as MessagePage;
    expect(page.items.map((m) => m.body)).not.toContain("Still here");

    // Removed from the group: no more access.
    await owner.del(`/v1/groups/${group.id}/members/${troll.id}`).expect(204);
    await troll.get(`/v1/conversations/${conv.id}/messages`).expect(404);
    await troll
      .post(`/v1/conversations/${conv.id}/messages`, {
        clientMessageId: randomUUID(),
        body: "back?",
      })
      .expect(404);
    await socket.close();
  });
});

describe("request-linked conversations", () => {
  it("connect the requester and the recipient provider only; names stay private; closed requests are read-only", async () => {
    const providerOwner = await person("r1-provider");
    const otherOwner = await person("r1-other");
    const customer = await person("r1-customer");
    const p = await publishProvider(providerOwner, {
      slug: "r1-garage",
      at: { lng: 26.5, lat: -28.5 },
    });
    await publishProvider(otherOwner, { slug: "r1-other-garage", at: { lng: 26.51, lat: -28.5 } });
    const req = (
      await customer
        .post("/v1/me/service-requests", {
          clientRequestId: randomUUID(),
          category: "workshop",
          vehicle: { vehicleType: "heavy_truck" },
          location: { lng: 26.5, lat: -28.5 },
          description: "Coolant leak on the highway, need help soon.",
          target: { mode: "direct", providerIds: [p.orgId] },
        })
        .expect(201)
    ).body as ServiceRequestDto;
    const recipientId = req.recipients[0]?.id ?? "";
    const conv = (await customer.post("/v1/conversations/request", { recipientId }).expect(201))
      .body as ConversationDto;
    expect(conv).toMatchObject({ kind: "request", title: "r1-garage org", canSend: true });
    expect(conv.warning).toMatch(/doesn't process payments/);
    const providerView = (
      await providerOwner.post("/v1/conversations/request", { recipientId }).expect(201)
    ).body as ConversationDto;
    expect(providerView).toMatchObject({ id: conv.id, title: "Customer" });
    await otherOwner.post("/v1/conversations/request", { recipientId }).expect(404);
    await otherOwner.get(`/v1/conversations/${conv.id}`).expect(404);

    const q = await say(providerOwner, conv.id, "Can you share a photo of the leak?");
    expect(q.sender).toEqual({ userId: null, name: "r1-garage org", side: "provider", mine: true });
    const seen = (await customer.get(`/v1/conversations/${conv.id}/messages`).expect(200))
      .body as MessagePage;
    expect(seen.items[0]?.sender).toEqual({
      userId: null,
      name: "r1-garage org",
      side: "provider",
      mine: false,
    });
    const answer = await say(customer, conv.id, "Sure, sending one now");
    const asProvider = (
      await providerOwner.get(`/v1/conversations/${conv.id}/messages`).expect(200)
    ).body as MessagePage;
    expect(asProvider.items.find((m) => m.id === answer.id)?.sender).toEqual({
      userId: null,
      name: "Customer",
      side: "requester",
      mine: false,
    });
    expect(JSON.stringify(asProvider)).not.toContain(customer.id);

    await customer
      .post(`/v1/me/service-requests/${req.id}/cancel`, { reason: "Fixed it myself" })
      .expect(200);
    const closed = await customer
      .post(`/v1/conversations/${conv.id}/messages`, {
        clientMessageId: randomUUID(),
        body: "thanks",
      })
      .expect(409);
    expect(reason(closed.body)).toBe("conversation_read_only");
    await customer.get(`/v1/conversations/${conv.id}/messages`).expect(200);
  });
});

describe("attachments", () => {
  async function upload(
    p: Person,
    conversationId: string,
    data: Buffer,
    contentType = "image/png",
  ) {
    const created = (
      await p
        .post(`/v1/conversations/${conversationId}/attachments`, { contentType, size: data.length })
        .expect(201)
    ).body as {
      attachmentId: string;
      upload: { url: string; headers: Record<string, string> };
    };
    await request(t.server)
      .put(new URL(created.upload.url).pathname)
      .set(created.upload.headers)
      .send(data)
      .expect(200);
    return created.attachmentId;
  }

  it("are private to the conversation, scanned and stripped, and single-use", async () => {
    const a = await person("a1-a");
    const b = await person("a1-b");
    const stranger = await person("a1-stranger");
    await befriend(a, b);
    const conv = await direct(a, b);
    const id = await upload(a, conv.id, samplePng("GPSLatitude=-26.2;GPSLongitude=28.0"));
    await stranger.post(`/v1/conversations/${conv.id}/attachments/${id}/complete`).expect(404);
    await a.post(`/v1/conversations/${conv.id}/attachments/${id}/complete`).expect(200);
    // Not sent yet: only the uploader can fetch it.
    await b.get(`/v1/conversations/${conv.id}/attachments/${id}`).expect(404);
    const message = await say(a, conv.id, "Photo of the cracked windscreen", {
      attachmentIds: [id],
    });
    expect(message.attachments).toEqual([
      { id, contentType: "image/png", size: samplePng().length },
    ]);
    const got = await b
      .get(`/v1/conversations/${conv.id}/attachments/${id}`)
      .buffer(true)
      .expect(200);
    expect(Buffer.from(got.body as Buffer).equals(samplePng())).toBe(true);
    expect(got.headers["cache-control"]).toBe("private, no-store");
    await stranger.get(`/v1/conversations/${conv.id}/attachments/${id}`).expect(404);
    expect(
      reason(
        (
          await a
            .post(`/v1/conversations/${conv.id}/messages`, {
              clientMessageId: randomUUID(),
              body: "again",
              attachmentIds: [id],
            })
            .expect(400)
        ).body,
      ),
    ).toBe("attachment_not_ready");
    // Deleted messages take their attachments with them.
    await a.del(`/v1/conversations/${conv.id}/messages/${message.id}`).expect(200);
    await b.get(`/v1/conversations/${conv.id}/attachments/${id}`).expect(404);

    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    const bad = await upload(a, conv.id, samplePng(eicar));
    expect(
      reason(
        (await a.post(`/v1/conversations/${conv.id}/attachments/${bad}/complete`).expect(400)).body,
      ),
    ).toBe("malware_detected");
    await stranger
      .post(`/v1/conversations/${conv.id}/attachments`, { contentType: "image/png", size: 10 })
      .expect(404);
  });
});

describe("abuse controls", () => {
  it("flags payment requests, and lets participants report messages to moderators (audited)", async () => {
    const a = await person("x1-a");
    const b = await person("x1-b");
    const mod = await person("x1-mod");
    await t.db.db.insert(platformStaff).values({ userId: mod.id, role: "trust_safety_moderator" });
    await befriend(a, b);
    const conv = await direct(a, b);
    const scam = await say(
      a,
      conv.id,
      "Pay the deposit to account 6200 1234 5678 first, then I'll come.",
    );
    expect(scam.warnings).toEqual(["payment_request"]);
    expect(
      (await say(a, conv.id, "The bank on Main Road has a truck stop nearby.")).warnings,
    ).toEqual([]);

    await a
      .post(`/v1/conversations/${conv.id}/messages/${scam.id}/report`, { reason: "scam" })
      .expect(400);
    const outsider = await person("x1-outsider");
    await outsider
      .post(`/v1/conversations/${conv.id}/messages/${scam.id}/report`, { reason: "scam" })
      .expect(404);
    await b
      .post("/v1/reports", { targetType: "message", targetId: scam.id, reason: "scam" })
      .expect(404);
    await b
      .post(`/v1/conversations/${conv.id}/messages/${scam.id}/report`, {
        reason: "scam",
        details: "Asked for a deposit.",
      })
      .expect(201);

    const socket = await Client.signedIn("x1-b");
    await socket.subscribe(conv.id, 2);
    const viewed = (await mod.get(`/v1/moderation/messages/${scam.id}`).expect(200))
      .body as ModerationCase;
    expect(viewed).toMatchObject({
      targetType: "message",
      authorUserId: a.id,
      reports: [{ reason: "scam", status: "open" }],
    });
    const hidden = (
      await mod
        .post(`/v1/moderation/messages/${scam.id}/hide`, { reason: "Payment scam" })
        .expect(200)
    ).body as ModerationCase;
    expect(hidden.status).toBe("hidden");
    expect((await socket.next((f) => f.type === "message_updated")) as unknown).toMatchObject({
      message: { id: scam.id, status: "hidden", body: null },
    });
    const page = (await b.get(`/v1/conversations/${conv.id}/messages`).expect(200))
      .body as MessagePage;
    expect(page.items.find((m) => m.id === scam.id)).toMatchObject({
      status: "hidden",
      body: null,
      warnings: [],
    });
    const audit = await t.db.db.select().from(auditEvents).where(eq(auditEvents.targetId, scam.id));
    expect(audit.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        "content_report.created",
        "moderation.message_viewed",
        "moderation.message_hidden",
      ]),
    );
    await socket.close();
  });

  it("muting a conversation stops its push notifications", async () => {
    const a = await person("x2-a");
    const b = await person("x2-b");
    await befriend(a, b);
    const conv = await direct(a, b);
    const muted = (await b.patch(`/v1/conversations/${conv.id}`, { muted: true }).expect(200))
      .body as ConversationDto;
    expect(muted.muted).toBe(true);
    await b.put("/v1/me/devices", { fid: "fid-x2-b-0000000000", platform: "android" }).expect(204);
    const push = t.app.get<RecordingPushSender>(PUSH_SENDER);
    await say(a, conv.id, "You won't get a push for this");
    await t.app.get(OutboxRelay).drain();
    expect(
      push.sent.filter(
        (s) => s.message.data["type"] === "message" && s.fids.includes("fid-x2-b-0000000000"),
      ),
    ).toEqual([]);
  });
});

describe("notifications", () => {
  it("friend requests and messages reach the inbox, the socket and push, respecting opt-outs", async () => {
    const relay = t.app.get(OutboxRelay);
    const push = t.app.get<RecordingPushSender>(PUSH_SENDER);
    await relay.drain();
    const a = await person("n1-a");
    const b = await person("n1-b");
    await b.put("/v1/me/devices", { fid: "fid-n1-b-00000000000", platform: "ios" }).expect(204);
    await b.put("/v1/me/devices", { fid: "fid-n1-b-gone-0000000", platform: "web" }).expect(204);
    push.gone.add("fid-n1-b-gone-0000000");
    await b.put("/v1/me/devices", { fid: "bad token with spaces", platform: "ios" }).expect(400);

    const bSocket = await Client.signedIn("n1-b");
    const sent = (await a.post("/v1/me/friend-requests", { userId: b.id }).expect(201))
      .body as SendFriendRequestResult;
    if (sent.outcome !== "sent") throw new Error("sent");
    expect((await relay.drain()).failed).toBe(0);
    const inbox = (await b.get("/v1/me/inbox").expect(200)).body as InboxDto;
    expect(inbox.unreadNotifications).toBe(1);
    expect(inbox.notifications[0]).toMatchObject({
      kind: "friend_request",
      title: "New friend request",
      body: "n1-a wants to be your friend.",
      data: { userId: a.id },
      readAt: null,
    });
    expect((await bSocket.next((f) => f.type === "notification")) as unknown).toMatchObject({
      notification: { kind: "friend_request" },
    });
    const pushed = push.sent.filter((s) => s.fids.includes("fid-n1-b-00000000000"));
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.message).toMatchObject({
      title: "New friend request",
      data: { type: "friend_request" },
    });
    // The gone installation was cleaned up.
    const remaining = await t.db.db
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.fid, "fid-n1-b-gone-0000000"));
    expect(remaining).toEqual([]);

    // Processing an event twice never notifies twice.
    await t.db.db
      .update(outboxEvents)
      .set({ publishedAt: null })
      .where(sql`${outboxEvents.payload}->>'requestId' = ${sent.request.id}`);
    await relay.drain();
    expect(
      ((await b.get("/v1/me/inbox").expect(200)).body as InboxDto).notifications.filter(
        (n) => n.kind === "friend_request",
      ),
    ).toHaveLength(1);

    await b.post(`/v1/me/friend-requests/${sent.request.id}/accept`).expect(200);
    const conv = await direct(a, b);
    await say(a, conv.id, "Secret load details");
    await relay.drain();
    const messagePush = push.sent.filter(
      (s) => s.message.data["type"] === "message" && s.fids.includes("fid-n1-b-00000000000"),
    );
    expect(messagePush.at(-1)?.message).toMatchObject({ title: "n1-a", body: "New message" });
    expect((await bSocket.next((f) => f.type === "inbox")) as unknown).toEqual({
      type: "inbox",
      conversationId: conv.id,
      lastSeq: 1,
    });

    // Previews on: the text is shown. Messages off: nothing is pushed.
    await b.patch("/v1/me/messaging-preferences", { pushPreviews: true }).expect(200);
    await say(a, conv.id, "Gate code is at reception");
    await relay.drain();
    expect(push.sent.at(-1)?.message.body).toBe("Gate code is at reception");
    await b.patch("/v1/me/messaging-preferences", { pushMessages: false }).expect(200);
    const before = push.sent.length;
    await say(a, conv.id, "No push for this one");
    await relay.drain();
    expect(push.sent.length).toBe(before);

    const unread = (await b.get("/v1/me/inbox").expect(200)).body as InboxDto;
    expect(unread.unreadConversations).toBe(1);
    await b.post("/v1/me/notifications/read-all").expect(204);
    await b.post(`/v1/conversations/${conv.id}/read`, { seq: 99 }).expect(200);
    expect((await b.get("/v1/me/inbox").expect(200)).body).toMatchObject({
      unreadNotifications: 0,
      unreadConversations: 0,
    });
    await b.post("/v1/me/devices/unregister", { fid: "fid-n1-b-00000000000" }).expect(204);
    await bSocket.close();
  });

  it("service request events notify the right side", async () => {
    const relay = t.app.get(OutboxRelay);
    await relay.drain();
    const providerOwner = await person("n2-provider");
    const customer = await person("n2-customer");
    const p = await publishProvider(providerOwner, {
      slug: "n2-garage",
      at: { lng: 27.5, lat: -27.5 },
    });
    const req = (
      await customer
        .post("/v1/me/service-requests", {
          clientRequestId: randomUUID(),
          category: "workshop",
          vehicle: { vehicleType: "heavy_truck" },
          location: { lng: 27.5, lat: -27.5 },
          description: "Gearbox noise when changing down, need advice.",
          target: { mode: "direct", providerIds: [p.orgId] },
        })
        .expect(201)
    ).body as ServiceRequestDto;
    await relay.drain();
    const providerInbox = (await providerOwner.get("/v1/me/inbox").expect(200)).body as InboxDto;
    expect(providerInbox.notifications[0]).toMatchObject({
      kind: "service_request",
      data: { requestId: req.id },
    });
    const inquiry = (
      (await providerOwner.get(`/v1/orgs/${p.orgId}/inquiries`).expect(200)).body as InquiryDto[]
    )[0];
    await providerOwner
      .post(`/v1/orgs/${p.orgId}/inquiries/${inquiry?.recipientId ?? ""}/quotes`, {
        price: { type: "from", currency: "ZAR", amount: "1500", unit: "job" },
      })
      .expect(201);
    await relay.drain();
    const customerInbox = (await customer.get("/v1/me/inbox").expect(200)).body as InboxDto;
    expect(customerInbox.notifications[0]).toMatchObject({
      kind: "quote_received",
      body: "n2-garage org sent you a quote.",
    });
  });
});
