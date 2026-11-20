import { auditEvents, eq, providerOfferings } from "@fleettrust/db";
import {
  type BranchDto,
  type BranchHoursDto,
  createdInvitationSchema,
  INDICATIVE_PRICE_DISCLAIMER,
  MAX_OFFERINGS,
  type MyOrganization,
  type OfferingDto,
  type ProviderProfileDto,
  type PublicProviderProfile,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;

/** Friday 20 November 2026, 10:00 UTC (10:00 in London, which is on GMT in November). */
const NOW = new Date("2026-11-20T10:00:00Z");
const clock = { at: NOW, now: () => clock.at };

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
    email,
    get: (path: string) => request(t.server).get(path).set(auth()),
    post: (path: string, body?: object) =>
      request(t.server)
        .post(path)
        .set(auth())
        .send(body ?? {}),
    patch: (path: string, body: object) => request(t.server).patch(path).set(auth()).send(body),
    put: (path: string, body: object) => request(t.server).put(path).set(auth()).send(body),
    del: (path: string) => request(t.server).delete(path).set(auth()),
  };
}
type Person = ReturnType<typeof person>;

async function join(
  owner: Person,
  orgId: string,
  member: Person,
  role: string,
  branchId: string | null,
) {
  const created = await owner
    .post(`/v1/orgs/${orgId}/invitations`, { email: member.email, role, branchId })
    .expect(201);
  const { token } = createdInvitationSchema.parse(created.body);
  await member.post("/v1/invitations/accept", { token }).expect(200);
}

const LONDON = { lng: -0.1276, lat: 51.5072 };

/** A complete workshop provider with one ready branch (and optionally a second, unfinished one). */
async function workshop(owner: Person, slug: string) {
  const org = (
    await owner.post("/v1/orgs", { kind: "provider", name: `${owner.uid} Ltd` }).expect(201)
  ).body as MyOrganization;
  const orgId = org.organization.id;
  const base = `/v1/orgs/${orgId}/provider-profile`;
  await owner
    .patch(base, {
      slug,
      legalName: "Thames Truck Services Ltd",
      tradingName: "Thames Truck Services",
      categories: ["workshop"],
      categoryDetails: { workshop: { specialities: ["brakes", "engine"], bays: 6 } },
      vehicleTypes: ["heavy_truck", "trailer"],
      contactPhone: "+44 20 7946 0000",
    })
    .expect(200);
  const branchId = (
    (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "Depot" }).expect(201))
      .body as BranchDto
  ).id;
  await owner
    .patch(`${base}/branches/${branchId}`, {
      addressLine1: "1 Dock Road",
      locality: "London",
      countryCode: "GB",
      location: LONDON,
    })
    .expect(200);
  return { orgId, base, branchId, slug };
}

const brakes = {
  category: "workshop",
  name: "Brake inspection",
  vehicleTypes: ["heavy_truck"],
  price: { type: "fixed", currency: "GBP", amount: "95", unit: "vehicle" },
};

