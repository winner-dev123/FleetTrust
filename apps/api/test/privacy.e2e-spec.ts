import {
  articleComments,
  articleImages,
  articles,
  auditEvents,
  consents,
  documentAccessGrants,
  eq,
  friendships,
  notifications,
  outboxEvents,
  platformStaff,
  serviceRequestAttachments,
  trustedContacts,
  users,
  vehicles,
} from "@fleettrust/db";
import {
  type ConsentStateDto,
  CURRENT_CONSENT_VERSIONS,
  type DataExport,
  type MyOrganization,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RetentionService } from "../src/modules/privacy/index.js";
import { USER_REFERENCES } from "../src/modules/privacy/user-data-map.js";
import { securityHeaders } from "../src/platform/security-headers/index.js";
import {
  type MemoryObjectStorage,
  OBJECT_STORAGE,
  type ObjectStorage,
} from "../src/platform/storage/index.js";
import { samplePng } from "./support/images.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;
const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };

beforeAll(async () => {
  t = await createTestApp({ clock });
});

afterAll(async () => {
  await t.close();
});

const reason = (body: unknown) => (body as { reason?: string }).reason;
const MINUTE = 60_000;

function client(uid: string, signedInMinutesAgo = 0) {
  const auth = {
    Authorization: `Bearer ${t.auth.issue(uid, {
      email: `${uid}@example.test`,
      authTime: new Date(Date.now() - signedInMinutesAgo * MINUTE),
    })}`,
  };
  return {
    get: (path: string) => request(t.server).get(path).set(auth),
    post: (path: string, body: object = {}) => request(t.server).post(path).set(auth).send(body),
    patch: (path: string, body: object) => request(t.server).patch(path).set(auth).send(body),
    del: (path: string, confirm?: string) => {
      const req = request(t.server).delete(path).set(auth);
      return confirm ? req.set("X-Confirm-Action", confirm) : req;
    },
  };
}

async function person(uid: string) {
  const me = (await client(uid).patch("/v1/me", { displayName: uid }).expect(200)).body as {
    id: string;
  };
  return { uid, id: me.id, as: (minutesAgo = 0) => client(uid, minutesAgo) };
}

async function befriend(a: string, b: string) {
  const [userAId, userBId] = a < b ? [a, b] : [b, a];
  await t.db.db.insert(friendships).values({ userAId, userBId });
}

describe("consent", () => {
  it("asks for the required consents, records every choice and keeps the history", async () => {
    const p = await person("cs-1");
    const initial = (await p.as().get("/v1/me/consents").expect(200)).body as ConsentStateDto[];
    expect(
      initial
        .filter((c) => c.needsAnswer)
        .map((c) => c.purpose)
        .sort(),
    ).toEqual(["privacy", "terms"]);
    expect(initial.find((c) => c.purpose === "analytics")).toMatchObject({
      required: false,
      granted: null,
    });

    for (const purpose of ["terms", "privacy"] as const) {
      await p
        .as()
        .post("/v1/me/consents", {
          purpose,
          version: CURRENT_CONSENT_VERSIONS[purpose],
          granted: true,
        })
        .expect(200);
    }
    await p
      .as()
      .post("/v1/me/consents", {
        purpose: "analytics",
        version: CURRENT_CONSENT_VERSIONS.analytics,
        granted: true,
      })
      .expect(200);
    const after = (
      await p
        .as()
        .post("/v1/me/consents", {
          purpose: "analytics",
          version: CURRENT_CONSENT_VERSIONS.analytics,
          granted: false,
        })
        .expect(200)
    ).body as ConsentStateDto[];
    expect(after.every((c) => !c.needsAnswer)).toBe(true);
    expect(after.find((c) => c.purpose === "analytics")?.granted).toBe(false);

    const history = await t.db.db.select().from(consents).where(eq(consents.userId, p.id));
    expect(
      history
        .filter((c) => c.purpose === "analytics")
        .map((c) => c.granted)
        .sort(),
    ).toEqual([false, true]);
    const audit = await t.db.db.select().from(auditEvents).where(eq(auditEvents.actorId, p.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["privacy.consent_granted", "privacy.consent_withdrawn"]),
    );
  });

  it("refuses an outdated version and withdrawing a required consent", async () => {
    const p = await person("cs-2");
    const stale = await p
      .as()
      .post("/v1/me/consents", { purpose: "terms", version: "2020-01-01", granted: true });
    expect(stale.status).toBe(409);
    expect(reason(stale.body)).toBe("stale_consent_version");
    const withdraw = await p.as().post("/v1/me/consents", {
      purpose: "terms",
      version: CURRENT_CONSENT_VERSIONS.terms,
      granted: false,
    });
    expect(reason(withdraw.body)).toBe("required_consent");
  });
});

