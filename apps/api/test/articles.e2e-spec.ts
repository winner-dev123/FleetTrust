import {
  auditEvents,
  contentReports,
  eq,
  moderationActions,
  platformStaff,
  sql,
  users,
} from "@fleettrust/db";
import {
  type ArticleCommentDto,
  type ArticlePage,
  type ArticleSummary,
  COMMUNITY_CONTENT_LABEL,
  type CommentList,
  type EntitlementsResponse,
  type ModerationCase,
  type ModerationQueueItem,
  type MyArticle,
  type MyOrganization,
  type PublicArticle,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { samplePng } from "./support/images.js";
import { makePerson, type Person } from "./support/providers.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

const reason = (body: unknown) => (body as { reason?: string }).reason;

interface Author extends Person {
  id: string;
}

/** A signed-in user with a display name. Established accounts are 30 days old. */
async function person(uid: string, options: { established?: boolean } = {}): Promise<Author> {
  const p = makePerson(t, uid);
  const me = (await p.patch("/v1/me", { displayName: uid.slice(0, 40) }).expect(200)).body as {
    id: string;
  };
  if (options.established ?? true) {
    await t.db.db
      .update(users)
      .set({ createdAt: sql`now() - interval '30 days'` })
      .where(eq(users.id, me.id));
  }
  return { ...p, id: me.id };
}

async function moderator(uid: string): Promise<Author> {
  const p = await person(uid);
  await t.db.db.insert(platformStaff).values({ userId: p.id, role: "trust_safety_moderator" });
  return p;
}

const paragraph = (text: string, marks?: object[]) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});
const doc = (...content: object[]) => ({ type: "doc", content });
const LONG = "Check tyre pressures cold, before the first trip of the day, every day.";

async function draft(p: Person, extra: object = {}): Promise<MyArticle> {
  return (
    await p
      .post("/v1/me/articles", {
        title: "Pre-trip tyre checks",
        body: doc(paragraph(LONG)),
        category: "maintenance",
        tags: ["tyres", "pre-trip"],
        ...extra,
      })
      .expect(201)
  ).body as MyArticle;
}

async function published(p: Person, extra: object = {}): Promise<MyArticle> {
  const created = await draft(p, extra);
  return (await p.post(`/v1/me/articles/${created.id}/publish`).expect(200)).body as MyArticle;
}

async function articleUsage(p: Person, path = "/v1/me/entitlements"): Promise<number> {
  const body = (await p.get(path).expect(200)).body as EntitlementsResponse;
  return body.entitlements.find((e) => e.key === "articles.daily")?.used ?? -1;
}

describe("rich-text sanitisation (XSS)", () => {
  it("refuses HTML, unknown nodes and attributes", async () => {
    const p = await person("x1-author");
    const bodies = [
      "<p>hello</p>",
      { type: "doc", content: [{ type: "html", value: "<script>alert(1)</script>" }] },
      { type: "doc", content: [{ type: "paragraph", attrs: { style: "x" }, content: [] }] },
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "x", onclick: "alert(1)" }] },
        ],
      },
      { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [] }] },
      { type: "doc", content: [{ type: "iframe", attrs: { src: "https://evil.example" } }] },
    ];
    for (const body of bodies) {
      const res = await p.post("/v1/me/articles", { title: "Test", body }).expect(400);
      expect((res.body as { error: string }).error).toBe("validation_failed");
    }
  });

  it("refuses dangerous link targets, including obfuscated ones", async () => {
    const p = await person("x2-author");
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "//evil.example/path",
      "/relative",
      "https://user:pass@evil.example/",
      "https://evil.example/‮gnp.exe",
    ]) {
      await p
        .post("/v1/me/articles", {
          title: "Links",
          body: doc(paragraph("click", [{ type: "link", attrs: { href } }])),
        })
        .expect(400);
    }
  });

  it("escapes markup in text, alt text and titles; links are nofollow", async () => {
    const p = await person("x3-author");
    const evil = `<script>alert(1)</script><img src=x onerror=alert(1)> "quoted" 'single' & more text here`;
    const created = await published(p, {
      title: `<b>Bold</b> title <script>x</script>`,
      summary: `<img src=x onerror=alert(1)>`,
      body: doc(
        paragraph(evil),
        paragraph("A useful link", [
          { type: "bold" },
          { type: "link", attrs: { href: "https://example.org/a?b=1&c=<2>" } },
        ]),
        {
          type: "codeBlock",
          content: [{ type: "text", text: "</code><script>alert(2)</script>" }],
        },
      ),
    });
    expect(created.status).toBe("published");
    const article = (await request(t.server).get(`/v1/articles/${created.slug}`).expect(200))
      .body as PublicArticle;
    expect(article.html).not.toMatch(/<script/i);
    expect(article.html).not.toMatch(/<img/i);
    expect(article.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(article.html).toContain("&quot;quoted&quot; &#39;single&#39; &amp;");
    expect(article.html).toContain(
      '<a href="https://example.org/a?b=1&amp;c=%3C2%3E" rel="nofollow ugc noopener noreferrer" target="_blank"><strong>A useful link</strong></a>',
    );
    expect(article.html).toContain("&lt;/code&gt;&lt;script&gt;alert(2)&lt;/script&gt;");
    // Plain-text fields are returned as text for clients to render as text.
    expect(article.title).toBe("<b>Bold</b> title <script>x</script>");
    expect(article.label).toBe(COMMUNITY_CONTENT_LABEL);
  });

  it("refuses control and bidi characters in titles", async () => {
    const p = await person("x4-author");
    await p.post("/v1/me/articles", { title: "Safe‮txt.exe" }).expect(400);
    await p.post("/v1/me/articles", { title: "Bell\u0007" }).expect(400);
  });
});

