import { randomUUID } from "node:crypto";

import { auditEvents, eq, friendRequests, platformStaff, sql, users } from "@fleettrust/db";
import {
  type EntitlementsResponse,
  type FriendDto,
  type FriendRequestDto,
  type GroupDto,
  type GroupMemberDto,
  type GroupPage,
  type ModerationCase,
  type ModerationQueueItem,
  type MyOrganization,
  type PersonDto,
  type PersonProfile,
  type SendFriendRequestResult,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makePerson, type Person } from "./support/providers.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;
const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };
const DAY = 86_400_000;

beforeAll(async () => {
  t = await createTestApp({ clock });
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
  const me = (await p.patch("/v1/me", { displayName: uid.slice(0, 40) }).expect(200)).body as {
    id: string;
  };
  return { ...p, id: me.id };
}

const people = (prefix: string, n: number) =>
  Promise.all(Array.from({ length: n }, (_, i) => person(`${prefix}-${String(i)}`)));

async function friendUsage(p: Person): Promise<number> {
  const body = (await p.get("/v1/me/entitlements").expect(200)).body as EntitlementsResponse;
  return body.entitlements.find((e) => e.key === "friend_requests.daily")?.used ?? -1;
}

function send(from: Person, to: Member) {
  return from.post("/v1/me/friend-requests", { userId: to.id });
}

async function befriend(a: Member, b: Member) {
  const sent = (await send(a, b).expect(201)).body as SendFriendRequestResult;
  if (sent.outcome !== "sent") throw new Error("expected a sent request");
  await b.post(`/v1/me/friend-requests/${sent.request.id}/accept`).expect(200);
}

describe("friend requests", () => {
  it("send, accept, list; a crossing request accepts instead of sending", async () => {
    const [a, b, c] = await people("f1", 3);
    if (!a || !b || !c) throw new Error("setup");
    const sent = (await send(a, b).expect(201)).body as SendFriendRequestResult;
    expect(sent).toMatchObject({
      outcome: "sent",
      request: { direction: "outgoing", person: { userId: b.id, relationship: "request_sent" } },
    });
    const incoming = (await b.get("/v1/me/friend-requests").expect(200)).body as FriendRequestDto[];
    expect(incoming.map((r) => r.person.userId)).toEqual([a.id]);
    const outgoing = (await a.get("/v1/me/friend-requests?direction=outgoing").expect(200))
      .body as FriendRequestDto[];
    expect(outgoing).toHaveLength(1);

    if (sent.outcome !== "sent") throw new Error("sent");
    await a.post(`/v1/me/friend-requests/${sent.request.id}/accept`).expect(404); // not the recipient
    const friend = (await b.post(`/v1/me/friend-requests/${sent.request.id}/accept`).expect(200))
      .body as FriendDto;
    expect(friend.userId).toBe(a.id);
    expect(
      ((await a.get("/v1/me/friends").expect(200)).body as FriendDto[]).map((f) => f.userId),
    ).toEqual([b.id]);
    await b.post(`/v1/me/friend-requests/${sent.request.id}/accept`).expect(409);
    expect(reason((await send(a, b).expect(409)).body)).toBe("already_friends");

    // c asks a; a then "asks" c: that accepts c's request and uses no quota.
    await send(c, a).expect(201);
    const before = await friendUsage(a);
    const crossed = (await send(a, c).expect(201)).body as SendFriendRequestResult;
    expect(crossed).toMatchObject({ outcome: "accepted", friend: { userId: c.id } });
    expect(await friendUsage(a)).toBe(before);

    await a.del(`/v1/me/friends/${b.id}`).expect(204);
    await a.del(`/v1/me/friends/${b.id}`).expect(404);
  });

  it("declines are silent and start a cooldown; cancels and expiry close requests", async () => {
    const [a, b, c] = await people("f2", 3);
    if (!a || !b || !c) throw new Error("setup");
    const sent = (await send(a, b).expect(201)).body as SendFriendRequestResult;
    if (sent.outcome !== "sent") throw new Error("sent");
    await b.post(`/v1/me/friend-requests/${sent.request.id}/decline`).expect(204);
    expect((await a.get("/v1/me/friend-requests?direction=outgoing").expect(200)).body).toEqual([]);
    expect(reason((await send(a, b).expect(403)).body)).toBe("cannot_send");
    // The other direction is unaffected.
    await send(b, a).expect(201);

    const toC = (await send(a, c).expect(201)).body as SendFriendRequestResult;
    if (toC.outcome !== "sent") throw new Error("sent");
    await a.post(`/v1/me/friend-requests/${toC.request.id}/cancel`).expect(204);
    expect((await c.get("/v1/me/friend-requests").expect(200)).body).toEqual([]);
    await send(a, c).expect(201);

    clock.offsetMs = 31 * DAY;
    try {
      expect((await c.get("/v1/me/friend-requests").expect(200)).body).toEqual([]);
      await send(a, c).expect(201); // the expired request no longer blocks a new one
    } finally {
      clock.offsetMs = 0;
    }
  });
});

describe("daily quota counts only successful outgoing requests", () => {
  it("refused attempts use no quota; the 21st successful request is refused", async () => {
    const sender = await person("q1-sender");
    const blocker = await person("q1-blocker");
    const privateUser = await person("q1-private");
    const friend = await person("q1-friend");
    const decliner = await person("q1-decliner");
    await blocker.put(`/v1/me/blocks/${sender.id}`).expect(204);
    await privateUser.patch("/v1/me/social-settings", { friendRequestsFrom: "nobody" }).expect(200);
    await befriend(friend, sender);
    const declined = (await send(sender, decliner).expect(201)).body as SendFriendRequestResult;
    if (declined.outcome !== "sent") throw new Error("sent");
    await decliner.post(`/v1/me/friend-requests/${declined.request.id}/decline`).expect(204);
    expect(await friendUsage(sender)).toBe(1);

    const failures: [request.Test, number, string | undefined][] = [
      [sender.post("/v1/me/friend-requests", { userId: sender.id }), 400, "cannot_befriend_self"],
      [sender.post("/v1/me/friend-requests", { userId: randomUUID() }), 404, undefined],
      [send(sender, blocker), 403, "cannot_send"],
      [send(sender, privateUser), 403, "cannot_send"],
      [send(sender, friend), 409, "already_friends"],
      [send(sender, decliner), 403, "cannot_send"],
    ];
    for (const [pending, status, why] of failures) {
      const res = await pending.expect(status);
      if (why !== undefined) expect(reason(res.body)).toBe(why);
    }
    expect(await friendUsage(sender)).toBe(1);

    const targets = await people("q1-t", 20);
    const [first] = targets;
    if (!first) throw new Error("setup");
    await send(sender, first).expect(201);
    expect(reason((await send(sender, first).expect(409)).body)).toBe("request_pending");
    expect(await friendUsage(sender)).toBe(2);
    for (const target of targets.slice(1, 19)) await send(sender, target).expect(201);
    expect(await friendUsage(sender)).toBe(20);
    const last = targets[19];
    if (!last) throw new Error("setup");
    const refused = await send(sender, last).expect(403);
    expect(refused.body).toMatchObject({
      reason: "quota_exceeded",
      key: "friend_requests.daily",
      limit: 20,
    });
    expect((await last.get("/v1/me/friend-requests").expect(200)).body).toEqual([]);
    expect(await friendUsage(sender)).toBe(20);
  });

  it("is atomic under concurrent sending", async () => {
    const sender = await person("q2-sender");
    const targets = await people("q2-t", 25);
    const results = await Promise.all(targets.map((target) => send(sender, target)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(20);
    expect(results.filter((r) => r.status === 403)).toHaveLength(5);
    expect(await friendUsage(sender)).toBe(20);
    const outgoing = (await sender.get("/v1/me/friend-requests?direction=outgoing").expect(200))
      .body as FriendRequestDto[];
    expect(outgoing).toHaveLength(20);
  });

  it("caps unanswered outgoing requests", async () => {
    const sender = await person("q3-sender");
    const fillers = await t.db.db
      .insert(users)
      .values(
        Array.from({ length: 50 }, (_, i) => ({
          firebaseUid: `q3-filler-${String(i)}`,
          displayName: "Filler",
        })),
      )
      .returning({ id: users.id });
    await t.db.db.insert(friendRequests).values(
      fillers.map((f) => ({
        senderId: sender.id,
        recipientId: f.id,
        expiresAt: new Date(Date.now() + 10 * DAY),
      })),
    );
    const target = await person("q3-target");
    const res = await send(sender, target).expect(409);
    expect(res.body).toMatchObject({ reason: "too_many_pending", limit: 50 });
    expect(await friendUsage(sender)).toBe(0);
  });
});

describe("blocks", () => {
  it("cut friendships and requests, hide profiles and stop requests and joins", async () => {
    const [a, b, c] = await people("b1", 3);
    if (!a || !b || !c) throw new Error("setup");
    await befriend(a, b);
    await send(c, a).expect(201);
    await a.put(`/v1/me/blocks/${b.id}`).expect(204);
    await a.put(`/v1/me/blocks/${c.id}`).expect(204);
    await a.put(`/v1/me/blocks/${a.id}`).expect(400);

    expect((await a.get("/v1/me/friends").expect(200)).body).toEqual([]);
    expect((await a.get("/v1/me/friend-requests").expect(200)).body).toEqual([]);
    expect(
      ((await a.get("/v1/me/blocks").expect(200)).body as { userId: string }[])
        .map((x) => x.userId)
        .sort(),
    ).toEqual([b.id, c.id].sort());
    // The blocked person can't see the blocker, and gets the same answer as for privacy.
    await b.get(`/v1/people/${a.id}`).expect(404);
    expect(reason((await send(b, a).expect(403)).body)).toBe("cannot_send");
    expect(reason((await send(a, b).expect(403)).body)).toBe("cannot_send");
    expect(
      ((await a.get(`/v1/people/${b.id}`).expect(200)).body as PersonProfile).relationship,
    ).toBe("blocked");

    // Blocked people can't join the blocker's group, and don't appear in its member list.
    const group = (
      await a
        .post("/v1/groups", { name: "B1 drivers", kind: "region", locationLabel: "Karoo" })
        .expect(201)
    ).body as GroupDto;
    expect(reason((await b.post(`/v1/groups/${group.id}/join`).expect(403)).body)).toBe(
      "cannot_join",
    );

    await a.del(`/v1/me/blocks/${b.id}`).expect(204);
    await send(b, a).expect(201);
  });
});

describe("privacy settings", () => {
  it("friends-of-friends requests, opt-in search and friend list visibility", async () => {
    const [owner, mutual, stranger, fof] = await people("p1", 4);
    if (!owner || !mutual || !stranger || !fof) throw new Error("setup");
    expect((await owner.get("/v1/me/social-settings").expect(200)).body).toEqual({
      friendRequestsFrom: "everyone",
      friendListVisibility: "friends",
      discoverable: false,
    });
    await owner
      .patch("/v1/me/social-settings", { friendRequestsFrom: "friends_of_friends" })
      .expect(200);
    await owner.patch("/v1/me/social-settings", {}).expect(400);
    await befriend(owner, mutual);
    await befriend(fof, mutual);
    expect(reason((await send(stranger, owner).expect(403)).body)).toBe("cannot_send");
    const card = (await fof.get(`/v1/people/${owner.id}`).expect(200)).body as PersonProfile;
    expect(card).toMatchObject({
      relationship: "none",
      canSendRequest: true,
      mutualFriends: { count: 1, sample: [{ userId: mutual.id }] },
    });
    expect(
      ((await stranger.get(`/v1/people/${owner.id}`).expect(200)).body as PersonProfile)
        .canSendRequest,
    ).toBe(false);
    await send(fof, owner).expect(201);

    // Search is opt-in.
    const search = async () =>
      ((await stranger.get("/v1/people").query({ q: "p1-" }).expect(200)).body as PersonDto[]).map(
        (p) => p.userId,
      );
    expect(await search()).toEqual([]);
    await owner.patch("/v1/me/social-settings", { discoverable: true }).expect(200);
    expect(await search()).toEqual([owner.id]);
    await stranger.get("/v1/people").query({ q: "p" }).expect(400);

    // Friend lists: friends can see them unless hidden; others never.
    await mutual.get(`/v1/people/${owner.id}/friends`).expect(200);
    await stranger.get(`/v1/people/${owner.id}/friends`).expect(404);
    await owner.patch("/v1/me/social-settings", { friendListVisibility: "only_me" }).expect(200);
    await mutual.get(`/v1/people/${owner.id}/friends`).expect(404);
    expect(
      ((await fof.get(`/v1/people/${owner.id}`).expect(200)).body as PersonProfile).mutualFriends,
    ).toBeNull();
  });
});

describe("groups", () => {
  it("create with the daily quota, search, join, approval, roles, removal, bans", async () => {
    const owner = await person("g1-owner");
    const group = (
      await owner
        .post("/v1/groups", {
          name: "N1 Cape Town to Joburg drivers",
          description: "Road conditions and stops along the N1.",
          kind: "route",
          locationLabel: "N1 Cape Town – Johannesburg",
          location: { lng: 25.0, lat: -30.5 },
          joinPolicy: "approval",
        })
        .expect(201)
    ).body as GroupDto;
    expect(group).toMatchObject({
      kind: "route",
      memberCount: 1,
      membership: { role: "owner", status: "active" },
    });
    const second = await owner
      .post("/v1/groups", { name: "Second group", kind: "specialty", specialty: "tankers" })
      .expect(403);
    expect(second.body).toMatchObject({ reason: "quota_exceeded", key: "groups.daily", limit: 1 });
    await owner.post("/v1/groups", { name: "Bad", kind: "specialty" }).expect(400);

    const found = (
      await request(t.server).get("/v1/groups").query({ q: "cape town", kind: "route" }).expect(200)
    ).body as GroupPage;
    expect(found.items.map((g) => g.id)).toContain(group.id);
    const near = (
      await request(t.server)
        .get("/v1/groups")
        .query({ lng: 25.1, lat: -30.5, radiusKm: 50 })
        .expect(200)
    ).body as GroupPage;
    expect(near.items.map((g) => g.id)).toContain(group.id);
    const far = (
      await request(t.server)
        .get("/v1/groups")
        .query({ lng: 30, lat: -20, radiusKm: 50 })
        .expect(200)
    ).body as GroupPage;
    expect(far.items.map((g) => g.id)).not.toContain(group.id);
    await request(t.server).get(`/v1/groups/${group.slug}`).expect(200);

    const [mod, member, troll, outsider] = await people("g1", 4);
    if (!mod || !member || !troll || !outsider) throw new Error("setup");
    for (const p of [mod, member, troll]) {
      expect(
        ((await p.post(`/v1/groups/${group.id}/join`).expect(200)).body as GroupDto).membership,
      ).toEqual({ role: "member", status: "pending" });
    }
    expect(reason((await mod.post(`/v1/groups/${group.id}/join`).expect(409)).body)).toBe(
      "already_member",
    );
    await mod.get(`/v1/groups/${group.id}/members`).expect(404); // pending isn't a member yet
    const pending = (await owner.get(`/v1/groups/${group.id}/members?status=pending`).expect(200))
      .body as GroupMemberDto[];
    expect(pending).toHaveLength(3);
    for (const p of [mod, member, troll]) {
      await owner.post(`/v1/groups/${group.id}/members/${p.id}/approve`).expect(204);
    }
    await owner
      .patch(`/v1/groups/${group.id}/members/${mod.id}`, { role: "moderator" })
      .expect(204);
    await mod
      .patch(`/v1/groups/${group.id}/members/${member.id}`, { role: "moderator" })
      .expect(403);

    const members = (await member.get(`/v1/groups/${group.id}/members`).expect(200))
      .body as GroupMemberDto[];
    expect(members.map((m) => [m.userId, m.role])).toEqual([
      [owner.id, "owner"],
      [mod.id, "moderator"],
      [member.id, "member"],
      [troll.id, "member"],
    ]);
    await outsider.get(`/v1/groups/${group.id}/members`).expect(404);
    await member.get(`/v1/groups/${group.id}/members?status=pending`).expect(403);

    // Moderators act on members only; members on nobody.
    await member.del(`/v1/groups/${group.id}/members/${troll.id}`).expect(403);
    await mod.del(`/v1/groups/${group.id}/members/${owner.id}`).expect(403);
    await mod.put(`/v1/groups/${group.id}/bans/${troll.id}`).expect(204);
    expect(reason((await troll.post(`/v1/groups/${group.id}/join`).expect(403)).body)).toBe(
      "cannot_join",
    );
    await mod.del(`/v1/groups/${group.id}/bans/${troll.id}`).expect(204);
    await mod.del(`/v1/groups/${group.id}/members/${member.id}`).expect(204);

    // Ownership: the owner can't leave without handing over.
    expect(reason((await owner.post(`/v1/groups/${group.id}/leave`).expect(409)).body)).toBe(
      "owner_must_transfer",
    );
    await owner.patch(`/v1/groups/${group.id}/members/${mod.id}`, { role: "owner" }).expect(204);
    await owner.post(`/v1/groups/${group.id}/leave`).expect(204);
    const mine = (await mod.get("/v1/me/groups").expect(200)).body as GroupDto[];
    expect(mine.find((g) => g.id === group.id)?.membership).toEqual({
      role: "owner",
      status: "active",
    });

    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, group.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "group.created",
        "group.member_approved",
        "group.role_changed",
        "group.member_banned",
        "group.member_unbanned",
        "group.member_removed",
        "group.ownership_transferred",
      ]),
    );

    await mod.post(`/v1/groups/${group.id}/archive`).expect(204);
    await request(t.server).get(`/v1/groups/${group.slug}`).expect(404);
  });

  it("organization-hosted groups use the organization's quota and need groups.host", async () => {
    const owner = await person("g2-owner");
    const org = (await owner.post("/v1/orgs", { kind: "fleet", name: "G2 Fleet" }).expect(201))
      .body as MyOrganization;
    const orgId = org.organization.id;
    const group = (
      await owner
        .post("/v1/groups", {
          name: "G2 Fleet drivers",
          kind: "specialty",
          specialty: "refrigerated",
          organizationId: orgId,
        })
        .expect(201)
    ).body as GroupDto;
    expect(group.host).toEqual({ id: orgId, name: "G2 Fleet" });
    // The owner's personal quota is untouched, so a personal group still works.
    await owner
      .post("/v1/groups", { name: "G2 personal", kind: "region", locationLabel: "Free State" })
      .expect(201);
    const outsider = await person("g2-outsider");
    await outsider
      .post("/v1/groups", {
        name: "Spoof",
        kind: "region",
        locationLabel: "X",
        organizationId: orgId,
      })
      .expect(404);
  });
});

