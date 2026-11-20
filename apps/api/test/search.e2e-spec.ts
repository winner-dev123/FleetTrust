import {
  organizations,
  eq,
  platformStaff,
  verificationBadges,
  verificationCases,
} from "@fleettrust/db";
import {
  type BranchDto,
  type GeocodeResult,
  INDICATIVE_PRICE_DISCLAIMER,
  type MapConfig,
  type MyOrganization,
  type PlanDto,
  type ProviderSearchPage,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;

/** Friday 20 November 2026, 10:00 UTC. */
const clock = { now: () => new Date("2026-11-20T10:00:00Z") };

beforeAll(async () => {
  t = await createTestApp({ clock });
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
    get: (path: string) => request(t.server).get(path).set(auth()),
    post: (path: string, body?: object) =>
      request(t.server)
        .post(path)
        .set(auth())
        .send(body ?? {}),
    patch: (path: string, body: object) => request(t.server).patch(path).set(auth()).send(body),
    put: (path: string, body: object) => request(t.server).put(path).set(auth()).send(body),
  };
}
type Person = ReturnType<typeof person>;

const visitor = (query: string) => request(t.server).get(`/v1/search/providers?${query}`);

interface ProviderSpec {
  slug: string;
  at: { lng: number; lat: number };
  categories?: string[];
  vehicleTypes?: string[];
  radiusKm?: number;
  offering?: string;
  description?: string;
}

const DETAILS: Record<string, object> = {
  workshop: { specialities: ["brakes"], bays: 2 },
  towing: { maxTowWeightKg: 20_000, recoveryTypes: ["heavy"], operates24h: true },
  fuel_station: { fuelTypes: ["diesel"], heavyVehicleAccess: true },
};

/** A provider created and published through the real wizard API. */
async function publish(owner: Person, spec: ProviderSpec) {
  const org = (
    await owner.post("/v1/orgs", { kind: "provider", name: `${spec.slug} org` }).expect(201)
  ).body as MyOrganization;
  const orgId = org.organization.id;
  const base = `/v1/orgs/${orgId}/provider-profile`;
  const categories = spec.categories ?? ["workshop"];
  await owner
    .patch(base, {
      slug: spec.slug,
      legalName: `${spec.slug} Ltd`,
      tradingName: spec.slug.replace(/-/g, " "),
      description: spec.description ?? null,
      categories,
      categoryDetails: Object.fromEntries(categories.map((c) => [c, DETAILS[c]])),
      vehicleTypes: spec.vehicleTypes ?? ["heavy_truck"],
      contactPhone: "+27 21 555 0100",
      contactEmail: `${spec.slug}@example.test`,
    })
    .expect(200);
  const branchId = (
    (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "Main" }).expect(201)).body as BranchDto
  ).id;
  await owner
    .patch(`${base}/branches/${branchId}`, {
      addressLine1: "7 Secret Street",
      postalCode: "8001",
      locality: "Testville",
      countryCode: "ZA",
      location: spec.at,
      phone: "+27 21 555 0199",
      ...(spec.radiusKm ? { serviceRadiusKm: spec.radiusKm } : {}),
    })
    .expect(200);
  if (spec.offering) {
    await owner
      .post(`${base}/offerings`, {
        category: categories[0],
        name: spec.offering,
        vehicleTypes: [(spec.vehicleTypes ?? ["heavy_truck"])[0]],
        price: { type: "from", currency: "ZAR", amount: "450", unit: "job" },
      })
      .expect(201);
  }
  await owner.post(`${base}/publish`).expect(200);
  return { orgId, base, branchId };
}