describe("article images", () => {
  async function upload(p: Person, data: Buffer, contentType = "image/png") {
    const created = (
      await p.post("/v1/article-images", { contentType, size: data.length }).expect(201)
    ).body as { imageId: string; upload: { url: string; headers: Record<string, string> } };
    await request(t.server)
      .put(new URL(created.upload.url).pathname)
      .set(created.upload.headers)
      .send(data)
      .expect(200);
    return {
      id: created.imageId,
      complete: () => p.post(`/v1/article-images/${created.imageId}/complete`),
    };
  }

  it("strips metadata, publishes processed images and renders them", async () => {
    const p = await person("img1-author");
    const image = await upload(p, samplePng("GPSLatitude=-27.0;GPSLongitude=29.0"));
    const done = (await image.complete().expect(200)).body as { id: string; url: string };
    const served = await request(t.server).get(new URL(done.url).pathname).expect(200);
    expect(Buffer.from(served.body as Buffer).equals(samplePng())).toBe(true);
    expect(Buffer.from(served.body as Buffer).toString("latin1")).not.toContain("GPSLatitude");

    const article = await published(p, {
      coverImageId: image.id,
      body: doc(paragraph(LONG), {
        type: "image",
        attrs: { imageId: image.id, alt: `"><script>alert(1)</script>` },
      }),
    });
    expect(article.coverImage).toEqual({ id: image.id, url: done.url });
    expect(article.html).toContain(
      `<img src="${done.url}" alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" loading="lazy">`,
    );
  });

  it("rejects malware and mismatched types; others' and unfinished uploads can't be used", async () => {
    const p = await person("img2-author");
    const other = await person("img2-other");
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    const infected = await upload(p, samplePng(eicar));
    expect(reason((await infected.complete().expect(400)).body)).toBe("malware_detected");
    const fake = await upload(p, Buffer.from("<svg onload=alert(1)>not an image</svg>"));
    expect(reason((await fake.complete().expect(400)).body)).toBe("content_type_mismatch");
    await p.post("/v1/article-images", { contentType: "image/svg+xml", size: 100 }).expect(400);

    const pending = await upload(p, samplePng());
    const notMine = await upload(other, samplePng());
    await notMine.complete().expect(200);
    for (const id of [pending.id, notMine.id, infected.id]) {
      const res = await p.post("/v1/me/articles", { title: "Img", coverImageId: id }).expect(400);
      expect(reason(res.body)).toBe("image_not_ready");
    }
    // An image used in one article can't move to another.
    await pending.complete().expect(200);
    await draft(p, { coverImageId: pending.id });
    expect(
      reason(
        (await p.post("/v1/me/articles", { title: "Again", coverImageId: pending.id }).expect(400))
          .body,
      ),
    ).toBe("image_not_ready");
  });
});

