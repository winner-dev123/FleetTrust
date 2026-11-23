import { auditEvents, eq, organizations, savedLists, savedListShareLinks } from "@fleettrust/db";
import { MAX_LISTS_PER_USER, type SavedListDto, type SavedListSummary } from "@fleettrust/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makePerson, type Person, publishProvider } from "./support/providers.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;
const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };

let providerA: string;
let providerB: string;

beforeAll(async () => {
  t = await createTestApp({ clock });
  providerA = (
    await publishProvider(makePerson(t, "lists-prov-a"), {
      slug: "lists-garage-a",
      at: { lng: 18.4, lat: -33.9 },
    })
  ).orgId;
  providerB = (
    await publishProvider(makePerson(t, "lists-prov-b"), {
      slug: "lists-garage-b",
      at: { lng: 18.5, lat: -33.9 },
    })
  ).orgId;
});

afterAll(async () => {
  await t.close();
});

const reason = (body: unknown) => (body as { reason?: string }).reason;

async function userIdOf(p: Person): Promise<string> {
  return ((await p.get("/v1/me").expect(200)).body as { id: string }).id;
}

async function newList(owner: Person, name: string): Promise<string> {
  return ((await owner.post("/v1/me/lists", { name }).expect(201)).body as SavedListDto).id;
}

async function share(owner: Person, listId: string, role: "viewer" | "editor" = "viewer") {
  const res = await owner.post(`/v1/me/lists/${listId}/share-links`, { role }).expect(201);
  return res.body as { token: string; joinPath: string; link: { id: string } };
}

describe("favorites", () => {
  it("adds and removes providers; the list is created on first use and always comes first", async () => {
    const user = makePerson(t, "fav-user");
    const empty = (await user.get("/v1/me/favorites").expect(200)).body as SavedListDto;
    expect(empty).toMatchObject({ kind: "favorites", name: "Favorites", role: "owner", items: [] });

    await user.put(`/v1/me/favorites/${providerA}`).expect(200);
    const fav = (await user.put(`/v1/me/favorites/${providerA}`).expect(200)).body as SavedListDto;
    expect(fav.items).toHaveLength(1); // idempotent
    expect(fav.items[0]).toMatchObject({
      organizationId: providerA,
      available: true,
      slug: "lists-garage-a",
      tradingName: "lists garage a",
      categories: ["workshop"],
      locality: "Testville",
    });

    await newList(user, "Road trip");
    const mine = (await user.get("/v1/me/lists").expect(200)).body as SavedListSummary[];
    expect(mine.map((l) => [l.kind, l.name, l.itemCount])).toEqual([
      ["favorites", "Favorites", 1],
      ["custom", "Road trip", 0],
    ]);

    await user.del(`/v1/me/favorites/${providerA}`).expect(204);
    await user.del(`/v1/me/favorites/${providerA}`).expect(404);
  });

  it("favorites can't be renamed, deleted or shared", async () => {
    const user = makePerson(t, "fav-locked");
    const fav = (await user.get("/v1/me/favorites").expect(200)).body as SavedListDto;
    expect(
      reason((await user.patch(`/v1/me/lists/${fav.id}`, { name: "x" }).expect(400)).body),
    ).toBe("favorites_locked");
    expect(reason((await user.del(`/v1/me/lists/${fav.id}`).expect(400)).body)).toBe(
      "favorites_locked",
    );
    expect(
      reason((await user.post(`/v1/me/lists/${fav.id}/share-links`, {}).expect(400)).body),
    ).toBe("favorites_locked");
  });

  it("only published providers can be added; unpublished ones stay listed but hidden", async () => {
    const owner = makePerson(t, "fav-unpub-owner");
    const gone = await publishProvider(owner, { slug: "fav-unpub", at: { lng: 19, lat: -33 } });
    const user = makePerson(t, "fav-unpub-user");
    await user.put(`/v1/me/favorites/${gone.orgId}`).expect(200);
    await owner.post(`${gone.base}/unpublish`).expect(200);

    const fav = (await user.get("/v1/me/favorites").expect(200)).body as SavedListDto;
    expect(fav.items[0]).toEqual({
      organizationId: gone.orgId,
      available: false,
      slug: null,
      tradingName: null,
      categories: [],
      locality: null,
      logoUrl: null,
      note: null,
      addedAt: expect.any(String) as string,
    });
    // Can't add it anywhere now, nor a fleet or an unknown organization.
    const fresh = makePerson(t, "fav-unpub-fresh");
    expect(reason((await fresh.put(`/v1/me/favorites/${gone.orgId}`).expect(400)).body)).toBe(
      "provider_unavailable",
    );
    await fresh.put("/v1/me/favorites/00000000-0000-4000-8000-000000000000").expect(400);
    // Suspension hides it too.
    await owner.post(`${gone.base}/publish`).expect(200);
    await t.db.db
      .update(organizations)
      .set({ status: "suspended" })
      .where(eq(organizations.id, gone.orgId));
    expect(
      ((await user.get("/v1/me/favorites").expect(200)).body as SavedListDto).items[0]?.available,
    ).toBe(false);
  });
});