describe("privacy", () => {
  it("visitors get rounded locations and distances, and no contact or street details", async () => {
    const owner = person("search-privacy");
    const at = { lng: 18.42412, lat: -33.92487 };
    await publish(owner, { slug: "privacy-garage", at, offering: "Brake check" });

    const page = (await visitor("lat=-33.9&lng=18.4&radiusKm=10").expect(200))
      .body as ProviderSearchPage;
    const result = page.results.find((r) => r.slug === "privacy-garage");
    expect(result?.location).toEqual({ lng: 18.42, lat: -33.92, approximate: true });
    // Distance from the rounded point, one decimal: it can't be used to triangulate the branch.
    expect(Number.isInteger(Math.round((result?.distanceKm ?? 0) * 10))).toBe(true);
    const text = JSON.stringify(page);
    expect(text).not.toMatch(/Secret Street|8001|555 0100|555 0199|@example\.test/);
    expect(page.ranking).toBe("relevance");
    expect(page.priceDisclaimer).toBe(INDICATIVE_PRICE_DISCLAIMER);
    expect(result?.priceHighlights).toEqual([
      // Intl separates the currency code with a non-breaking space.
      { name: "Brake check", label: "From ZAR\u00a0450.00 per job" },
    ]);
    expect(result?.verification).toEqual([
      { badgeType: "business", status: "unverified" },
      { badgeType: "location", status: "unverified" },
    ]);

    const signedIn = (
      await person("search-privacy-reader")
        .get("/v1/search/providers/full?lat=-33.9&lng=18.4&radiusKm=10")
        .expect(200)
    ).body as ProviderSearchPage;
    expect(signedIn.results.find((r) => r.slug === "privacy-garage")?.location).toEqual({
      ...at,
      approximate: false,
    });
    await request(t.server).get("/v1/search/providers/full?lat=-33.9&lng=18.4").expect(401);
  });

  it("only published snapshots are searchable: drafts, later edits, unpublished and suspended providers", async () => {
    const owner = person("search-lifecycle");
    const at = { lng: 22.1, lat: -28.1 };
    const query = "lat=-28.1&lng=22.1&radiusKm=5";
    const slugs = async () =>
      ((await visitor(query).expect(200)).body as ProviderSearchPage).results.map((r) => r.slug);

    const { orgId, base } = await publish(owner, { slug: "lifecycle-garage", at });
    expect(await slugs()).toEqual(["lifecycle-garage"]);

    // A draft edit isn't searchable until republished.
    await owner.patch(base, { tradingName: "Renamed Garage" }).expect(200);
    expect(
      ((await visitor(`${query}&q=renamed`).expect(200)).body as ProviderSearchPage).results,
    ).toEqual([]);
    await owner.post(`${base}/publish`).expect(200);
    expect(
      ((await visitor(`${query}&q=renamed`).expect(200)).body as ProviderSearchPage).results,
    ).toHaveLength(1);

    await owner.post(`${base}/unpublish`).expect(200);
    expect(await slugs()).toEqual([]);
    await owner.post(`${base}/publish`).expect(200);
    expect(await slugs()).toEqual(["lifecycle-garage"]);

    await t.db.db
      .update(organizations)
      .set({ status: "suspended" })
      .where(eq(organizations.id, orgId));
    expect(await slugs()).toEqual([]);
    await t.db.db
      .update(organizations)
      .set({ status: "active" })
      .where(eq(organizations.id, orgId));

    // A provider that never published doesn't appear at all.
    const draftOwner = person("search-draft-only");
    const draftOrg = (
      await draftOwner.post("/v1/orgs", { kind: "provider", name: "Draft only" }).expect(201)
    ).body as MyOrganization;
    await draftOwner
      .patch(`/v1/orgs/${draftOrg.organization.id}/provider-profile`, {
        slug: "draft-only",
        tradingName: "Draft Only",
      })
      .expect(200);
    expect(await slugs()).toEqual(["lifecycle-garage"]);
  });
});