describe("article quota", () => {
  it("uses one articles.daily unit per article on first publication only", async () => {
    const p = await person("q1-author");
    const a = await draft(p);
    const b = await draft(p);
    const c = await draft(p);
    expect(await articleUsage(p)).toBe(0); // drafts are free
    await p.post(`/v1/me/articles/${a.id}/publish`).expect(200);
    await p.post(`/v1/me/articles/${b.id}/publish`).expect(200);
    expect(await articleUsage(p)).toBe(2);
    const blocked = await p.post(`/v1/me/articles/${c.id}/publish`).expect(403);
    expect(blocked.body).toMatchObject({
      reason: "quota_exceeded",
      key: "articles.daily",
      limit: 2,
    });
    // Unpublishing and publishing again doesn't use another unit.
    await p.post(`/v1/me/articles/${a.id}/unpublish`).expect(200);
    await p.post(`/v1/me/articles/${a.id}/publish`).expect(200);
    expect(await articleUsage(p)).toBe(2);
    expect(((await p.get(`/v1/me/articles/${c.id}`).expect(200)).body as MyArticle).status).toBe(
      "draft",
    );
  });

  it("is atomic under concurrent publishing", async () => {
    const p = await person("q2-author");
    const drafts = await Promise.all([1, 2, 3, 4, 5].map(() => draft(p)));
    const results = await Promise.all(drafts.map((d) => p.post(`/v1/me/articles/${d.id}/publish`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.status === 403)).toHaveLength(3);
    expect(await articleUsage(p)).toBe(2);
  });

  it("organization articles use the organization's quota and need articles.publish", async () => {
    const owner = await person("q3-owner");
    const org = (await owner.post("/v1/orgs", { kind: "provider", name: "Q3 Garage" }).expect(201))
      .body as MyOrganization;
    const orgId = org.organization.id;
    const article = await published(owner, { organizationId: orgId });
    expect(article.organizationId).toBe(orgId);
    expect(await articleUsage(owner, `/v1/orgs/${orgId}/entitlements`)).toBe(1);
    expect(await articleUsage(owner)).toBe(0);
    const pub = (await request(t.server).get(`/v1/articles/${article.slug}`).expect(200))
      .body as PublicArticle;
    expect(pub.author).toEqual({
      displayName: "q3-owner",
      organization: { id: orgId, name: "Q3 Garage" },
    });

    const outsider = await person("q3-outsider");
    await outsider.post("/v1/me/articles", { title: "Spoof", organizationId: orgId }).expect(404);
  });
});

describe("moderation flow", () => {
  it("new accounts are moderated first; approval is audited and append-only", async () => {
    const mod = await moderator("m1-mod");
    const newbie = await person("m1-new", { established: false });
    const article = await published(newbie);
    expect(article.status).toBe("pending_moderation");
    await request(t.server).get(`/v1/articles/${article.slug}`).expect(404);

    // Only moderators can see the queue (everyone else gets 404).
    await newbie.get("/v1/moderation/queue").expect(404);
    const queue = (await mod.get("/v1/moderation/queue").expect(200)).body as ModerationQueueItem[];
    expect(queue.find((i) => i.targetId === article.id)).toMatchObject({
      targetType: "article",
      status: "pending_moderation",
      openReports: 0,
    });

    const decided = (
      await mod.post(`/v1/moderation/articles/${article.id}/approve`, {}).expect(200)
    ).body as ModerationCase;
    expect(decided.status).toBe("published");
    expect(decided.actions).toMatchObject([
      { action: "approve", moderatorUserId: mod.id, reason: null },
    ]);
    await request(t.server).get(`/v1/articles/${article.slug}`).expect(200);
    await mod.post(`/v1/moderation/articles/${article.id}/approve`, {}).expect(409);

    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, article.id));
    expect(audit.map((a) => a.action)).toContain("moderation.article_approved");
    expect(audit.find((a) => a.action === "moderation.article_approved")).toMatchObject({
      actorType: "admin",
      actorId: mod.id,
    });
    await expect(
      t.db.db
        .update(moderationActions)
        .set({ reason: "rewritten" })
        .where(eq(moderationActions.targetId, article.id)),
    ).rejects.toThrow();
    await expect(
      t.db.db.delete(moderationActions).where(eq(moderationActions.targetId, article.id)),
    ).rejects.toThrow();
  });

  it("rejection returns the article to its author with the reason", async () => {
    const mod = await moderator("m2-mod");
    const newbie = await person("m2-new", { established: false });
    const article = await published(newbie);
    await mod.post(`/v1/moderation/articles/${article.id}/reject`, {}).expect(400); // reason required
    await mod
      .post(`/v1/moderation/articles/${article.id}/reject`, { reason: "Promotional content" })
      .expect(200);
    const mine = (await newbie.get(`/v1/me/articles/${article.id}`).expect(200)).body as MyArticle;
    expect(mine).toMatchObject({ status: "rejected", moderationNote: "Promotional content" });
    const edited = (
      await newbie.patch(`/v1/me/articles/${article.id}`, { title: "Pre-trip checks" }).expect(200)
    ).body as MyArticle;
    expect(edited).toMatchObject({ status: "draft", moderationNote: null });
    const again = (await newbie.post(`/v1/me/articles/${article.id}/publish`).expect(200))
      .body as MyArticle;
    expect(again.status).toBe("pending_moderation");
    expect(await articleUsage(newbie)).toBe(1);
  });

  it("recent rejections put an established author back into pre-moderation", async () => {
    const mod = await moderator("m3-mod");
    const author = await person("m3-author");
    const first = await published(author);
    expect(first.status).toBe("published");
    await mod
      .post(`/v1/moderation/articles/${first.id}/hide`, { reason: "Spam links" })
      .expect(200);
    expect((await published(author)).status).toBe("pending_moderation");
  });

  it("moderators can't decide on their own content", async () => {
    const mod = await moderator("m4-mod");
    await t.db.db
      .update(users)
      .set({ createdAt: sql`now()` })
      .where(eq(users.id, mod.id));
    const own = await published(mod);
    expect(own.status).toBe("pending_moderation");
    expect(
      reason((await mod.post(`/v1/moderation/articles/${own.id}/approve`, {}).expect(409)).body),
    ).toBe("own_content");
  });

  it("drafts are private, even to moderators", async () => {
    const mod = await moderator("m5-mod");
    const author = await person("m5-author");
    const d = await draft(author);
    await mod.get(`/v1/moderation/articles/${d.id}`).expect(404);
    await request(t.server).get(`/v1/articles/${d.slug}`).expect(404);
  });
});

