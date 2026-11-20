import { auditEvents, eq, organizations, providerProfiles } from "@fleettrust/db";
import type {
  BranchDto,
  MyOrganization,
  ProviderProfileDto,
  PublicProviderProfile,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/test-app.js";
import { samplePng } from "./support/images.js";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

const reason = (body: unknown) => (body as { reason?: string }).reason;

function person(uid: string) {
  const email = `${uid}@example.test`;
  const auth = () => ({ Authorization: `Bearer ${t.auth.issue(uid, { email })}` });
  return {
    uid,
    email,
    get: (path: string) => request(t.server).get(path).set(auth()),
    post: (path: string, body?: object) =>
      request(t.server)
        .post(path)
        .set(auth())
        .send(body ?? {}),
    patch: (path: string, body: object) => request(t.server).patch(path).set(auth()).send(body),
    del: (path: string) => request(t.server).delete(path).set(auth()),
  };
}
type Person = ReturnType<typeof person>;

async function provider(owner: Person, kind: "provider" | "fleet" = "provider") {
  const org = (await owner.post("/v1/orgs", { kind, name: `${owner.uid} Ltd` }).expect(201))
    .body as MyOrganization;
  const orgId = org.organization.id;
  return { orgId, base: `/v1/orgs/${orgId}/provider-profile` };
}

async function addBranch(owner: Person, orgId: string, name: string): Promise<string> {
  return ((await owner.post(`/v1/orgs/${orgId}/branches`, { name }).expect(201)).body as BranchDto)
    .id;
}

const CAPE_TOWN = { lng: 18.42412, lat: -33.92487 };

/** A complete towing provider: every step done. */
async function completeTowing(owner: Person, slug: string) {
  const { orgId, base } = await provider(owner);
  await owner
    .patch(base, {
      slug,
      legalName: "Rapid Recovery (Pty) Ltd",
      tradingName: "Rapid Recovery",
      description: "24/7 heavy recovery",
      categories: ["towing"],
      categoryDetails: {
        towing: { maxTowWeightKg: 40_000, recoveryTypes: ["heavy", "winch"], operates24h: true },
      },
      vehicleTypes: ["heavy_truck", "trailer"],
      contactPhone: "+27 21 555 0100",
      contactEmail: "dispatch@rapid.example",
    })
    .expect(200);
  const branchId = await addBranch(owner, orgId, "Depot");
  await owner
    .patch(`${base}/branches/${branchId}`, {
      addressLine1: "12 Dock Road",
      locality: "Cape Town",
      countryCode: "ZA",
      location: CAPE_TOWN,
      serviceRadiusKm: 150,
    })
    .expect(200);
  return { orgId, base, branchId };
}

const step = (profile: ProviderProfileDto, id: string) => profile.steps.find((s) => s.id === id);

describe("save and resume", () => {
  it("saves any subset of fields and resumes where the provider left off", async () => {
    const owner = person("wizard-resume");
    const { base } = await provider(owner);

    const fresh = (await owner.get(base).expect(200)).body as ProviderProfileDto;
    expect(fresh).toMatchObject({
      status: "draft",
      canPublish: false,
      hasUnpublishedChanges: true,
    });
    expect(fresh.steps.map((s) => s.id)).toEqual([
      "basics",
      "categories",
      "vehicles",
      "contact",
      "branches",
      "media",
    ]);

    // Session 1: basics only.
    await owner
      .patch(base, {
        slug: "resume-garage",
        legalName: "Resume Garage CC",
        tradingName: "Resume Garage",
      })
      .expect(200);
    // Session 2 (new token, later): pick up from the saved draft.
    const resumed = (await person("wizard-resume").get(base).expect(200))
      .body as ProviderProfileDto;
    expect(resumed).toMatchObject({ slug: "resume-garage", tradingName: "Resume Garage" });
    expect(step(resumed, "basics")?.complete).toBe(true);
    expect(step(resumed, "categories")?.complete).toBe(false);

    // Partial category details are fine in a draft…
    const partial = (
      await owner
        .patch(base, { categories: ["workshop"], categoryDetails: { workshop: { bays: 4 } } })
        .expect(200)
    ).body as ProviderProfileDto;
    expect(partial.categoryDetails).toEqual({ workshop: { bays: 4 } });
    // …but the step reports what's still missing.
    expect(step(partial, "categories")?.issues).toEqual([
      { path: "categoryDetails.workshop.specialities", message: "Required" },
    ]);
  });

  it("rejects malformed values even in drafts", async () => {
    const owner = person("wizard-shapes");
    const { base } = await provider(owner);
    await owner.patch(base, { categories: ["spaceport"] }).expect(400);
    await owner
      .patch(base, { categoryDetails: { fuel_station: { fuelTypes: ["jet_a1"] } } })
      .expect(400);
    await owner.patch(base, { categoryDetails: { towing: { maxTowWeightKg: 10 } } }).expect(400);
    await owner.patch(base, { website: "http://insecure.example" }).expect(400);
    await owner.patch(base, { slug: "Bad Slug!" }).expect(400);
    await owner.patch(base, { contactPhone: "021 555" }).expect(400);
  });

  it("only owners and admins edit; any member reads; others get 404; fleets have no profile", async () => {
    const owner = person("wizard-perm-owner");
    const staff = person("wizard-perm-staff");
    const { orgId, base } = await provider(owner);
    const invite = await owner
      .post(`/v1/orgs/${orgId}/invitations`, { email: staff.email, role: "staff" })
      .expect(201);
    await staff
      .post("/v1/invitations/accept", { token: (invite.body as { token: string }).token })
      .expect(200);
    await staff.get(base).expect(200);
    expect(reason((await staff.patch(base, { tradingName: "Hijack" }).expect(403)).body)).toBe(
      "insufficient_permission",
    );
    await staff.post(`${base}/publish`).expect(403);
    await person("wizard-outsider").get(base).expect(404);

    const fleetOwner = person("wizard-fleet");
    const fleet = await provider(fleetOwner, "fleet");
    expect(reason((await fleetOwner.get(fleet.base).expect(400)).body)).toBe("not_a_provider");
  });

  it("slugs are unique", async () => {
    const a = person("slug-a");
    const b = person("slug-b");
    await a.patch((await provider(a)).base, { slug: "same-name" }).expect(200);
    expect(
      reason((await b.patch((await provider(b)).base, { slug: "same-name" }).expect(409)).body),
    ).toBe("slug_taken");
  });
});

describe("category-specific validation", () => {
  it("each category demands its own fields before publishing", async () => {
    const owner = person("cat-rules");
    const { base } = await provider(owner);
    await owner
      .patch(base, {
        categories: ["fuel_station", "parking"],
        categoryDetails: { fuel_station: { fuelTypes: ["diesel"] }, parking: { overnight: true } },
      })
      .expect(200);
    const profile = (await owner.get(base).expect(200)).body as ProviderProfileDto;
    expect(
      step(profile, "categories")
        ?.issues.map((i) => i.path)
        .sort(),
    ).toEqual([
      "categoryDetails.fuel_station.heavyVehicleAccess",
      "categoryDetails.parking.security",
      "categoryDetails.parking.truckSpaces",
    ]);
    // An empty required list is reported too.
    await owner
      .patch(base, {
        categoryDetails: { fuel_station: { fuelTypes: [], heavyVehicleAccess: true } },
      })
      .expect(200);
    const again = (await owner.get(base).expect(200)).body as ProviderProfileDto;
    expect(step(again, "categories")?.issues.map((i) => i.path)).toContain(
      "categoryDetails.fuel_station.fuelTypes",
    );
  });

  it("towing and mobile mechanics need a service radius; mobile-only providers don't need a street address", async () => {
    const owner = person("cat-radius");
    const { orgId, base } = await provider(owner);
    await owner
      .patch(base, {
        categories: ["mobile_mechanic"],
        categoryDetails: { mobile_mechanic: { services: ["battery"] } },
      })
      .expect(200);
    const branchId = await addBranch(owner, orgId, "Van 1");
    await owner
      .patch(`${base}/branches/${branchId}`, {
        locality: "Durban",
        countryCode: "ZA",
        location: { lng: 31.02, lat: -29.86 },
      })
      .expect(200);
    let profile = (await owner.get(base).expect(200)).body as ProviderProfileDto;
    expect(step(profile, "branches")?.issues.map((i) => i.path)).toEqual([
      `branches.${branchId}.serviceRadiusKm`,
    ]);

    await owner.patch(`${base}/branches/${branchId}`, { serviceRadiusKm: 40 }).expect(200);
    profile = (await owner.get(base).expect(200)).body as ProviderProfileDto;
    expect(step(profile, "branches")?.complete).toBe(true); // no street address needed

    // Adding a premises-based category makes the street address required.
    await owner.patch(base, { categories: ["mobile_mechanic", "tyres"] }).expect(200);
    profile = (await owner.get(base).expect(200)).body as ProviderProfileDto;
    expect(step(profile, "branches")?.issues.map((i) => i.path)).toContain(
      `branches.${branchId}.addressLine1`,
    );
  });
});

describe("publication rules", () => {
  it("an incomplete profile can't be published; the response says exactly what's missing", async () => {
    const owner = person("pub-incomplete");
    const { base } = await provider(owner);
    await owner.patch(base, { slug: "pub-incomplete", tradingName: "Half Done" }).expect(200);
    const refused = await owner.post(`${base}/publish`).expect(422);
    expect(reason(refused.body)).toBe("profile_incomplete");
    const paths = (refused.body as { issues: { path: string }[] }).issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(["legalName", "categories", "vehicleTypes", "contact", "branches"]),
    );
    await request(t.server).get("/v1/providers/pub-incomplete").expect(404);
  });

  it("publishes a frozen snapshot; visitors see approximate location and no contact details", async () => {
    const owner = person("pub-ok");
    const { base, branchId } = await completeTowing(owner, "rapid-recovery");
    const ready = (await owner.get(base).expect(200)).body as ProviderProfileDto;
    expect(ready.canPublish).toBe(true);
    const published = (await owner.post(`${base}/publish`).expect(200)).body as ProviderProfileDto;
    expect(published).toMatchObject({ status: "published", hasUnpublishedChanges: false });

    const visitor = (await request(t.server).get("/v1/providers/rapid-recovery").expect(200))
      .body as PublicProviderProfile;
    expect(visitor).toMatchObject({
      tradingName: "Rapid Recovery",
      categories: ["towing"],
      contact: null,
    });
    expect(visitor.branches[0]).toMatchObject({
      id: branchId,
      addressLine1: null,
      locality: "Cape Town",
      location: { lng: 18.42, lat: -33.92, approximate: true },
    });
    // Labelled unverified until a business badge exists (SRS J4).
    expect(visitor.verification).toEqual([
      { badgeType: "business", status: "unverified", expiresAt: null },
      { badgeType: "location", status: "unverified", expiresAt: null },
    ]);
    expect(JSON.stringify(visitor)).not.toContain("555 0100");

    const full = (await person("pub-reader").get("/v1/providers/rapid-recovery/full").expect(200))
      .body as PublicProviderProfile;
    expect(full.contact).toEqual({
      phone: "+27 21 555 0100",
      email: "dispatch@rapid.example",
      website: null,
    });
    expect(full.branches[0]?.location).toEqual({ ...CAPE_TOWN, approximate: false });
    // The full view needs sign-in.
    await request(t.server).get("/v1/providers/rapid-recovery/full").expect(401);
  });

  it("draft edits don't change the public profile until republished", async () => {
    const owner = person("pub-edit");
    const { base } = await completeTowing(owner, "edit-recovery");
    await owner.post(`${base}/publish`).expect(200);
    const edited = (await owner.patch(base, { tradingName: "Renamed Recovery" }).expect(200))
      .body as ProviderProfileDto;
    expect(edited.hasUnpublishedChanges).toBe(true);
    let live = (await request(t.server).get("/v1/providers/edit-recovery").expect(200))
      .body as PublicProviderProfile;
    expect(live.tradingName).toBe("Rapid Recovery");
    await owner.post(`${base}/publish`).expect(200);
    live = (await request(t.server).get("/v1/providers/edit-recovery").expect(200))
      .body as PublicProviderProfile;
    expect(live.tradingName).toBe("Renamed Recovery");

    // Breaking the draft doesn't break what's live, and can't be published.
    await owner.patch(base, { categories: [] }).expect(200);
    await owner.post(`${base}/publish`).expect(422);
    await request(t.server).get("/v1/providers/edit-recovery").expect(200);
  });

  it("incomplete branches are left out of the published profile", async () => {
    const owner = person("pub-branches");
    const { orgId, base } = await completeTowing(owner, "branchy-recovery");
    await addBranch(owner, orgId, "Unfinished Yard");
    await owner.post(`${base}/publish`).expect(200);
    const live = (await request(t.server).get("/v1/providers/branchy-recovery").expect(200))
      .body as PublicProviderProfile;
    expect(live.branches.map((b) => b.name)).toEqual(["Depot"]);
  });

  it("unpublishing, and suspending the organization, take the profile offline", async () => {
    const owner = person("pub-offline");
    const { orgId, base } = await completeTowing(owner, "offline-recovery");
    await owner.post(`${base}/publish`).expect(200);
    await owner.post(`${base}/unpublish`).expect(200);
    await request(t.server).get("/v1/providers/offline-recovery").expect(404);
    await owner.post(`${base}/publish`).expect(200);
    await request(t.server).get("/v1/providers/offline-recovery").expect(200);
    await t.db.db
      .update(organizations)
      .set({ status: "suspended" })
      .where(eq(organizations.id, orgId));
    await request(t.server).get("/v1/providers/offline-recovery").expect(404);

    const actions = (
      await t.db.db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId))
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "provider_profile.published",
        "provider_profile.unpublished",
        "provider_profile.draft_saved",
      ]),
    );
    const [row] = await t.db.db
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.organizationId, orgId));
    expect(row?.publishedBy).not.toBeNull();
  });

  it("the preview shows both audiences before publishing", async () => {
    const owner = person("pub-preview");
    const { base } = await completeTowing(owner, "preview-recovery");
    const preview = (await owner.get(`${base}/preview`).expect(200)).body as {
      visitor: PublicProviderProfile;
      signedIn: PublicProviderProfile;
      issues: unknown[];
    };
    expect(preview.issues).toEqual([]);
    expect(preview.visitor.contact).toBeNull();
    expect(preview.signedIn.contact?.phone).toBe("+27 21 555 0100");
    await request(t.server).get("/v1/providers/preview-recovery").expect(404); // still a draft
  });
});