describe("named lists", () => {
  it("create, rename, add with notes, remove and delete", async () => {
    const owner = makePerson(t, "list-crud");
    const id = await newList(owner, "Cape run");
    await owner
      .patch(`/v1/me/lists/${id}`, { name: "Cape run 2027", description: "Stops" })
      .expect(200);
    await owner.put(`/v1/me/lists/${id}/items/${providerA}`, { note: "Good brakes" }).expect(200);
    const list = (await owner.put(`/v1/me/lists/${id}/items/${providerB}`).expect(200))
      .body as SavedListDto;
    expect(list).toMatchObject({
      name: "Cape run 2027",
      description: "Stops",
      itemCount: 2,
      members: [],
    });
    expect(list.items.map((i) => [i.organizationId, i.note])).toEqual([
      [providerA, "Good brakes"],
      [providerB, null],
    ]);
    // Re-adding updates the note only.
    const updated = (
      await owner.put(`/v1/me/lists/${id}/items/${providerA}`, { note: null }).expect(200)
    ).body as SavedListDto;
    expect(updated.items.map((i) => i.note)).toEqual([null, null]);
    await owner.del(`/v1/me/lists/${id}/items/${providerB}`).expect(204);
    await owner.del(`/v1/me/lists/${id}`).expect(204);
    await owner.get(`/v1/me/lists/${id}`).expect(404);
    await owner.post("/v1/me/lists", { name: "" }).expect(400);
    await owner.post("/v1/me/lists", { name: "x".repeat(81) }).expect(400);
  });

  it("caps the number of lists per user", async () => {
    const owner = makePerson(t, "list-cap");
    const ownerId = await userIdOf(owner);
    await t.db.db.insert(savedLists).values(
      Array.from({ length: MAX_LISTS_PER_USER }, (_, i) => ({
        ownerUserId: ownerId,
        kind: "custom" as const,
        name: `List ${String(i)}`,
      })),
    );
    expect(reason((await owner.post("/v1/me/lists", { name: "One more" }).expect(409)).body)).toBe(
      "too_many_lists",
    );
  });
});