describe("reports", () => {
  it("three reports take an article down until a moderator decides; hide and restore are audited", async () => {
    const mod = await moderator("r1-mod");
    const author = await person("r1-author");
    const article = await published(author);
    const reporters = await Promise.all(["r1-a", "r1-b", "r1-c"].map((u) => person(u)));

    expect(
      reason(
        (
          await author
            .post("/v1/reports", { targetType: "article", targetId: article.id, reason: "spam" })
            .expect(400)
        ).body,
      ),
    ).toBe("own_content");
    const [first, second, third] = reporters;
    if (!first || !second || !third) throw new Error("reporters missing");
    await first
      .post("/v1/reports", { targetType: "article", targetId: article.id, reason: "spam" })
      .expect(201);
    expect(
      reason(
        (
          await first
            .post("/v1/reports", { targetType: "article", targetId: article.id, reason: "scam" })
            .expect(409)
        ).body,
      ),
    ).toBe("already_reported");
    await second
      .post("/v1/reports", {
        targetType: "article",
        targetId: article.id,
        reason: "defamation",
        details: "Names a workshop and accuses it of fraud.",
      })
      .expect(201);
    await request(t.server).get(`/v1/articles/${article.slug}`).expect(200);
    await third
      .post("/v1/reports", { targetType: "article", targetId: article.id, reason: "spam" })
      .expect(201);
    // Auto-flagged: out of public view.
    await request(t.server).get(`/v1/articles/${article.slug}`).expect(404);

    const queue = (await mod.get("/v1/moderation/queue").expect(200)).body as ModerationQueueItem[];
    const item = queue.find((i) => i.targetId === article.id);
    expect(item).toMatchObject({ status: "pending_moderation", openReports: 3 });
    expect([...(item?.reasons ?? [])].sort()).toEqual(["defamation", "spam"]);

    await mod.post(`/v1/moderation/articles/${article.id}/hide`, {}).expect(400);
    const hidden = (
      await mod
        .post(`/v1/moderation/articles/${article.id}/hide`, { reason: "Defamatory claims" })
        .expect(200)
    ).body as ModerationCase;
    expect(hidden.status).toBe("hidden");
    expect(hidden.reports.map((r) => r.status)).toEqual(["actioned", "actioned", "actioned"]);
    expect(hidden.actions.map((a) => [a.action, a.moderatorUserId])).toEqual([
      ["auto_flag", null],
      ["hide", mod.id],
    ]);
    expect(
      reason(
        (await author.patch(`/v1/me/articles/${article.id}`, { title: "Sneaky edit" }).expect(409))
          .body,
      ),
    ).toBe("article_hidden");
    expect(
      ((await author.get(`/v1/me/articles/${article.id}`).expect(200)).body as MyArticle)
        .moderationNote,
    ).toBe("Defamatory claims");

    const restored = (
      await mod
        .post(`/v1/moderation/articles/${article.id}/restore`, { reason: "Appeal upheld" })
        .expect(200)
    ).body as ModerationCase;
    expect(restored.status).toBe("published");
    await request(t.server).get(`/v1/articles/${article.slug}`).expect(200);
    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, article.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "content_report.created",
        "moderation.article_auto_flagged",
        "moderation.article_hidden",
        "moderation.article_restored",
      ]),
    );
  });

  it("reported comments are hidden at the threshold; moderators restore or dismiss", async () => {
    const mod = await moderator("r2-mod");
    const author = await person("r2-author");
    const commenter = await person("r2-commenter");
    const article = await published(author);
    const comment = (
      await commenter
        .post(`/v1/articles/${article.id}/comments`, { body: "Useful, thanks." })
        .expect(201)
    ).body as ArticleCommentDto;
    for (const uid of ["r2-a", "r2-b", "r2-c"]) {
      const p = await person(uid);
      await p
        .post("/v1/reports", {
          targetType: "article_comment",
          targetId: comment.id,
          reason: "harassment",
        })
        .expect(201);
    }
    const list = (await request(t.server).get(`/v1/articles/${article.slug}/comments`).expect(200))
      .body as CommentList;
    expect(list.items).toHaveLength(0);
    const restored = (
      await mod.post(`/v1/moderation/comments/${comment.id}/restore`, {}).expect(200)
    ).body as ModerationCase;
    expect(restored.status).toBe("visible");
    expect(restored.reports.every((r) => r.status === "dismissed")).toBe(true);

    // A single report can be dismissed without changing the content.
    const p = await person("r2-d");
    await p
      .post("/v1/reports", { targetType: "article_comment", targetId: comment.id, reason: "spam" })
      .expect(201);
    await mod.post(`/v1/moderation/comments/${comment.id}/dismiss-reports`, {}).expect(200);
    await mod.post(`/v1/moderation/comments/${comment.id}/dismiss-reports`, {}).expect(409);
    const open = await t.db.db
      .select()
      .from(contentReports)
      .where(eq(contentReports.targetId, comment.id));
    expect(open.every((r) => r.status !== "open")).toBe(true);
  });

  it("only public content can be reported", async () => {
    const author = await person("r3-author");
    const reporter = await person("r3-reporter");
    const d = await draft(author);
    await reporter
      .post("/v1/reports", { targetType: "article", targetId: d.id, reason: "spam" })
      .expect(404);
    await request(t.server)
      .post("/v1/reports")
      .send({ targetType: "article", targetId: d.id, reason: "spam" })
      .expect(401);
  });
});