describe("media", () => {
  async function uploadImage(owner: Person, base: string, kind: string, data: Buffer) {
    const created = (
      await owner
        .post(`${base}/media`, {
          kind,
          contentType: "image/png",
          size: data.length,
          altText: "Our yard",
        })
        .expect(201)
    ).body as { mediaId: string; upload: { url: string; headers: Record<string, string> } };
    await request(t.server)
      .put(new URL(created.upload.url).pathname)
      .set(created.upload.headers)
      .send(data)
      .expect(200);
    return {
      mediaId: created.mediaId,
      completed: await owner.post(`${base}/media/${created.mediaId}/complete`),
    };
  }

  it("strips location metadata before images go public", async () => {
    const owner = person("media-strip");
    const { base } = await completeTowing(owner, "media-recovery");
    const gps = "GPSLatitude=-33.9249;GPSLongitude=18.4241";
    const { completed } = await uploadImage(owner, base, "gallery", samplePng(gps));
    expect(completed.status).toBe(200);
    const { url } = completed.body as { url: string };
    const served = await request(t.server)
      .get(new URL(url).pathname)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          done(null, Buffer.concat(chunks));
        });
      })
      .expect(200);
    const bytes = served.body as Buffer;
    expect(bytes.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(bytes.equals(samplePng())).toBe(true);

    await owner.post(`${base}/publish`).expect(200);
    const live = (await request(t.server).get("/v1/providers/media-recovery").expect(200))
      .body as PublicProviderProfile;
    expect(live.media).toEqual([
      expect.objectContaining({ kind: "gallery", url, altText: "Our yard" }),
    ]);
  });

  it("removed images disappear from the live profile immediately; a new logo replaces the old one", async () => {
    const owner = person("media-remove");
    const { base } = await completeTowing(owner, "removal-recovery");
    const gallery = await uploadImage(owner, base, "gallery", samplePng());
    await uploadImage(owner, base, "logo", samplePng());
    await owner.post(`${base}/publish`).expect(200);
    await owner.del(`${base}/media/${gallery.mediaId}`).expect(204);
    const logo2 = await uploadImage(owner, base, "logo", samplePng());
    const live = (await request(t.server).get("/v1/providers/removal-recovery").expect(200))
      .body as PublicProviderProfile;
    // The snapshot referenced the old logo and the gallery image; both are gone now.
    expect(live.media).toEqual([]);
    await owner.post(`${base}/publish`).expect(200);
    const republished = (await request(t.server).get("/v1/providers/removal-recovery").expect(200))
      .body as PublicProviderProfile;
    expect(republished.media.map((m) => m.id)).toEqual([logo2.mediaId]);
  });

  it("rejects non-images and malware, and caps the gallery", async () => {
    const owner = person("media-bad");
    const { base } = await provider(owner);
    const pdf = await uploadImage(owner, base, "gallery", Buffer.from("%PDF-1.4 not an image"));
    expect(reason(pdf.completed.body)).toBe("content_type_mismatch");
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    const infected = await uploadImage(owner, base, "gallery", samplePng(eicar));
    expect(reason(infected.completed.body)).toBe("malware_detected");

    for (let i = 0; i < 12; i++) {
      await owner
        .post(`${base}/media`, { kind: "gallery", contentType: "image/png", size: 100 })
        .expect(201);
    }
    expect(
      reason(
        (
          await owner
            .post(`${base}/media`, { kind: "gallery", contentType: "image/png", size: 100 })
            .expect(409)
        ).body,
      ),
    ).toBe("too_many_images");
  });
});