describe("filters", () => {
  const near = "lat=-25.75&lng=28.19";

  beforeAll(async () => {
    await publish(person("search-tow"), {
      slug: "far-tow",
      at: { lng: 28.9, lat: -25.75 }, // about 71 km east
      categories: ["towing"],
      radiusKm: 100,
    });
    const fuel = await publish(person("search-fuel"), {
      slug: "pretoria-diesel",
      at: { lng: 28.2, lat: -25.75 },
      categories: ["fuel_station"],
      vehicleTypes: ["car", "heavy_truck"],
    });
    // A current business badge (the reviewer workflow itself is covered by verification tests).
    const fuelOwner = await userIdOf(person("search-fuel"));
    const [kase] = await t.db.db
      .insert(verificationCases)
      .values({
        subjectType: "organization",
        organizationId: fuel.orgId,
        badgeType: "business",
        status: "approved",
        openedBy: fuelOwner,
        submittedAt: new Date("2026-10-01T00:00:00Z"),
        decidedAt: new Date("2026-10-02T00:00:00Z"),
        decidedBy: fuelOwner,
      })
      .returning();
    await t.db.db.insert(verificationBadges).values({
      subjectType: "organization",
      organizationId: fuel.orgId,
      badgeType: "business",
      caseId: kase?.id ?? "",
      grantedBy: fuelOwner,
      grantedAt: new Date("2026-10-02T00:00:00Z"),
      expiresAt: new Date("2027-10-02T00:00:00Z"),
    });
    const workshop = await publish(person("search-workshop"), {
      slug: "pretoria-brakes",
      at: { lng: 28.21, lat: -25.75 },
      offering: "Brake inspection",
    });
    await person("search-workshop")
      .put(`${workshop.base}/branches/${workshop.branchId}/hours`, {
        timeZone: "Africa/Johannesburg",
        weekly: { fri: [{ opens: "08:00", closes: "17:00" }] },
      })
      .expect(200);
  });

  const slugs = async (query: string) =>
    ((await visitor(`${near}&${query}`).expect(200)).body as ProviderSearchPage).results.map(
      (r) => r.slug,
    );

  it("category, vehicle type, verification, open now and text", async () => {
    // The open workshop outranks the slightly nearer (closed) station: open now is a signal.
    expect(await slugs("radiusKm=10")).toEqual(["pretoria-brakes", "pretoria-diesel"]);
    expect(await slugs("radiusKm=10&category=fuel_station")).toEqual(["pretoria-diesel"]);
    expect(await slugs("radiusKm=10&vehicleType=car")).toEqual(["pretoria-diesel"]);
    expect(await slugs("radiusKm=10&verified=business")).toEqual(["pretoria-diesel"]);
    // 10:00 UTC is 12:00 in Johannesburg: the workshop is open, the station has no hours.
    expect(await slugs("radiusKm=10&openNow=true")).toEqual(["pretoria-brakes"]);
    expect(await slugs("radiusKm=10&q=brake")).toEqual(["pretoria-brakes"]);
  });

  it("open-now status on the card comes from live hours", async () => {
    const page = (await visitor(`${near}&radiusKm=10&q=brake`).expect(200))
      .body as ProviderSearchPage;
    expect(page.results[0]?.hours).toMatchObject({
      known: true,
      isOpen: true,
      closesAt: "2026-11-20T17:00",
    });
  });

  it("finds providers who travel to the searcher by service radius", async () => {
    expect(await slugs("radiusKm=10&coversLocation=true")).toEqual(["far-tow"]);
    const page = (await visitor(`${near}&radiusKm=100&category=towing`).expect(200))
      .body as ProviderSearchPage;
    expect(page.results[0]).toMatchObject({
      slug: "far-tow",
      coversSearchLocation: true,
      serviceRadiusKm: 100,
    });
  });

  it("viewport search, including the antimeridian, and validation", async () => {
    expect(
      ((await visitor("bbox=28.0,-26.0,28.5,-25.5").expect(200)).body as ProviderSearchPage).results
        .map((r) => r.slug)
        .sort(),
    ).toEqual(["pretoria-brakes", "pretoria-diesel"]);
    await visitor("bbox=179,-17,-179,-16").expect(200);
    for (const bad of [
      "",
      "lat=1",
      "lat=1&lng=1&bbox=0,0,1,1",
      "bbox=0,0,20,1",
      "bbox=0,1,1,0",
      "lat=91&lng=0",
      "lat=0&lng=0&radiusKm=500",
      "bbox=0,0,1,1&coversLocation=true",
      "lat=0&lng=0&category=car_wash",
      "lat=0&lng=0&verified=driver",
      "lat=0&lng=0&limit=500",
      "lat=0&lng=0&sponsored=true",
    ]) {
      const res = await visitor(bad);
      expect(res.status, bad).toBe(400);
    }
  });
});

async function userIdOf(p: Person): Promise<string> {
  return ((await p.get("/v1/me").expect(200)).body as { id: string }).id;
}