describe("data export", () => {
  it("contains the person's own data, never internal keys or other people's records", async () => {
    const p = await person("ex-1");
    const other = await person("ex-2");
    await p
      .as()
      .post("/v1/me/vehicles", { vehicleType: "car", make: "Toyota", registration: "EX 11-11" })
      .expect(201);
    await other
      .as()
      .post("/v1/me/vehicles", { vehicleType: "van", make: "Ford", registration: "EX 22-22" })
      .expect(201);

    const res = await p.as().get("/v1/me/export").expect(200);
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="fleettrust-data.json"/,
    );
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    const data = JSON.parse(res.text) as DataExport;
    expect(data.format).toBe("fleettrust-export-v1");
    expect(data.sections["profile"]).toMatchObject({
      id: p.id,
      email: "ex-1@example.test",
      displayName: "ex-1",
    });
    const own = data.sections["vehicles"] as { registration: string }[];
    expect(own.map((v) => v.registration)).toEqual(["EX 11-11"]);
    expect(res.text).not.toMatch(/firebaseUid|storageKey|wrappedKey|EX 22-22/);
    const exported = await t.db.db.select().from(auditEvents).where(eq(auditEvents.actorId, p.id));
    expect(exported.map((a) => a.action)).toContain("privacy.data_exported");
  });

  it("is limited to five exports a day", async () => {
    const p = await person("ex-limit");
    for (let i = 0; i < 5; i++) await p.as().get("/v1/me/export").expect(200);
    await p.as().get("/v1/me/export").expect(429);
  });
});