describe("articles can't become rating data", () => {
  it("refuses rating-like text in titles, bodies and comments", async () => {
    const p = await person("rt1-author");
    for (const body of [
      { title: "Best workshop in town, 5 stars" },
      { title: "Review", body: doc(paragraph("Service: ★★★★☆")) },
      { title: "Visit", summary: "I'd give them 2/10 stars" },
      { title: "Visit", body: doc(paragraph("Overall rated 3 out of 5.")) },
    ]) {
      const res = await p.post("/v1/me/articles", body).expect(400);
      expect(reason(res.body)).toBe("rating_content");
    }
    // Score fields don't exist: strict schemas refuse them.
    for (const field of ["rating", "stars", "score", "providerId"]) {
      await p.post("/v1/me/articles", { title: "Fields", [field]: 5 }).expect(400);
    }
    const article = await published(p);
    const res = await p
      .post(`/v1/articles/${article.id}/comments`, { body: "Score: 4/5 for this place" })
      .expect(400);
    expect(reason(res.body)).toBe("rating_content");
  });

  it("exposes no score, vote or popularity fields", async () => {
    const p = await person("rt2-author");
    const article = await published(p);
    const reader = await person("rt2-reader");
    await reader.put(`/v1/me/bookmarks/articles/${article.id}`).expect(204);
    const pub = await request(t.server).get(`/v1/articles/${article.slug}`).expect(200);
    const page = await request(t.server).get("/v1/articles").expect(200);
    const keys = JSON.stringify([pub.body, page.body]).match(/"[a-zA-Z]+":/g) ?? [];
    expect(keys.filter((k) => /rating|score|star|vote|like|bookmark|views/i.test(k))).toEqual([]);
  });
});