describe("ranking is independent of plans (ADR-0009)", () => {
  it("identical providers on free and paid plans rank by relevance only, with identical scores", async () => {
    const free = await publish(person("rank-free"), {
      slug: "rank-free",
      at: { lng: 24.0, lat: -31.0 },
    });
    const paid = await publish(person("rank-paid"), {
      slug: "rank-paid",
      at: { lng: 24.0, lat: -31.0 },
    });
    const operatorPerson = person("rank-operator");
    await t.db.db
      .insert(platformStaff)
      .values({ userId: await userIdOf(operatorPerson), role: "billing_operator" });
    const plans = (await operatorPerson.get("/v1/admin/billing/plans").expect(200))
      .body as PlanDto[];
    const pro = plans
      .find((p) => p.code === "provider-pro")
      ?.versions.find((v) => v.status === "published");
    await operatorPerson
      .post("/v1/admin/billing/assignments", {
        subject: { type: "organization", id: paid.orgId },
        planVersionId: pro?.id,
        externalReference: "Bank transfer #R1",
      })
      .expect(201);

    const page = (await visitor("lat=-31.0&lng=24.0&radiusKm=1").expect(200))
      .body as ProviderSearchPage;
    expect(page.results.map((r) => r.slug).sort()).toEqual(["rank-free", "rank-paid"]);
    // Same location and data: ties are broken by branch id (creation order), never by plan.
    const order = page.results.map((r) => r.branchId);
    expect(order).toEqual([free.branchId, paid.branchId].sort());
  });
});

describe("pagination", () => {
  it("cursor pages are complete and stable, and cursors only continue their own query", async () => {
    for (let i = 0; i < 12; i++) {
      await publish(person(`page-${String(i)}`), {
        slug: `page-provider-${String(i)}`,
        at: { lng: 27.0 + i * 0.003, lat: -29.0 },
      });
    }
    const query = "lat=-29.0&lng=27.0&radiusKm=10&limit=5";
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await visitor(`${query}${cursor ? `&cursor=${cursor}` : ""}`).expect(200);
      const page = res.body as ProviderSearchPage;
      seen.push(...page.results.map((r) => r.slug));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => `page-provider-${String(i)}`));

    const first = (await visitor(query).expect(200)).body as ProviderSearchPage;
    const next = first.nextCursor ?? "";
    // A cursor from one search can't be replayed against another, or tampered with.
    expect(
      reason(
        (await visitor(`lat=-29.0&lng=27.0&radiusKm=9&limit=5&cursor=${next}`).expect(400)).body,
      ),
    ).toBe("invalid_cursor");
    expect(reason((await visitor(`${query}&cursor=not-a-cursor`).expect(400)).body)).toBe(
      "invalid_cursor",
    );
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(next, "base64url").toString()),
        s: "1; DROP TABLE x",
      }),
    ).toString("base64url");
    expect(reason((await visitor(`${query}&cursor=${forged}`).expect(400)).body)).toBe(
      "invalid_cursor",
    );
    // Visitor cursors don't work for signed-in searches either.
    expect(
      reason(
        (
          await person("page-reader")
            .get(`/v1/search/providers/full?${query}&cursor=${next}`)
            .expect(400)
        ).body,
      ),
    ).toBe("invalid_cursor");
  });
});

describe("map adapter", () => {
  it("geocodes place names with the stub and serves client map config", async () => {
    const results = (await request(t.server).get("/v1/geo/geocode?q=cape").expect(200))
      .body as GeocodeResult[];
    expect(results[0]).toMatchObject({ label: "Cape Town, South Africa", countryCode: "ZA" });
    const sao = (await request(t.server).get("/v1/geo/geocode?q=sao%20paulo").expect(200))
      .body as GeocodeResult[];
    expect(sao[0]?.label).toBe("São Paulo, Brazil");
    expect(
      (await request(t.server).get("/v1/geo/geocode?q=london&country=ZA").expect(200)).body,
    ).toEqual([]);
    await request(t.server).get("/v1/geo/geocode?q=x").expect(400);
    const config = (await request(t.server).get("/v1/geo/map-config").expect(200))
      .body as MapConfig;
    expect(config).toEqual({ provider: "stub", tileUrl: null, attribution: null });
  });
});