describe("account deletion", () => {
  it("needs a recent sign-in and an explicit confirmation", async () => {
    const p = await person("del-guard");
    const missing = await p.as().del("/v1/me");
    expect(missing.status).toBe(428);
    expect(reason(missing.body)).toBe("confirmation_required");
    const stale = await p.as(30).del("/v1/me", "account.delete");
    expect(reason(stale.body)).toBe("reauthentication_required");
  });

  it("won't leave a business without an owner", async () => {
    const owner = await person("del-owner");
    await owner.as().post("/v1/orgs", { kind: "provider", name: "Solo Workshop" }).expect(201);
    const res = await owner.as().del("/v1/me", "account.delete");
    expect(res.status).toBe(409);
    expect(reason(res.body)).toBe("sole_owner");
  });

  it("erases the person, removes personal records, withdraws their writing and keeps others' data", async () => {
    const p = await person("del-1");
    const friend = await person("del-2");
    await befriend(p.id, friend.id);
    await p
      .as()
      .post("/v1/me/trusted-contacts", { userId: friend.id, priority: "primary" })
      .expect(201);
    const vehicle = (
      await p
        .as()
        .post("/v1/me/vehicles", { vehicleType: "car", make: "Mazda", registration: "DL 33-33" })
        .expect(201)
    ).body as { id: string };
    const friendVehicle = (
      await friend
        .as()
        .post("/v1/me/vehicles", { vehicleType: "car", registration: "DL 44-44" })
        .expect(201)
    ).body as { id: string };
    const [article] = await t.db.db
      .insert(articles)
      .values({
        authorUserId: p.id,
        slug: "del-article",
        status: "published",
        title: "My trip notes",
        body: { type: "doc", content: [] },
        bodyText: "Personal notes",
        category: "maintenance",
        publishedAt: new Date(),
      })
      .returning();
    if (!article) throw new Error("no article");
    const [comment] = await t.db.db
      .insert(articleComments)
      .values({ articleId: article.id, authorUserId: p.id, body: "My own comment" })
      .returning();
    // Shared with someone else: a co-owned fleet stays with the other owner.
    const fleet = (
      await friend.as().post("/v1/orgs", { kind: "fleet", name: "Shared Fleet" }).expect(201)
    ).body as MyOrganization;
    await t.db.db.execute(
      `INSERT INTO memberships (organization_id, organization_kind, user_id, role) VALUES ('${fleet.organization.id}', 'fleet', '${p.id}', 'owner')`,
    );
    // A public article image they uploaded, and a staff role they held.
    const storage = t.app.get<MemoryObjectStorage>(OBJECT_STORAGE);
    await storage.write("public_media", "article-images/del-1.png", samplePng(), "image/png");
    await t.db.db.insert(articleImages).values({
      uploadedBy: p.id,
      status: "available",
      declaredContentType: "image/png",
      declaredSize: samplePng().length,
      quarantineKey: "article-images/q/del-1",
      storageKey: "article-images/del-1.png",
      contentType: "image/png",
    });
    await t.db.db.insert(platformStaff).values({ userId: p.id, role: "support_agent" });

    await p.as().del("/v1/me", "account.delete").expect(204);

    const [tombstone] = await t.db.db.select().from(users).where(eq(users.id, p.id));
    expect(tombstone).toMatchObject({
      status: "deleted",
      email: null,
      displayName: null,
      lastSeenAt: null,
      firebaseUid: `deleted:${p.id}`,
    });
    expect(tombstone?.deletedAt).toBeInstanceOf(Date);
    expect(t.auth.deletedAccounts).toContain(p.uid);
    // The old session is dead.
    await p.as().get("/v1/me").expect(401);

    expect(await t.db.db.select().from(vehicles).where(eq(vehicles.id, vehicle.id))).toEqual([]);
    expect(
      await t.db.db.select().from(vehicles).where(eq(vehicles.id, friendVehicle.id)),
    ).toHaveLength(1);
    expect(
      await t.db.db
        .select()
        .from(friendships)
        .where(eq(friendships.userAId, p.id < friend.id ? p.id : friend.id)),
    ).toEqual([]);
    expect(
      await t.db.db.select().from(trustedContacts).where(eq(trustedContacts.ownerUserId, p.id)),
    ).toEqual([]);
    const [withdrawn] = await t.db.db.select().from(articles).where(eq(articles.id, article.id));
    expect(withdrawn).toMatchObject({
      status: "draft",
      title: "Deleted article",
      bodyText: "",
      publishedAt: null,
    });
    const [removedComment] = await t.db.db
      .select()
      .from(articleComments)
      .where(eq(articleComments.id, comment?.id ?? ""));
    expect(removedComment?.status).toBe("deleted");
    // The co-owned fleet keeps its other owner.
    await friend.as().get(`/v1/orgs/${fleet.organization.id}`).expect(200);

    // The image is gone from public storage, and the staff role with the account.
    expect(storage.raw("public_media", "article-images/del-1.png")).toBeUndefined();
    expect(
      await t.db.db.select().from(articleImages).where(eq(articleImages.uploadedBy, p.id)),
    ).toEqual([]);
    expect(
      await t.db.db.select().from(platformStaff).where(eq(platformStaff.userId, p.id)),
    ).toEqual([]);

    // Every column classified "erased" holds nothing of theirs any more.
    const erased = Object.entries(USER_REFERENCES).filter(([, r]) => r.handling === "erased");
    const leftovers: string[] = [];
    for (const [column] of erased) {
      const [table, field] = column.split(".");
      const result = await t.db.client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${table ?? ""}" WHERE "${field ?? ""}" = $1`,
        [p.id],
      );
      if ((result.rows[0]?.n ?? 0) > 0) leftovers.push(column);
    }
    expect(leftovers).toEqual([]);

    const audit = await t.db.db.select().from(auditEvents).where(eq(auditEvents.targetId, p.id));
    expect(audit.map((a) => a.action)).toContain("user.account_deleted");
    expect(audit.find((a) => a.action === "user.account_deleted")?.metadata).toMatchObject({
      articleImages: 1,
      staffRolesRemoved: ["support_agent"],
    });
    // The same email can sign up again as a brand-new account.
    const again = (await client("del-1-new").get("/v1/me").expect(200)).body as { id: string };
    expect(again.id).not.toBe(p.id);
  });

  it("decides on purpose what happens to every column that references a person", async () => {
    const { rows } = await t.db.client.query<{ ref: string }>(
      `SELECT c.conrelid::regclass::text || '.' || a.attname AS ref
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass`,
    );
    const inDatabase = rows.map((r) => r.ref).sort();
    const classified = Object.keys(USER_REFERENCES).sort();
    // A new column pointing at users must be added to user-data-map.ts (erased, withdrawn or kept).
    expect(inDatabase.filter((ref) => !classified.includes(ref))).toEqual([]);
    expect(classified.filter((ref) => !inDatabase.includes(ref))).toEqual([]);
  });
});