describe("catalog: offerings and indicative prices", () => {
  it("creates, lists, replaces and deletes offerings with every price type", async () => {
    const owner = person("cat-crud");
    const { base } = await workshop(owner, "cat-crud");
    const prices = [
      { type: "fixed", currency: "GBP", amount: "95", unit: "vehicle" },
      { type: "from", currency: "GBP", amount: "180.50", unit: "job" },
      { type: "range", currency: "GBP", min: "60", max: "85.25", unit: "hour" },
      { type: "quote_required" },
    ];
    const created: OfferingDto[] = [];
    for (const [i, price] of prices.entries()) {
      const res = await owner
        .post(`${base}/offerings`, {
          ...brakes,
          name: `Service ${String(i)}`,
          price,
          sortOrder: 10 - i,
        })
        .expect(201);
      created.push(res.body as OfferingDto);
    }
    // Amounts come back exactly as entered (trailing zeros trimmed), not as floats.
    expect(created.map((o) => o.price)).toEqual([
      { type: "fixed", currency: "GBP", amount: "95", unit: "vehicle" },
      { type: "from", currency: "GBP", amount: "180.5", unit: "job" },
      { type: "range", currency: "GBP", min: "60", max: "85.25", unit: "hour" },
      { type: "quote_required" },
    ]);
    const listed = (await owner.get(`${base}/offerings`).expect(200)).body as OfferingDto[];
    expect(listed.map((o) => o.name)).toEqual(["Service 3", "Service 2", "Service 1", "Service 0"]);

    const first = created[0];
    if (!first) throw new Error("no offering");
    const replaced = (
      await owner
        .put(`${base}/offerings/${first.id}`, {
          ...brakes,
          name: "Brake inspection (full)",
          price: { type: "quote_required" },
        })
        .expect(200)
    ).body as OfferingDto;
    expect(replaced).toMatchObject({
      name: "Brake inspection (full)",
      price: { type: "quote_required" },
    });
    await owner.del(`${base}/offerings/${first.id}`).expect(204);
    await owner.del(`${base}/offerings/${first.id}`).expect(404);
    expect(((await owner.get(`${base}/offerings`).expect(200)).body as OfferingDto[]).length).toBe(
      3,
    );
  });

  it("validates currency, precision, branches and shape", async () => {
    const owner = person("cat-validate");
    const { base } = await workshop(owner, "cat-validate");
    const other = await workshop(person("cat-validate-other"), "cat-validate-other");
    const post = (body: object) => owner.post(`${base}/offerings`, { ...brakes, ...body });

    expect(
      reason(
        (
          await post({
            price: { type: "fixed", currency: "ABC", amount: "1", unit: "job" },
          }).expect(400)
        ).body,
      ),
    ).toBe("unknown_currency");
    // JPY is displayed without decimals; KWD allows three.
    expect(
      reason(
        (
          await post({
            price: { type: "fixed", currency: "JPY", amount: "5000.5", unit: "job" },
          }).expect(400)
        ).body,
      ),
    ).toBe("too_many_decimals");
    await post({ price: { type: "fixed", currency: "JPY", amount: "5000", unit: "job" } }).expect(
      201,
    );
    await post({ price: { type: "fixed", currency: "KWD", amount: "12.125", unit: "job" } }).expect(
      201,
    );
    // Another tenant's branch can't be referenced.
    expect(reason((await post({ branchIds: [other.branchId] }).expect(400)).body)).toBe(
      "unknown_branch",
    );
    const bad = await post({
      price: { type: "range", currency: "GBP", min: "90", max: "80", unit: "job" },
    }).expect(400);
    expect(bad.body).toMatchObject({ error: "validation_failed", issues: [{ path: "price.max" }] });
    await post({ price: { type: "fixed", currency: "GBP", amount: 95, unit: "job" } }).expect(400);
    await post({ vehicleTypes: [] }).expect(400);
  });

  it("caps the catalog size", async () => {
    const owner = person("cat-cap");
    const { orgId, base } = await workshop(owner, "cat-cap");
    await owner.post(`${base}/offerings`, brakes).expect(201);
    await t.db.db.insert(providerOfferings).values(
      Array.from({ length: MAX_OFFERINGS - 1 }, (_, i) => ({
        organizationId: orgId,
        category: "workshop",
        name: `Bulk ${String(i)}`,
        vehicleTypes: ["heavy_truck"],
        priceType: "quote_required" as const,
      })),
    );
    expect(reason((await owner.post(`${base}/offerings`, brakes).expect(409)).body)).toBe(
      "too_many_offerings",
    );
  });

  it("the database refuses inconsistent price rows even without the API", async () => {
    const owner = person("cat-db");
    const { orgId } = await workshop(owner, "cat-db");
    await expect(
      t.db.db.insert(providerOfferings).values({
        organizationId: orgId,
        category: "workshop",
        name: "Bad",
        vehicleTypes: ["car"],
        priceType: "quote_required",
        currency: "GBP",
        priceAmount: "10",
      }),
    ).rejects.toThrow();
    await expect(
      t.db.db.insert(providerOfferings).values({
        organizationId: orgId,
        category: "workshop",
        name: "Bad range",
        vehicleTypes: ["car"],
        priceType: "range",
        currency: "GBP",
        priceAmount: "10",
        priceMax: "5",
        priceUnit: "job",
      }),
    ).rejects.toThrow();
  });

  it("only providers have catalogs; staff can read but not edit; outsiders get 404", async () => {
    const owner = person("cat-perm");
    const { orgId, base } = await workshop(owner, "cat-perm");
    const staff = person("cat-perm-staff");
    await join(owner, orgId, staff, "staff", null);
    await staff.get(`${base}/offerings`).expect(200);
    await staff.post(`${base}/offerings`, brakes).expect(403);
    await person("cat-perm-outsider").get(`${base}/offerings`).expect(404);

    const fleetOwner = person("cat-perm-fleet");
    const fleet = (
      await fleetOwner.post("/v1/orgs", { kind: "fleet", name: "Fleet Co" }).expect(201)
    ).body as MyOrganization;
    const res = await fleetOwner
      .post(`/v1/orgs/${fleet.organization.id}/provider-profile/offerings`, brakes)
      .expect(400);
    expect(reason(res.body)).toBe("not_a_provider");
  });
});

