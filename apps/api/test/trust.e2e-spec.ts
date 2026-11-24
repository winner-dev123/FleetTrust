import {
  articleComments,
  articles,
  eq,
  platformStaff,
  users,
  verificationBadges,
  verificationCases,
} from "@fleettrust/db";
import {
  type InboxDto,
  type MemberHistoryDto,
  type ModerationAppealDto,
  type MyPowerUserDto,
  type PlanDto,
  POWER_USER_MEANING,
  type SanctionDto,
  type TrustDashboardDto,
  type UserStatusDto,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { OutboxRelay } from "../src/modules/notifications/index.js";
import { makePerson, type Person } from "./support/providers.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;
/** Lets a test start a suspension in the past, so it has already ended by "now". */
const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };
const DAY = 86_400_000;

beforeAll(async () => {
  t = await createTestApp({ clock });
});

afterAll(async () => {
  await t.close();
});

afterEach(() => {
  clock.offsetMs = 0;
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

async function staff(
  uid: string,
  role: "trust_safety_moderator" | "verification_reviewer" | "billing_operator",
) {
  const p = await person(uid);
  await t.db.db.insert(platformStaff).values({ userId: p.id, role });
  return p;
}

/** An active verified-driver badge, as a verification reviewer would grant it. */
async function verifyIdentity(userId: string, reviewerId: string) {
  const now = new Date();
  const [c] = await t.db.db
    .insert(verificationCases)
    .values({
      subjectType: "user",
      userId,
      badgeType: "driver",
      status: "approved",
      openedBy: userId,
      submittedAt: now,
      decidedAt: now,
      decidedBy: reviewerId,
    })
    .returning();
  if (!c) throw new Error("no case");
  await t.db.db.insert(verificationBadges).values({
    subjectType: "user",
    userId,
    badgeType: "driver",
    caseId: c.id,
    grantedBy: reviewerId,
    grantedAt: now,
    expiresAt: new Date(now.getTime() + 365 * DAY),
  });
}

async function ageAccount(userId: string, days: number) {
  await t.db.db
    .update(users)
    .set({ createdAt: new Date(Date.now() - days * DAY) })
    .where(eq(users.id, userId));
}

let slugN = 0;
/** Published articles and visible comments on different days in the last year. */
async function activity(
  userId: string,
  otherUserId: string,
  articlesCount: number,
  commentsCount: number,
) {
  const ids: string[] = [];
  for (let i = 0; i < articlesCount; i++) {
    const [a] = await t.db.db
      .insert(articles)
      .values({
        authorUserId: userId,
        slug: `trust-article-${String(++slugN)}`,
        status: "published",
        title: `Tyre pressure tips ${String(i)}`,
        body: { type: "doc", content: [] },
        bodyText: "Check pressures cold.",
        category: "maintenance",
        publishedAt: new Date(Date.now() - (10 + i * 7) * DAY),
      })
      .returning();
    if (a) ids.push(a.id);
  }
  const [host] = await t.db.db
    .insert(articles)
    .values({
      authorUserId: otherUserId,
      slug: `trust-host-${String(++slugN)}`,
      status: "published",
      title: "Host article",
      body: { type: "doc", content: [] },
      category: "safety",
      publishedAt: new Date(Date.now() - 200 * DAY),
    })
    .returning();
  for (let i = 0; i < commentsCount; i++) {
    await t.db.db.insert(articleComments).values({
      articleId: host?.id ?? "",
      authorUserId: userId,
      body: `Useful, thanks ${String(i)}`,
      createdAt: new Date(Date.now() - (12 + i * 9) * DAY),
    });
  }
  return ids;
}

/** A member who meets every rule. */
async function qualified(uid: string, reviewerId: string, otherUserId: string) {
  const p = await person(uid);
  await verifyIdentity(p.id, reviewerId);
  await ageAccount(p.id, 200);
  const articleIds = await activity(p.id, otherUserId, 6, 6);
  return { ...p, articleIds };
}

describe("Power User eligibility", () => {
  it("is earned from identity, age, activity and standing, and can't be bought", async () => {
    const reviewer = await staff("pu-reviewer", "verification_reviewer");
    const host = await person("pu-host");

    // A brand-new account: every rule explains what's missing; claiming fails.
    const fresh = await person("pu-fresh");
    const before = (await fresh.get("/v1/me/power-user").expect(200)).body as MyPowerUserDto;
    expect(before).toMatchObject({
      status: "none",
      shown: false,
      eligibility: {
        eligible: false,
        criteria: {
          verifiedIdentity: { met: false },
          accountAge: { met: false },
          activity: { met: false, score: 0 },
          standing: { met: true },
        },
      },
      meaning: POWER_USER_MEANING,
    });
    // No rating, review or plan input exists among the rules.
    expect(Object.keys(before.eligibility.criteria).sort()).toEqual([
      "accountAge",
      "activity",
      "standing",
      "verifiedIdentity",
    ]);
    expect(JSON.stringify(before)).not.toMatch(/rating|review|plan|paid/i);
    expect(reason((await fresh.post("/v1/me/power-user").expect(409)).body)).toBe("not_eligible");

    // Paying for the personal plan changes nothing: not eligibility, not verification.
    const operator = await staff("pu-operator", "billing_operator");
    const catalog = (await operator.get("/v1/admin/billing/plans").expect(200)).body as PlanDto[];
    const plus = catalog
      .find((p) => p.code === "personal-plus")
      ?.versions.find((v) => v.status === "published");
    await operator
      .post("/v1/admin/billing/assignments", {
        subject: { type: "user", id: fresh.id },
        planVersionId: plus?.id ?? "",
        externalReference: "Card payment #PU-1",
      })
      .expect(201);
    const after = (await fresh.get("/v1/me/power-user").expect(200)).body as MyPowerUserDto;
    expect(after.eligibility).toEqual(before.eligibility);
    expect(reason((await fresh.post("/v1/me/power-user").expect(409)).body)).toBe("not_eligible");
    const labels = (await fresh.get(`/v1/verification/labels/users/${fresh.id}`).expect(200))
      .body as {
      labels: { badgeType: string; status: string }[];
    };
    expect(JSON.stringify(labels)).not.toContain('"verified"');

    // Activity alone (one kind, one burst) isn't enough: farming needs several kinds and days.
    const farmer = await person("pu-farmer");
    await verifyIdentity(farmer.id, reviewer.id);
    await ageAccount(farmer.id, 400);
    await activity(farmer.id, host.id, 0, 25);
    const farmed = (await farmer.get("/v1/me/power-user").expect(200)).body as MyPowerUserDto;
    expect(farmed.eligibility.criteria.activity).toMatchObject({ met: false, kinds: 1, score: 25 });

    // Someone who meets every rule claims it; it shows publicly, also to visitors.
    const good = await qualified("pu-good", reviewer.id, host.id);
    const claimed = (await good.post("/v1/me/power-user").expect(200)).body as MyPowerUserDto;
    expect(claimed).toMatchObject({
      status: "active",
      shown: true,
      eligibility: { eligible: true },
    });
    expect(reason((await good.post("/v1/me/power-user").expect(409)).body)).toBe(
      "already_power_user",
    );
    const label = (await request(t.server).get(`/v1/users/${good.id}/status`).expect(200))
      .body as UserStatusDto;
    expect(label).toMatchObject({ powerUser: true, meaning: POWER_USER_MEANING });
    expect(
      (await request(t.server).get(`/v1/users/${fresh.id}/status`).expect(200)).body,
    ).toMatchObject({
      powerUser: false,
    });
    // The label follows the identity badge: an expired badge hides it.
    await t.db.db
      .update(verificationBadges)
      .set({ grantedAt: new Date(Date.now() - 10 * DAY), expiresAt: new Date(Date.now() - DAY) })
      .where(eq(verificationBadges.userId, good.id));
    expect(
      (
        (await request(t.server).get(`/v1/users/${good.id}/status`).expect(200))
          .body as UserStatusDto
      ).powerUser,
    ).toBe(false);
  });
});

describe("sanctions, revocation and appeals", () => {
  it("warns, suspends, revokes and reverses on appeal, decided by a second moderator", async () => {
    const reviewer = await staff("ts-reviewer", "verification_reviewer");
    const mod1 = await staff("ts-mod1", "trust_safety_moderator");
    const mod2 = await staff("ts-mod2", "trust_safety_moderator");
    const host = await person("ts-host");
    const member = await qualified("ts-member", reviewer.id, host.id);
    await member.post("/v1/me/power-user").expect(200);

    // Only moderators sanction; nobody sanctions themselves.
    await member
      .post(`/v1/moderation/users/${host.id}/sanctions`, { kind: "warning", reason: "Spam" })
      .expect(404);
    await reviewer
      .post(`/v1/moderation/users/${host.id}/sanctions`, { kind: "warning", reason: "Spam" })
      .expect(404);
    expect(
      reason(
        (
          await mod1
            .post(`/v1/moderation/users/${mod1.id}/sanctions`, { kind: "warning", reason: "Test" })
            .expect(409)
        ).body,
      ),
    ).toBe("own_account");

    // A warning revokes Power User and breaks standing.
    const warning = (
      await mod1
        .post(`/v1/moderation/users/${member.id}/sanctions`, {
          kind: "warning",
          reason: "Posted a phone scam link.",
        })
        .expect(201)
    ).body as SanctionDto;
    const revoked = (await member.get("/v1/me/power-user").expect(200)).body as MyPowerUserDto;
    expect(revoked).toMatchObject({
      status: "revoked",
      shown: false,
      revokeReason: "Moderation sanction: Posted a phone scam link.",
      eligibility: { eligible: false, criteria: { standing: { met: false } } },
    });
    expect(reason((await member.post("/v1/me/power-user").expect(409)).body)).toBe("not_eligible");

    // Appeals: the deciding moderator can't decide their own decision; a second one overturns.
    const appeal = (
      await member
        .post("/v1/me/appeals", {
          kind: "sanction",
          sanctionId: warning.id,
          statement: "The link was to the official traffic department site.",
        })
        .expect(201)
    ).body as ModerationAppealDto;
    expect(
      reason(
        (
          await member
            .post("/v1/me/appeals", {
              kind: "sanction",
              sanctionId: warning.id,
              statement: "Appealing a second time here.",
            })
            .expect(409)
        ).body,
      ),
    ).toBe("already_appealed");
    const puAppeal = (
      await member
        .post("/v1/me/appeals", {
          kind: "power_user",
          statement: "My status was removed because of the warning.",
        })
        .expect(201)
    ).body as ModerationAppealDto;
    expect(
      reason(
        (
          await mod1
            .post(`/v1/moderation/appeals/${appeal.id}/decide`, {
              outcome: "overturned",
              reason: "Fine",
            })
            .expect(409)
        ).body,
      ),
    ).toBe("own_decision");
    await member
      .post(`/v1/moderation/appeals/${appeal.id}/decide`, { outcome: "overturned", reason: "Fine" })
      .expect(404);
    const overturned = (
      await mod2
        .post(`/v1/moderation/appeals/${appeal.id}/decide`, {
          outcome: "overturned",
          reason: "Official government link.",
        })
        .expect(200)
    ).body as ModerationAppealDto;
    expect(overturned.status).toBe("overturned");
    await mod2
      .post(`/v1/moderation/appeals/${puAppeal.id}/decide`, {
        outcome: "overturned",
        reason: "Warning was overturned.",
      })
      .expect(200);
    const restored = (await member.get("/v1/me/power-user").expect(200)).body as MyPowerUserDto;
    expect(restored).toMatchObject({
      status: "active",
      shown: true,
      eligibility: { criteria: { standing: { met: true } } },
    });

    // Suspension: the member is locked out except for seeing and appealing it.
    const target = await person("ts-target");
    const suspension = (
      await mod1
        .post(`/v1/moderation/users/${target.id}/sanctions`, {
          kind: "suspension",
          reason: "Harassing other members in groups.",
          days: 7,
        })
        .expect(201)
    ).body as SanctionDto;
    expect(
      reason(
        (
          await mod2
            .post(`/v1/moderation/users/${target.id}/sanctions`, {
              kind: "suspension",
              reason: "Again",
            })
            .expect(409)
        ).body,
      ),
    ).toBe("already_suspended");
    expect(reason((await target.get("/v1/me").expect(403)).body)).toBe("account_suspended");
    expect(
      ((await target.get("/v1/me/sanctions").expect(200)).body as SanctionDto[]).map((s) => s.id),
    ).toEqual([suspension.id]);
    const suspensionAppeal = (
      await target
        .post("/v1/me/appeals", {
          kind: "sanction",
          sanctionId: suspension.id,
          statement: "Those messages were sent by someone else using my phone.",
        })
        .expect(201)
    ).body as ModerationAppealDto;
    await mod2
      .post(`/v1/moderation/appeals/${suspensionAppeal.id}/decide`, {
        outcome: "upheld",
        reason: "Pattern over weeks.",
      })
      .expect(200);
    await target.get("/v1/me").expect(403);
    await mod2
      .post(`/v1/moderation/sanctions/${suspension.id}/lift`, {
        reason: "Served enough; final warning.",
      })
      .expect(200);
    await target.get("/v1/me").expect(200);

    // A suspension that has run out ends by itself on the next request.
    const lapsed = await person("ts-lapsed");
    clock.offsetMs = -2 * DAY;
    await mod1
      .post(`/v1/moderation/users/${lapsed.id}/sanctions`, {
        kind: "suspension",
        reason: "Cooling-off period.",
        days: 1,
      })
      .expect(201);
    clock.offsetMs = 0;
    await lapsed.get("/v1/me").expect(200);

    // Notifications to the member.
    const relay = t.app.get(OutboxRelay);
    await relay.drain();
    const kinds = (
      (await member.get("/v1/me/inbox").expect(200)).body as InboxDto
    ).notifications.map((n) => n.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["account_sanctioned", "power_user", "appeal_decided"]),
    );

    // A moderator can also revoke Power User directly, with a reason.
    await mod1.post(`/v1/moderation/power-users/${member.id}/revoke`, {}).expect(400);
    const history = (
      await mod1
        .post(`/v1/moderation/power-users/${member.id}/revoke`, {
          reason: "Coordinated vote farming in groups.",
        })
        .expect(200)
    ).body as MemberHistoryDto;
    expect(history.powerUser).toBe("revoked");
    expect(
      reason(
        (
          await mod1
            .post(`/v1/moderation/power-users/${member.id}/revoke`, { reason: "Again" })
            .expect(409)
        ).body,
      ),
    ).toBe("not_revocable");
    expect(history.sanctions.map((s) => [s.kind, s.overturned])).toEqual([["warning", true]]);
    expect(history.appeals.map((a) => [a.kind, a.status])).toEqual(
      expect.arrayContaining([
        ["sanction", "overturned"],
        ["power_user", "overturned"],
      ]),
    );
    expect(history.audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "power_user.granted",
        "moderation.user_warned",
        "power_user.revoked",
        "moderation.user_appeal_overturned",
        "power_user.reinstated",
      ]),
    );
  });

  it("restores hidden content when a content appeal is overturned", async () => {
    const mod1 = await staff("ca-mod1", "trust_safety_moderator");
    const mod2 = await staff("ca-mod2", "trust_safety_moderator");
    const author = await person("ca-author");
    const host = await person("ca-host");
    const [articleId] = await activity(author.id, host.id, 1, 0);
    await mod1
      .post(`/v1/moderation/articles/${articleId ?? ""}/hide`, { reason: "Looks like an advert." })
      .expect(200);
    const history = (await mod1.get(`/v1/moderation/users/${author.id}/history`).expect(200))
      .body as MemberHistoryDto;
    const action = history.contentActions.find((a) => a.action === "hide");
    expect(action).toBeDefined();
    // Someone else can't appeal it.
    await host
      .post("/v1/me/appeals", {
        kind: "content",
        moderationActionId: action?.id,
        statement: "This is not my article but still.",
      })
      .expect(404);
    const appeal = (
      await author
        .post("/v1/me/appeals", {
          kind: "content",
          moderationActionId: action?.id,
          statement: "It's a how-to article, not an advert for any product.",
        })
        .expect(201)
    ).body as ModerationAppealDto;
    expect(appeal.target).toEqual({ type: "article", id: articleId });
    await mod2
      .post(`/v1/moderation/appeals/${appeal.id}/decide`, {
        outcome: "overturned",
        reason: "Informational.",
      })
      .expect(200);
    const [row] = await t.db.db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId ?? ""));
    expect(row?.status).toBe("published");
  });
});