describe("sharing permissions", () => {
  it("viewers read; editors change items; only the owner manages the list; outsiders get 404", async () => {
    const owner = makePerson(t, "share-owner");
    const viewer = makePerson(t, "share-viewer");
    const editor = makePerson(t, "share-editor");
    const outsider = makePerson(t, "share-outsider");
    const id = await newList(owner, "Shared stops");
    await owner.put(`/v1/me/lists/${id}/items/${providerA}`).expect(200);

    const viewLink = await share(owner, id, "viewer");
    const editLink = await share(owner, id, "editor");
    expect(viewLink.joinPath).toBe(`/lists/join#token=${viewLink.token}`);
    expect(
      (await viewer.post("/v1/lists/join", { token: viewLink.token }).expect(200)).body,
    ).toMatchObject({
      id,
      role: "viewer",
    });
    await editor.post("/v1/lists/join", { token: editLink.token }).expect(200);

    // Viewer: read only; members hidden.
    const seen = (await viewer.get(`/v1/me/lists/${id}`).expect(200)).body as SavedListDto;
    expect(seen).toMatchObject({ role: "viewer", members: null, itemCount: 1, memberCount: 2 });
    for (const attempt of [
      viewer.put(`/v1/me/lists/${id}/items/${providerB}`),
      viewer.del(`/v1/me/lists/${id}/items/${providerA}`),
      viewer.patch(`/v1/me/lists/${id}`, { name: "Mine now" }),
      viewer.post(`/v1/me/lists/${id}/share-links`, {}),
    ]) {
      expect(reason((await attempt.expect(403)).body)).toBe("insufficient_role");
    }

    // Editor: items yes, management no.
    await editor
      .put(`/v1/me/lists/${id}/items/${providerB}`, { note: "Added by editor" })
      .expect(200);
    await editor.del(`/v1/me/lists/${id}/items/${providerA}`).expect(204);
    await editor.patch(`/v1/me/lists/${id}`, { name: "x" }).expect(403);
    await editor.del(`/v1/me/lists/${id}`).expect(403);
    await editor.post(`/v1/me/lists/${id}/share-links`, {}).expect(403);
    await editor.get(`/v1/me/lists/${id}/share-links`).expect(403);
    const viewerId = await userIdOf(viewer);
    await editor.patch(`/v1/me/lists/${id}/members/${viewerId}`, { role: "editor" }).expect(403);
    await editor.del(`/v1/me/lists/${id}/members/${viewerId}`).expect(403);

    // Outsider: the list doesn't exist for them.
    await outsider.get(`/v1/me/lists/${id}`).expect(404);
    await outsider.put(`/v1/me/lists/${id}/items/${providerA}`).expect(404);
    await outsider.del(`/v1/me/lists/${id}`).expect(404);
    expect(
      (await outsider.get("/v1/me/lists").expect(200)).body as SavedListSummary[],
    ).toHaveLength(1);

    // Owner sees members (display names only, no emails) and manages roles.
    const full = (await owner.get(`/v1/me/lists/${id}`).expect(200)).body as SavedListDto;
    expect(full.members?.map((m) => m.role)).toEqual(["viewer", "editor"]);
    expect(JSON.stringify(full)).not.toMatch(/@example\.test/);
    await owner.patch(`/v1/me/lists/${id}/members/${viewerId}`, { role: "editor" }).expect(204);
    await viewer.put(`/v1/me/lists/${id}/items/${providerA}`).expect(200);

    // Shared lists appear in the members' own list overview.
    const viewerLists = (await viewer.get("/v1/me/lists").expect(200)).body as SavedListSummary[];
    expect(viewerLists.find((l) => l.id === id)?.role).toBe("editor");

    // A member leaves; the owner removes another.
    await viewer.del(`/v1/me/lists/${id}/members/${viewerId}`).expect(204);
    await viewer.get(`/v1/me/lists/${id}`).expect(404);
    await owner.del(`/v1/me/lists/${id}/members/${await userIdOf(editor)}`).expect(204);
    await editor.get(`/v1/me/lists/${id}`).expect(404);

    const events = await t.db.db.select().from(auditEvents).where(eq(auditEvents.targetId, id));
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "list.created",
        "list.share_link_created",
        "list.joined",
        "list.member_role_changed",
        "list.left",
        "list.member_removed",
      ]),
    );
  });

  it("links: stored hashed, revocable, expiring; rejoining never downgrades; owners can't join", async () => {
    const owner = makePerson(t, "link-owner");
    const member = makePerson(t, "link-member");
    const id = await newList(owner, "Links");
    const edit = await share(owner, id, "editor");
    const view = await share(owner, id, "viewer");

    const stored = await t.db.db
      .select()
      .from(savedListShareLinks)
      .where(eq(savedListShareLinks.listId, id));
    expect(stored.map((l) => l.tokenHash)).not.toContain(edit.token);
    expect(stored.every((l) => /^[0-9a-f]{64}$/.test(l.tokenHash))).toBe(true);

    await member.post("/v1/lists/join", { token: edit.token }).expect(200);
    // A viewer link doesn't downgrade an editor.
    expect(
      (
        (await member.post("/v1/lists/join", { token: view.token }).expect(200))
          .body as SavedListSummary
      ).role,
    ).toBe("editor");
    expect(
      reason((await owner.post("/v1/lists/join", { token: edit.token }).expect(409)).body),
    ).toBe("owner_cannot_join");

    await owner.del(`/v1/me/lists/${id}/share-links/${view.link.id}`).expect(204);
    await owner.del(`/v1/me/lists/${id}/share-links/${view.link.id}`).expect(404);
    const late = makePerson(t, "link-late");
    expect(
      reason((await late.post("/v1/lists/join", { token: view.token }).expect(410)).body),
    ).toBe("link_invalid");

    // Links expire (default 7 days).
    const soon = await share(owner, id, "viewer");
    clock.offsetMs = 8 * 86_400_000;
    try {
      expect(
        reason((await late.post("/v1/lists/join", { token: soon.token }).expect(410)).body),
      ).toBe("link_invalid");
    } finally {
      clock.offsetMs = 0;
    }
    await late.post("/v1/lists/join", { token: "x".repeat(43) }).expect(410);
    await late.post("/v1/lists/join", { token: "short" }).expect(400);

    const links = (await owner.get(`/v1/me/lists/${id}/share-links`).expect(200)).body as {
      revokedAt: string | null;
    }[];
    expect(links).toHaveLength(3);
    expect(links.filter((l) => l.revokedAt !== null)).toHaveLength(1);
    expect(JSON.stringify(links)).not.toContain(edit.token);
  });

  it("deleting a list removes access for everyone", async () => {
    const owner = makePerson(t, "del-owner");
    const member = makePerson(t, "del-member");
    const id = await newList(owner, "Temporary");
    await member.post("/v1/lists/join", { token: (await share(owner, id)).token }).expect(200);
    await owner.del(`/v1/me/lists/${id}`).expect(204);
    await member.get(`/v1/me/lists/${id}`).expect(404);
    expect(
      ((await member.get("/v1/me/lists").expect(200)).body as SavedListSummary[]).map((l) => l.id),
    ).not.toContain(id);
  });
});
