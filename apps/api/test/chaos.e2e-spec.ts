import { randomUUID } from "node:crypto";

import { eq, messageAttachments, outboxEvents, sql } from "@fleettrust/db";
import type {
  ConversationDto,
  InboxDto,
  MessageDto,
  SendFriendRequestResult,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { UsersService } from "../src/modules/identity/users.service.js";
import { NotificationsService, OutboxRelay } from "../src/modules/notifications/index.js";
import { KEY_WRAPPER, type KeyWrapper } from "../src/platform/crypto/envelope.js";
import { PUSH_SENDER, type RecordingPushSender } from "../src/platform/push/index.js";
import { MALWARE_SCANNER, type MalwareScanner } from "../src/platform/scanning/malware-scanner.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../src/platform/storage/index.js";
import { samplePng } from "./support/images.js";
import { makePerson, type Person } from "./support/providers.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

/**
 * Chaos and retry tests (Prompt 28). Each test breaks one dependency mid-flow and checks
 * three things: the failure is visible (an error status or a recorded error), nothing is
 * left half-done, and the same request succeeds once the dependency is back.
 *
 * Covered elsewhere: database down or hanging → readiness 503 (readiness.e2e-spec.ts);
 * routing vendor failing or slow → fallback route (routes.e2e-spec.ts); emergency push
 * retries with backoff and email fallback (emergency.e2e-spec.ts).
 */

let t: TestApp;
const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };
const SECOND = 1_000;

beforeAll(async () => {
  t = await createTestApp({ clock });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await t.close();
});

interface Member extends Person {
  id: string;
}

async function person(uid: string): Promise<Member> {
  const p = makePerson(t, uid);
  const me = (await p.patch("/v1/me", { displayName: uid }).expect(200)).body as { id: string };
  return { ...p, id: me.id };
}

async function befriend(a: Member, b: Member): Promise<string> {
  const sent = (await a.post("/v1/me/friend-requests", { userId: b.id }).expect(201))
    .body as SendFriendRequestResult;
  if (sent.outcome !== "sent") throw new Error("expected sent");
  await b.post(`/v1/me/friend-requests/${sent.request.id}/accept`).expect(200);
  return sent.request.id;
}

async function direct(a: Member, b: Member): Promise<ConversationDto> {
  return (await a.post("/v1/conversations/direct", { userId: b.id }).expect(201))
    .body as ConversationDto;
}