describe("platform moderation of groups and members", () => {
  async function moderator(uid: string) {
    const p = await person(uid);
    await t.db.db.insert(platformStaff).values({ userId: p.id, role: "trust_safety_moderator" });
    return p;
  }

  it("3 reports hide a group until a moderator restores it; member reports reach the queue", async () => {
    const mod = await moderator("m1-mod");
    const creator = await person("m1-creator");
    const group = (
      await creator
        .post("/v1/groups", { name: "M1 group", kind: "region", locationLabel: "Natal" })
        .expect(201)
    ).body as GroupDto;
    expect(
      reason(
        (
          await creator
            .post("/v1/reports", { targetType: "group", targetId: group.id, reason: "spam" })
            .expect(400)
        ).body,
      ),
    ).toBe("own_content");
    for (const reporter of await people("m1-r", 3)) {
      await reporter
        .post("/v1/reports", { targetType: "group", targetId: group.id, reason: "scam" })
        .expect(201);
    }
    await request(t.server).get(`/v1/groups/${group.slug}`).expect(404);
    const restored = (await mod.post(`/v1/moderation/groups/${group.id}/restore`, {}).expect(200))
      .body as ModerationCase;
    expect(restored).toMatchObject({
      status: "active",
      actions: [{ action: "auto_flag" }, { action: "restore", moderatorUserId: mod.id }],
    });
    await request(t.server).get(`/v1/groups/${group.slug}`).expect(200);
    await mod.post(`/v1/moderation/groups/${group.id}/hide`, {}).expect(400);
    await mod
      .post(`/v1/moderation/groups/${group.id}/hide`, { reason: "Scam recruitment" })
      .expect(200);
    await request(t.server).get(`/v1/groups/${group.slug}`).expect(404);

    const reporter = await person("m1-reporter");
    await reporter
      .post("/v1/reports", { targetType: "user", targetId: reporter.id, reason: "spam" })
      .expect(400);
    await reporter
      .post("/v1/reports", {
        targetType: "user",
        targetId: creator.id,
        reason: "impersonation",
        details: "Pretends to be a fleet manager.",
      })
      .expect(201);
    const queue = (await mod.get("/v1/moderation/queue").expect(200)).body as ModerationQueueItem[];
    expect(queue.find((i) => i.targetType === "user" && i.targetId === creator.id)).toMatchObject({
      title: "m1-creator",
      openReports: 1,
      reasons: ["impersonation"],
    });
    const dismissed = (
      await mod.post(`/v1/moderation/users/${creator.id}/dismiss-reports`, {}).expect(200)
    ).body as ModerationCase;
    expect(dismissed.reports.map((r) => r.status)).toEqual(["dismissed"]);
    await creator.get("/v1/moderation/queue").expect(404);
  });
});

describe("privacy of people data", () => {
  it("exposes no email or contact details", async () => {
    const [a, b] = await people("x1", 2);
    if (!a || !b) throw new Error("setup");
    await befriend(a, b);
    const bodies = [
      (await a.get(`/v1/people/${b.id}`).expect(200)).body,
      (await a.get("/v1/me/friends").expect(200)).body,
      (await b.get(`/v1/people/${a.id}/friends`).expect(200)).body,
    ];
    expect(JSON.stringify(bodies)).not.toMatch(/@example\.test|email|phone/i);
    await t.db.db.update(users).set({ status: "suspended" }).where(eq(users.id, b.id));
    await a.get(`/v1/people/${b.id}`).expect(404);
    expect((await a.get("/v1/me/friends").expect(200)).body).toEqual([]);
    await t.db.db
      .update(users)
      .set({ status: "active" })
      .where(sql`${users.id} = ${b.id}`);
  });
});