describe("shared trust and safety dashboard", () => {
  it("is shared by moderators and verification reviewers, and hidden from everyone else", async () => {
    const mod = await staff("db-mod", "trust_safety_moderator");
    const reviewer = await staff("db-reviewer", "verification_reviewer");
    const operator = await staff("db-operator", "billing_operator");
    const member = await person("db-member");
    const reporter = await person("db-reporter");
    await reporter
      .post("/v1/reports", { targetType: "user", targetId: member.id, reason: "harassment" })
      .expect(201);
    await mod
      .post(`/v1/moderation/users/${member.id}/sanctions`, {
        kind: "suspension",
        reason: "Harassment.",
      })
      .expect(201);

    const dash = (await mod.get("/v1/trust-safety/dashboard").expect(200))
      .body as TrustDashboardDto;
    expect(dash.members.activeSuspensions).toBeGreaterThanOrEqual(1);
    expect(dash.reports.last14Days).toHaveLength(14);
    expect(dash.reports.last14Days.at(-1)?.count).toBeGreaterThanOrEqual(1);
    expect(dash.recentActions.map((a) => a.action)).toContain("moderation.user_suspended");
    await reviewer.get("/v1/trust-safety/dashboard").expect(200);
    await operator.get("/v1/trust-safety/dashboard").expect(404);
    await reporter.get("/v1/trust-safety/dashboard").expect(404);
    await request(t.server).get("/v1/trust-safety/dashboard").expect(401);
    // Reviewers see the dashboard but can't sanction or read member histories.
    await reviewer.get(`/v1/moderation/users/${member.id}/history`).expect(404);

    // The member's history: the report was resolved by the sanction.
    const history = (await mod.get(`/v1/moderation/users/${member.id}/history`).expect(200))
      .body as MemberHistoryDto;
    expect(history).toMatchObject({ status: "suspended", reportsAgainst: 1 });
    expect(history.sanctions[0]).toMatchObject({ kind: "suspension", endsAt: null });
  });
});