describe("catalog: publication", () => {
  it("prices go public only with the snapshot, labelled indicative, with the disclaimer", async () => {
    const owner = person("cat-pub");
    const { base, slug } = await workshop(owner, "cat-pub");
    const offering = (await owner.post(`${base}/offerings`, brakes).expect(201))
      .body as OfferingDto;
    await owner.post(`${base}/publish`).expect(200);

    const visitor = (await request(t.server).get(`/v1/providers/${slug}`).expect(200))
      .body as PublicProviderProfile;
    expect(visitor.catalog.disclaimer).toBe(INDICATIVE_PRICE_DISCLAIMER);
    expect(visitor.catalog.offerings).toEqual([
      expect.objectContaining({
        id: offering.id,
        name: "Brake inspection",
        price: {
          type: "fixed",
          currency: "GBP",
          amount: "95",
          unit: "vehicle",
          indicative: true,
          label: "£95.00 per vehicle",
        },
      }),
    ]);
    // No payment affordances anywhere in the public payload.
    expect(JSON.stringify(visitor)).not.toMatch(/checkout|payUrl|paymentLink|cart/i);
    await request(t.server).post(`/v1/providers/${slug}/checkout`).expect(404);

    // A draft price change stays private until republished.
    await owner
      .put(`${base}/offerings/${offering.id}`, {
        ...brakes,
        price: { type: "from", currency: "GBP", amount: "120", unit: "vehicle" },
      })
      .expect(200);
    const draft = (await owner.get(base).expect(200)).body as ProviderProfileDto;
    expect(draft.hasUnpublishedChanges).toBe(true);
    const stillLive = (await request(t.server).get(`/v1/providers/${slug}`).expect(200))
      .body as PublicProviderProfile;
    expect(stillLive.catalog.offerings[0]?.price.label).toBe("£95.00 per vehicle");
    await owner.post(`${base}/publish`).expect(200);
    const republished = (await request(t.server).get(`/v1/providers/${slug}`).expect(200))
      .body as PublicProviderProfile;
    expect(republished.catalog.offerings[0]?.price.label).toBe("From £120.00 per vehicle");
  });

  it("blocks publication when offerings no longer fit the profile", async () => {
    const owner = person("cat-fit");
    const { orgId, base } = await workshop(owner, "cat-fit");
    const towing = (
      await owner
        .post(`${base}/offerings`, { ...brakes, category: "towing", name: "Recovery" })
        .expect(201)
    ).body as OfferingDto;
    const cars = (
      await owner
        .post(`${base}/offerings`, { ...brakes, name: "Car brakes", vehicleTypes: ["car"] })
        .expect(201)
    ).body as OfferingDto;
    const callout = (
      await owner
        .post(`${base}/offerings`, { ...brakes, name: "Call-out", serviceLocation: "at_customer" })
        .expect(201)
    ).body as OfferingDto;
    const unfinished = (
      (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "Yard 2" }).expect(201))
        .body as BranchDto
    ).id;
    const yardOnly = (
      await owner
        .post(`${base}/offerings`, { ...brakes, name: "Yard service", branchIds: [unfinished] })
        .expect(201)
    ).body as OfferingDto;

    const profile = (await owner.get(base).expect(200)).body as ProviderProfileDto;
    expect(profile.canPublish).toBe(false);
    expect(profile.steps.find((s) => s.id === "catalog")?.issues.map((i) => i.path)).toEqual([
      `catalog.${towing.id}.category`,
      `catalog.${cars.id}.vehicleTypes`,
      `catalog.${callout.id}.serviceLocation`,
      `catalog.${yardOnly.id}.branchIds`,
    ]);
    const refused = await owner.post(`${base}/publish`).expect(422);
    expect(reason(refused.body)).toBe("profile_incomplete");
  });

  it("an empty catalog doesn't block publication", async () => {
    const owner = person("cat-empty");
    const { base, slug } = await workshop(owner, "cat-empty");
    await owner.post(`${base}/publish`).expect(200);
    const visitor = (await request(t.server).get(`/v1/providers/${slug}`).expect(200))
      .body as PublicProviderProfile;
    expect(visitor.catalog.offerings).toEqual([]);
  });
});