describe("link limits (AB-06)", () => {
  it("new accounts can add few links; established accounts more", async () => {
    const newbie = await person("l1-new", { established: false });
    const links = ["https://a.example", "https://b.example", "https://c.example"].map((href) =>
      paragraph(href, [{ type: "link", attrs: { href } }]),
    );
    const res = await newbie
      .post("/v1/me/articles", { title: "Links", body: doc(...links) })
      .expect(400);
    expect(res.body).toMatchObject({ reason: "too_many_links", limit: 2 });
    // Plain-text URLs count too.
    await newbie
      .post("/v1/me/articles", {
        title: "Links",
        body: doc(paragraph("see https://a.example and www.b.example and https://c.example")),
      })
      .expect(400);

    const established = await person("l1-old");
    const article = await published(established, { body: doc(paragraph(LONG), ...links) });
    expect(article.status).toBe("published");

    const comment = await newbie
      .post(`/v1/articles/${article.id}/comments`, { body: "More at https://spam.example" })
      .expect(400);
    expect(reason(comment.body)).toBe("too_many_links");
    await established
      .post(`/v1/articles/${article.id}/comments`, { body: "Source: https://gov.example/rules" })
      .expect(201);
  });
});

describe("comments", () => {
  it("supports one level of replies, edits and removal by the author", async () => {
    const author = await person("c1-author");
    const a = await person("c1-a");
    const b = await person("c1-b");
    const article = await published(author);
    const top = (
      await a
        .post(`/v1/articles/${article.id}/comments`, { body: "Do you check spares too?" })
        .expect(201)
    ).body as ArticleCommentDto;
    const reply = (
      await author
        .post(`/v1/articles/${article.id}/comments`, { body: "Yes, weekly.", parentId: top.id })
        .expect(201)
    ).body as ArticleCommentDto;
    expect(
      reason(
        (
          await b
            .post(`/v1/articles/${article.id}/comments`, { body: "Nested", parentId: reply.id })
            .expect(400)
        ).body,
      ),
    ).toBe("invalid_parent");

    await b.patch(`/v1/article-comments/${top.id}`, { body: "Hijack" }).expect(404);
    const edited = (
      await a
        .patch(`/v1/article-comments/${top.id}`, { body: "Do you check the spare wheel too?" })
        .expect(200)
    ).body as ArticleCommentDto;
    expect(edited.editedAt).not.toBeNull();

    await a.del(`/v1/article-comments/${top.id}`).expect(204);
    const list = (await request(t.server).get(`/v1/articles/${article.slug}/comments`).expect(200))
      .body as CommentList;
    // The removed comment keeps its place (it has a reply) but shows nothing.
    expect(list.items.map((c) => [c.id, c.status, c.body, c.author])).toEqual([
      [top.id, "deleted", null, null],
      [reply.id, "visible", "Yes, weekly.", { displayName: "c1-author" }],
    ]);
    const summary = (await request(t.server).get(`/v1/articles/${article.slug}`).expect(200))
      .body as PublicArticle;
    expect(summary.commentCount).toBe(1);
  });

  it("respects disabled comments, needs a display name and sign-in", async () => {
    const author = await person("c2-author");
    const article = await published(author, { commentsEnabled: false });
    const reader = await person("c2-reader");
    expect(
      reason(
        (await reader.post(`/v1/articles/${article.id}/comments`, { body: "Hi" }).expect(409)).body,
      ),
    ).toBe("comments_disabled");
    const open = await published(author);
    await request(t.server)
      .post(`/v1/articles/${open.id}/comments`)
      .send({ body: "Hi" })
      .expect(401);
    const anonymous = makePerson(t, "c2-noname");
    expect(
      reason(
        (await anonymous.post(`/v1/articles/${open.id}/comments`, { body: "Hi" }).expect(409)).body,
      ),
    ).toBe("profile_incomplete");
    const d = await draft(author);
    await reader.post(`/v1/articles/${d.id}/comments`, { body: "Hi" }).expect(404);
  });
});