describe("encryption at rest", () => {
  it("stores request photos encrypted and serves them decrypted to the owner", async () => {
    const p = await person("enc-1");
    const data = samplePng();
    const created = (
      await p
        .as()
        .post("/v1/service-request-attachments", { contentType: "image/png", size: data.length })
        .expect(201)
    ).body as { attachmentId: string; upload: { url: string; headers: Record<string, string> } };
    await request(t.server)
      .put(new URL(created.upload.url).pathname)
      .set(created.upload.headers)
      .send(data)
      .expect(200);
    await p
      .as()
      .post(`/v1/service-request-attachments/${created.attachmentId}/complete`)
      .expect(200);

    const [row] = await t.db.db
      .select()
      .from(serviceRequestAttachments)
      .where(eq(serviceRequestAttachments.id, created.attachmentId));
    expect(row?.wrappedKey).toBeTruthy();
    const stored = await t.app
      .get<ObjectStorage>(OBJECT_STORAGE)
      .read("sensitive", row?.storageKey ?? "");
    expect(stored.equals(data)).toBe(false);
    expect(stored.includes(Buffer.from("IHDR"))).toBe(false);
  });
});

describe("retention", () => {
  it("deletes data past its retention period and keeps the rest", async () => {
    const p = await person("ret-1");
    const old = new Date(Date.now() - 400 * 86_400_000);
    const recent = new Date();
    const [event] = await t.db.db
      .insert(outboxEvents)
      .values({
        eventType: "RetentionTest",
        aggregateType: "user",
        aggregateId: p.id,
        payload: {},
        publishedAt: old,
        occurredAt: old,
      })
      .returning();
    await t.db.db.insert(notifications).values([
      {
        userId: p.id,
        kind: "power_user",
        title: "Old",
        body: "Old",
        data: {},
        sourceEventId: event?.id ?? p.id,
        readAt: old,
        createdAt: old,
      },
      {
        userId: p.id,
        kind: "power_user",
        title: "New",
        body: "New",
        data: {},
        sourceEventId: p.id,
        readAt: recent,
        createdAt: recent,
      },
    ]);
    const report = await t.app.get(RetentionService).run();
    expect(report.outbox_events_published).toBeGreaterThanOrEqual(1);
    expect(report.notifications_read).toBeGreaterThanOrEqual(1);
    const left = await t.db.db.select().from(notifications).where(eq(notifications.userId, p.id));
    expect(left.map((n) => n.title)).toEqual(["New"]);
    expect(await t.db.db.select().from(documentAccessGrants)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ expiresAt: old })]),
    );
    const runs = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "privacy.retention_run"));
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("security headers", () => {
  it("are on every response", async () => {
    const res = await request(t.server).get("/health").expect(200);
    expect(res.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "cache-control": "no-store",
    });
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["strict-transport-security"]).toBeUndefined();
  });

  it("add HSTS in deployed environments", () => {
    const headers = new Map<string, string>();
    const res = {
      setHeader: (name: string, value: string) => headers.set(name, value),
      removeHeader: () => undefined,
    };
    securityHeaders({ APP_ENV: "production" })({} as never, res as never, () => undefined);
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
  });
});