describe("opening hours", () => {
  const weekdays = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri"].map((d) => [d, [{ opens: "08:00", closes: "17:00" }]]),
  );

  it("saves the week in the branch timezone and computes open-now in local time", async () => {
    const owner = person("hours-basic");
    const { base, branchId } = await workshop(owner, "hours-basic");
    const hoursPath = `${base}/branches/${branchId}/hours`;

    const before = (await owner.get(hoursPath).expect(200)).body as BranchHoursDto;
    expect(before).toMatchObject({
      weekly: null,
      timeZone: "UTC",
      timeZoneSource: "organization",
      status: { known: false, isOpen: false },
    });

    const saved = (
      await owner
        .put(hoursPath, {
          timeZone: "Europe/London",
          weekly: { ...weekdays, sat: [{ opens: "22:00", closes: "02:00" }] },
        })
        .expect(200)
    ).body as BranchHoursDto;
    expect(saved).toMatchObject({
      timeZone: "Europe/London",
      timeZoneSource: "branch",
      weekly: {
        fri: [{ opens: "08:00", closes: "17:00" }],
        sat: [{ opens: "22:00", closes: "02:00" }],
      },
      status: {
        known: true,
        isOpen: true,
        localTime: "2026-11-20T10:00",
        closesAt: "2026-11-20T17:00",
      },
    });

    // In Tokyo (UTC+9) the same instant is 19:00: closed until Monday 08:00.
    const tokyo = (
      await owner.put(hoursPath, { timeZone: "Asia/Tokyo", weekly: weekdays }).expect(200)
    ).body as BranchHoursDto;
    expect(tokyo.status).toMatchObject({
      isOpen: false,
      localTime: "2026-11-20T19:00",
      opensAt: "2026-11-23T08:00",
    });

    await owner.put(hoursPath, { timeZone: "Mars/Olympus", weekly: weekdays }).expect(400);
    await owner
      .put(hoursPath, {
        timeZone: null,
        weekly: {
          mon: [
            { opens: "08:00", closes: "12:00" },
            { opens: "11:00", closes: "13:00" },
          ],
        },
      })
      .expect(400);
  });

  it("falls back to the organization's timezone", async () => {
    const owner = person("hours-orgtz");
    const { orgId, base, branchId } = await workshop(owner, "hours-orgtz");
    await owner.patch(`/v1/orgs/${orgId}`, { timeZone: "America/New_York" }).expect(200);
    const hours = (
      await owner
        .put(`${base}/branches/${branchId}/hours`, { timeZone: null, weekly: weekdays })
        .expect(200)
    ).body as BranchHoursDto;
    // 10:00Z is 05:00 in New York (EST).
    expect(hours).toMatchObject({
      timeZone: "America/New_York",
      timeZoneSource: "organization",
      status: { isOpen: false, localTime: "2026-11-20T05:00", opensAt: "2026-11-20T08:00" },
    });
  });

  it("holiday exceptions use the branch's local date and show live on the public profile", async () => {
    const owner = person("hours-holiday");
    const { base, branchId, slug } = await workshop(owner, "hours-holiday");
    const hoursPath = `${base}/branches/${branchId}/hours`;
    await owner.put(hoursPath, { timeZone: "Europe/London", weekly: weekdays }).expect(200);
    await owner.post(`${base}/publish`).expect(200);

    const open = (await request(t.server).get(`/v1/providers/${slug}`).expect(200))
      .body as PublicProviderProfile;
    expect(open.branches[0]?.hours.status).toMatchObject({ isOpen: true });
    expect(open.branches[0]?.timeZone).toBe("Europe/London");

    // Closing today takes effect without republishing.
    await owner
      .put(`${hoursPath}/exceptions/2026-11-20`, { closed: true, label: "Staff training" })
      .expect(200);
    const closed = (await request(t.server).get(`/v1/providers/${slug}`).expect(200))
      .body as PublicProviderProfile;
    expect(closed.branches[0]?.hours).toMatchObject({
      status: { isOpen: false, exception: "Staff training", opensAt: "2026-11-23T08:00" },
      exceptions: [{ date: "2026-11-20", closed: true, label: "Staff training", intervals: [] }],
    });

    // Special hours replace an existing exception for the same date.
    await owner
      .put(`${hoursPath}/exceptions/2026-11-20`, {
        closed: false,
        label: "Short day",
        intervals: [{ opens: "09:00", closes: "12:00" }],
      })
      .expect(200);
    const short = (await owner.get(hoursPath).expect(200)).body as BranchHoursDto;
    expect(short.exceptions).toEqual([
      {
        date: "2026-11-20",
        closed: false,
        label: "Short day",
        intervals: [{ opens: "09:00", closes: "12:00" }],
      },
    ]);
    expect(short.status).toMatchObject({ isOpen: true, closesAt: "2026-11-20T12:00" });

    await owner.del(`${hoursPath}/exceptions/2026-11-20`).expect(204);
    await owner.del(`${hoursPath}/exceptions/2026-11-20`).expect(404);
    await owner.put(`${hoursPath}/exceptions/2026-02-30`, { closed: true }).expect(400);

    const events = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, branchId));
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "branch.hours_saved",
        "branch.hours_exception_saved",
        "branch.hours_exception_removed",
      ]),
    );
  });

  it("rejects exception dates in the past or too far ahead, in the branch's own calendar", async () => {
    const owner = person("hours-dates");
    const { base, branchId } = await workshop(owner, "hours-dates");
    const hoursPath = `${base}/branches/${branchId}/hours`;
    clock.at = new Date("2026-11-20T11:30:00Z"); // Already 21 Nov 00:30 in Auckland.
    try {
      await owner.put(hoursPath, { timeZone: "Pacific/Auckland", weekly: weekdays }).expect(200);
      const past = await owner
        .put(`${hoursPath}/exceptions/2026-11-20`, { closed: true })
        .expect(400);
      expect(reason(past.body)).toBe("date_out_of_range");
      await owner.put(`${hoursPath}/exceptions/2026-11-21`, { closed: true }).expect(200);

      // For a London branch the 20th is still today.
      await owner.put(hoursPath, { timeZone: "Europe/London", weekly: weekdays }).expect(200);
      await owner.put(`${hoursPath}/exceptions/2026-11-20`, { closed: true }).expect(200);
      await owner.put(`${hoursPath}/exceptions/2028-12-31`, { closed: true }).expect(400);
    } finally {
      clock.at = NOW;
    }
  });

  it("hours are kept when not provided, and deleting a branch removes its hours", async () => {
    const owner = person("hours-delete");
    const { orgId, base } = await workshop(owner, "hours-delete");
    const extra = (
      (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "Annex" }).expect(201))
        .body as BranchDto
    ).id;
    await owner
      .put(`${base}/branches/${extra}/hours`, { timeZone: null, weekly: weekdays })
      .expect(200);
    await owner
      .put(`${base}/branches/${extra}/hours/exceptions/2026-12-25`, { closed: true })
      .expect(200);
    await owner.del(`/v1/orgs/${orgId}/branches/${extra}`).expect(204);
    await owner.get(`${base}/branches/${extra}/hours`).expect(404);
  });
});