describe("bookmarks", () => {
  it("are private and only for public articles", async () => {
    const author = await person("b1-author");
    const reader = await person("b1-reader");
    const other = await person("b1-other");
    const article = await published(author);
    const d = await draft(author);
    await reader.put(`/v1/me/bookmarks/articles/${article.id}`).expect(204);
    await reader.put(`/v1/me/bookmarks/articles/${article.id}`).expect(204);
    await reader.put(`/v1/me/bookmarks/articles/${d.id}`).expect(404);
    const mine = (await reader.get("/v1/me/bookmarks/articles").expect(200))
      .body as ArticleSummary[];
    expect(mine.map((a) => a.id)).toEqual([article.id]);
    expect((await other.get("/v1/me/bookmarks/articles").expect(200)).body).toEqual([]);
    await author.post(`/v1/me/articles/${article.id}/unpublish`).expect(200);
    expect((await reader.get("/v1/me/bookmarks/articles").expect(200)).body).toEqual([]);
    await reader.del(`/v1/me/bookmarks/articles/${article.id}`).expect(204);
  });
});

describe("search", () => {
  it("finds published articles by text, category and tag, with cursors", async () => {
    const author = await person("s1-author");
    const tag = "s1-unique";
    const brakes = await published(author, {
      title: "Zebrafinch air brake adjustment",
      category: "safety",
      tags: [tag],
      body: doc(paragraph("How to adjust slack adjusters on drum brakes safely.")),
    });
    const fuel = await published(author, {
      title: "Saving diesel on long hauls",
      category: "fuel_efficiency",
      tags: [tag],
      body: doc(paragraph("Zebrafinch cruise control habits that reduce consumption.")),
    });
    const author2 = await person("s1-author2");
    const d = await draft(author2, { title: "Zebrafinch draft", tags: [tag] });

    const found = (
      await request(t.server).get("/v1/articles").query({ q: "zebrafinch" }).expect(200)
    ).body as ArticlePage;
    // Title matches rank above body matches; drafts never appear.
    expect(found.items.map((i) => i.id)).toEqual([brakes.id, fuel.id]);
    expect(found.items.map((i) => i.id)).not.toContain(d.id);
    expect(found.label).toBe(COMMUNITY_CONTENT_LABEL);

    const byCategory = (
      await request(t.server)
        .get("/v1/articles")
        .query({ tag, category: "fuel_efficiency" })
        .expect(200)
    ).body as ArticlePage;
    expect(byCategory.items.map((i) => i.id)).toEqual([fuel.id]);

    const first = (await request(t.server).get("/v1/articles").query({ tag, limit: 1 }).expect(200))
      .body as ArticlePage;
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = (
      await request(t.server)
        .get("/v1/articles")
        .query({ tag, limit: 1, cursor: first.nextCursor })
        .expect(200)
    ).body as ArticlePage;
    expect(second.items.map((i) => i.id)).not.toEqual(first.items.map((i) => i.id));
    expect(second.nextCursor).toBeNull();
    // A cursor only works with the query that produced it.
    const wrong = await request(t.server)
      .get("/v1/articles")
      .query({ tag: "other-tag", cursor: first.nextCursor })
      .expect(400);
    expect(reason(wrong.body)).toBe("invalid_cursor");

    await author.del(`/v1/me/articles/${fuel.id}`).expect(204);
    const after = (await request(t.server).get("/v1/articles").query({ tag }).expect(200))
      .body as ArticlePage;
    expect(after.items.map((i) => i.id)).toEqual([brakes.id]);
  });

  it("refuses publishing empty articles and editing others' articles", async () => {
    const author = await person("s2-author");
    const empty = (await author.post("/v1/me/articles", { title: "Empty" }).expect(201))
      .body as MyArticle;
    expect(
      reason((await author.post(`/v1/me/articles/${empty.id}/publish`).expect(400)).body),
    ).toBe("article_incomplete");
    const other = await person("s2-other");
    await other.patch(`/v1/me/articles/${empty.id}`, { title: "Mine now" }).expect(404);
    await other.post(`/v1/me/articles/${empty.id}/publish`).expect(404);
    const noName = makePerson(t, "s2-noname");
    const created = (
      await noName
        .post("/v1/me/articles", { title: "No name", body: doc(paragraph(LONG)) })
        .expect(201)
    ).body as MyArticle;
    expect(
      reason((await noName.post(`/v1/me/articles/${created.id}/publish`).expect(409)).body),
    ).toBe("profile_incomplete");
  });
});