async function say(p: Person, conversationId: string, body: string, extra: object = {}) {
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

async function upload(p: Person, conversationId: string, data: Buffer): Promise<string> {
  const created = (
    await p
      .post(`/v1/conversations/${conversationId}/attachments`, {
        contentType: "image/png",
        size: data.length,
      })
      .expect(201)
  ).body as { attachmentId: string; upload: { url: string; headers: Record<string, string> } };
  await request(t.server)
    .put(new URL(created.upload.url).pathname)
    .set(created.upload.headers)
    .send(data)
    .expect(200);
  return created.attachmentId;
}

const attachmentStatus = async (id: string) =>
  (await t.db.db.select().from(messageAttachments).where(eq(messageAttachments.id, id)))[0]?.status;

describe("database under pressure", () => {
  it("answers 503 overloaded with Retry-After when the pool is exhausted, and recovers", async () => {
    const me = await person("c0-a");
    const users = t.app.get(UsersService);
    const poolTimeout = new Error("Failed query: select ...", {
      cause: new Error("timeout exceeded when trying to connect"),
    });
    vi.spyOn(users, "findOrCreate").mockRejectedValueOnce(poolTimeout);
    const busy = await me.get("/v1/me").expect(503);
    expect(busy.headers["retry-after"]).toBe("1");
    expect(busy.body).toMatchObject({ error: "service_unavailable", reason: "overloaded" });
    expect(JSON.stringify(busy.body)).not.toContain("timeout exceeded");
    await me.get("/v1/me").expect(200);

    // A real bug is still a reported 500.
    vi.spyOn(users, "findOrCreate").mockRejectedValueOnce(new Error("unexpected"));
    expect((await me.get("/v1/me").expect(500)).body).toMatchObject({ error: "internal_error" });
  });
});

describe("outbox relay", () => {
  it("backs off after a failed event, keeps the error, and notifies exactly once on retry", async () => {
    const relay = t.app.get(OutboxRelay);
    await relay.drain();
    const a = await person("c1-a");
    const b = await person("c1-b");
    const handle = vi
      .spyOn(t.app.get(NotificationsService), "handle")
      .mockRejectedValueOnce(new Error("simulated database blip"));

    const sent = (await a.post("/v1/me/friend-requests", { userId: b.id }).expect(201))
      .body as SendFriendRequestResult;
    if (sent.outcome !== "sent") throw new Error("expected sent");
    const event = async () =>
      (
        await t.db.db
          .select()
          .from(outboxEvents)
          .where(sql`${outboxEvents.payload}->>'requestId' = ${sent.request.id}`)
      )[0];

    expect(await relay.drain()).toMatchObject({ failed: 1 });
    const failed = await event();
    expect(failed).toMatchObject({
      publishedAt: null,
      attempts: 1,
      lastError: "simulated database blip",
    });
    // Backoff: not retried straight away.
    expect(failed?.availableAt.getTime()).toBeGreaterThan(clock.now().getTime() + 4 * SECOND);
    expect((await relay.drain()).published).toBe(0);
    const inbox = async () =>
      ((await b.get("/v1/me/inbox").expect(200)).body as InboxDto).notifications.filter(
        (n) => n.kind === "friend_request",
      );
    expect(await inbox()).toHaveLength(0);

    clock.offsetMs += 6 * SECOND;
    expect(await relay.drain()).toMatchObject({ failed: 0 });
    expect(handle).toHaveBeenCalledTimes(2);
    expect(await event()).toMatchObject({ attempts: 2, lastError: null });
    expect((await event())?.publishedAt).not.toBeNull();
    expect(await inbox()).toHaveLength(1);
    // A late duplicate run of the same event never notifies twice.
    await relay.drain();
    expect(await inbox()).toHaveLength(1);
  });

  it("a push provider outage doesn't block messages, the inbox or later events", async () => {
    const relay = t.app.get(OutboxRelay);
    const push = t.app.get<RecordingPushSender>(PUSH_SENDER);
    await relay.drain();
    const a = await person("c2-a");
    const b = await person("c2-b");
    await b.put("/v1/me/devices", { fid: "fid-c2-b-00000000000", platform: "android" }).expect(204);
    await befriend(a, b);
    await relay.drain();
    const conv = await direct(a, b);

    push.failNext = 100;
    await say(a, conv.id, "Sent while push is down");
    expect(await relay.drain()).toMatchObject({ failed: 0 });
    expect(((await b.get("/v1/me/inbox").expect(200)).body as InboxDto).unreadConversations).toBe(
      1,
    );
    push.failNext = 0;
    await say(a, conv.id, "Sent after push recovered");
    await relay.drain();
    const pushed = push.sent.filter(
      (s) => s.message.data["type"] === "message" && s.fids.includes("fid-c2-b-00000000000"),
    );
    expect(pushed).toHaveLength(1);
  });
});

describe("attachment completion", () => {
  async function setup(uid: string) {
    const a = await person(`${uid}-a`);
    const b = await person(`${uid}-b`);
    await befriend(a, b);
    const conv = await direct(a, b);
    const id = await upload(a, conv.id, samplePng());
    const complete = () => a.post(`/v1/conversations/${conv.id}/attachments/${id}/complete`);
    return { a, b, conv, id, complete };
  }

  it("object storage failing on write leaves the upload pending, and the retry succeeds", async () => {
    const { a, b, conv, id, complete } = await setup("c3");
    const storage = t.app.get<ObjectStorage>(OBJECT_STORAGE);
    vi.spyOn(storage, "write").mockRejectedValueOnce(new Error("storage unavailable"));
    await complete().expect(500);
    expect(await attachmentStatus(id)).toBe("pending_upload");

    await complete().expect(200);
    expect(await attachmentStatus(id)).toBe("available");
    await say(a, conv.id, "Photo after the storage blip", { attachmentIds: [id] });
    const got = await b
      .get(`/v1/conversations/${conv.id}/attachments/${id}`)
      .buffer(true)
      .expect(200);
    expect(Buffer.from(got.body as Buffer).equals(samplePng())).toBe(true);
  });

  it("the key service failing leaves nothing stored in the clear, and the retry succeeds", async () => {
    const { id, complete } = await setup("c4");
    const storage = t.app.get<ObjectStorage>(OBJECT_STORAGE);
    const write = vi.spyOn(storage, "write");
    vi.spyOn(t.app.get<KeyWrapper>(KEY_WRAPPER), "wrap").mockRejectedValueOnce(
      new Error("KMS deadline exceeded"),
    );
    await complete().expect(500);
    expect(write).not.toHaveBeenCalled();
    expect(await attachmentStatus(id)).toBe("pending_upload");
    await complete().expect(200);
    expect(await attachmentStatus(id)).toBe("available");
  });

  it("the malware scanner failing fails closed, and the retry succeeds", async () => {
    const { id, complete } = await setup("c5");
    vi.spyOn(t.app.get<MalwareScanner>(MALWARE_SCANNER), "scan").mockRejectedValueOnce(
      new Error("clamd connection refused"),
    );
    await complete().expect(500);
    expect(await attachmentStatus(id)).toBe("pending_upload");
    await complete().expect(200);
    expect(await attachmentStatus(id)).toBe("available");
  });
});