describe("branch-scoped managers", () => {
  it("manage hours and offerings for their own branch only, and can't publish", async () => {
    const owner = person("scope-owner");
    const { orgId, base, branchId } = await workshop(owner, "scope-owner");
    const other = (
      (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "North" }).expect(201))
        .body as BranchDto
    ).id;
    const manager = person("scope-manager");
    await join(owner, orgId, manager, "manager", branchId);
    const weekly = { mon: [{ opens: "07:00", closes: "19:00" }] };

    await manager.put(`${base}/branches/${branchId}/hours`, { timeZone: null, weekly }).expect(200);
    await manager.put(`${base}/branches/${other}/hours`, { timeZone: null, weekly }).expect(404);
    await manager
      .put(`${base}/branches/${other}/hours/exceptions/2026-12-25`, { closed: true })
      .expect(404);

    const mine = (
      await manager.post(`${base}/offerings`, { ...brakes, branchIds: [branchId] }).expect(201)
    ).body as OfferingDto;
    await manager
      .put(`${base}/offerings/${mine.id}`, {
        ...brakes,
        name: "Brake check",
        branchIds: [branchId],
      })
      .expect(200);
    expect(reason((await manager.post(`${base}/offerings`, brakes).expect(403)).body)).toBe(
      "outside_branch_scope",
    );
    expect(
      reason(
        (
          await manager
            .put(`${base}/offerings/${mine.id}`, { ...brakes, branchIds: [] })
            .expect(403)
        ).body,
      ),
    ).toBe("outside_branch_scope");
    const orgWide = (await owner.post(`${base}/offerings`, brakes).expect(201)).body as OfferingDto;
    await manager.del(`${base}/offerings/${orgWide.id}`).expect(403);
    await manager.del(`${base}/offerings/${mine.id}`).expect(204);

    await manager.post(`${base}/publish`).expect(403);

    const staff = person("scope-staff");
    await join(owner, orgId, staff, "staff", branchId);
    await staff.put(`${base}/branches/${branchId}/hours`, { timeZone: null, weekly }).expect(403);
  });
});
