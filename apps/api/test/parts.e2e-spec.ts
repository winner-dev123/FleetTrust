import { randomUUID } from "node:crypto";

import { and, auditEvents, eq } from "@fleettrust/db";
import {
  createdInvitationSchema,
  type CreatePartRequest,
  type InboxDto,
  type InquiryDto,
  type MyOrganization,
  type PartDto,
  type PartInquiryDto,
  PARTS_DISCLAIMER,
  type PartSearchResult,
  type PublicPart,
  type ReferralDto,
  type ServiceRequestDto,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { OutboxRelay } from "../src/modules/notifications/index.js";
import { samplePng } from "./support/images.js";
import { makePerson, type Person, publishProvider } from "./support/providers.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;
/** Stock freshness and inquiry expiry follow the API clock, which these tests move forward. */
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

async function person(uid: string): Promise<Person> {
  const p = makePerson(t, uid);
  await p.patch("/v1/me", { displayName: uid }).expect(200);
  return p;
}

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

/** A published workshop in Johannesburg with branches Main and North and two staff members. */
async function shop(prefix: string) {
  const owner = await person(`${prefix}-owner`);
  const p = await publishProvider(owner, {
    slug: `${prefix}-parts`,
    at: { lng: 28.0, lat: -26.2 },
  });
  const north = (
    (await owner.post(`/v1/orgs/${p.orgId}/branches`, { name: "North" }).expect(201)).body as {
      id: string;
    }
  ).id;
  const staffMain = await person(`${prefix}-staff-main`);
  const staffNorth = await person(`${prefix}-staff-north`);
  await join(owner, p.orgId, staffMain, "staff", p.branchId);
  await join(owner, p.orgId, staffNorth, "staff", north);
  return {
    owner,
    orgId: p.orgId,
    main: p.branchId,
    north,
    staffMain,
    staffNorth,
    parts: `/v1/orgs/${p.orgId}/parts`,
  };
}

const brakePads = (branchId: string | null): CreatePartRequest => ({
  name: "Brake pad set, rear axle",
  brand: "Bosch",
  partNumber: "0 986 494 104",
  category: "brakes",
  condition: "new",
  branchId,
  price: { type: "fixed", currency: "ZAR", amount: "1450", unit: "item" },
  compatibility: [
    {
      vehicleType: "heavy_truck",
      make: "Mercedes-Benz",
      model: "Actros",
      yearFrom: 2012,
      yearTo: 2020,
    },
  ],
  stock: { status: "in_stock", quantity: 4 },
});

const search = async (query: string) =>
  (await request(t.server).get(`/v1/parts?${query}`).expect(200)).body as PartSearchResult;

describe("parts listings", () => {
  it("lists parts with compatibility and indicative prices, and labels stale stock", async () => {
    const f = await shop("p1");
    const outsider = await person("p1-outsider");

    // Staff confirm stock but can't create listings; outsiders don't see the organization.
    await f.staffMain.post(f.parts, brakePads(f.main)).expect(403);
    await outsider.get(f.parts).expect(404);
    const part = (await f.owner.post(f.parts, brakePads(f.main)).expect(201)).body as PartDto;
    expect(part).toMatchObject({
      partNumber: "0 986 494 104",
      price: {
        type: "fixed",
        amount: "1450",
        indicative: true,
        label: expect.stringContaining("1") as string,
      },
      stock: { status: "in_stock", quantity: 4, freshness: "fresh" },
      disclaimer: PARTS_DISCLAIMER,
    });
    expect(part.stock.label).toBe("In stock · confirmed today");
    // Branch scope: North staff can't see or confirm Main's stock.
    await f.staffNorth.get(`${f.parts}/${part.id}`).expect(404);
    await f.staffNorth.put(`${f.parts}/${part.id}/stock`, { status: "in_stock" }).expect(404);

    // Visitors find it by text, by part number in any format, by vehicle and by distance.
    expect((await search("q=brake%20pad")).items.map((i) => i.id)).toEqual([part.id]);
    expect((await search("partNumber=0986-494104")).items.map((i) => i.id)).toEqual([part.id]);
    const fits = await search("vehicleType=heavy_truck&make=mercedes-benz&model=ACTROS&year=2015");
    expect(fits.items.map((i) => [i.id, i.fits])).toEqual([[part.id, true]]);
    expect((await search("vehicleType=heavy_truck&make=mercedes-benz&year=2022")).items).toEqual(
      [],
    );
    expect((await search("vehicleType=heavy_truck&make=volvo")).items).toEqual([]);
    const near = await search("lat=-26.21&lng=28.01&radiusKm=10");
    expect(near.items[0]).toMatchObject({ id: part.id, provider: { slug: "p1-parts" } });
    expect(near.items[0]?.distanceKm).toBeLessThan(3);
    expect((await search("lat=-33.92&lng=18.42&radiusKm=50")).items).toEqual([]);

    // A signed-in user can filter by one of their vehicles; visitors can't pass a vehicleId.
    const driver = await person("p1-driver");
    const vehicle = (
      await driver
        .post("/v1/me/vehicles", {
          vehicleType: "heavy_truck",
          make: "Mercedes-Benz",
          model: "Actros",
          year: 2016,
        })
        .expect(201)
    ).body as { id: string };
    const mine = (await driver.get(`/v1/parts/full?vehicleId=${vehicle.id}`).expect(200))
      .body as PartSearchResult;
    expect(mine.vehicle).toMatchObject({ make: "Mercedes-Benz", year: 2016 });
    expect(mine.items.map((i) => i.id)).toEqual([part.id]);
    expect(
      reason((await request(t.server).get(`/v1/parts?vehicleId=${vehicle.id}`).expect(403)).body),
    ).toBe("not_allowed");
    await outsider.get(`/v1/parts/full?vehicleId=${vehicle.id}`).expect(404);

    // 20 days later the stock is stale: labelled everywhere, no count shown publicly.
    clock.offsetMs = 20 * DAY;
    const stale = (await request(t.server).get(`/v1/parts/${part.id}`).expect(200))
      .body as PublicPart;
    expect(stale.stock).toMatchObject({ status: "in_stock", quantity: null, freshness: "stale" });
    expect(stale.stock.label).toBe(
      "Stock not confirmed for 20 days (last reported: in stock). It may have changed: ask the provider.",
    );
    expect((await search("q=brake&inStockOnly=true")).items).toEqual([]);
    const needsCheck = (await f.owner.get(`${f.parts}?stale=true`).expect(200)).body as PartDto[];
    expect(needsCheck.map((p) => [p.id, p.stock.freshness, p.stock.quantity])).toEqual([
      [part.id, "stale", 4],
    ]);

    // Main's staff confirm it ("still in stock"): fresh again.
    const confirmed = (
      await f.staffMain
        .put(`${f.parts}/${part.id}/stock`, { status: "low_stock", quantity: 1 })
        .expect(200)
    ).body as PartDto;
    expect(confirmed.stock).toMatchObject({ status: "low_stock", quantity: 1, freshness: "fresh" });
    expect((await search("q=brake&inStockOnly=true")).items.map((i) => i.id)).toEqual([part.id]);

    // Unconfirmed for over 90 days: out of public search until confirmed again.
    clock.offsetMs = 120 * DAY;
    expect((await search("q=brake")).items).toEqual([]);
    await request(t.server).get(`/v1/parts/${part.id}`).expect(404);
    const expired = (await f.owner.get(`${f.parts}/${part.id}`).expect(200)).body as PartDto;
    expect(expired.stock.freshness).toBe("expired");

    // Archived listings and edits.
    clock.offsetMs = 0;
    await f.owner
      .put(`${f.parts}/${part.id}/stock`, { status: "in_stock", quantity: 2 })
      .expect(200);
    const { stock: _stock, ...replace } = brakePads(f.main);
    await f.owner.put(`${f.parts}/${part.id}`, { ...replace, status: "archived" }).expect(200);
    expect((await search("q=brake")).items).toEqual([]);
  });

  it("validates listings and offers no checkout", async () => {
    const f = await shop("p2");
    const fleetOwner = await person("p2-fleet");
    const fleet = (
      (await fleetOwner.post("/v1/orgs", { kind: "fleet", name: "P2 Fleet" }).expect(201))
        .body as MyOrganization
    ).organization.id;
    expect(
      reason((await fleetOwner.post(`/v1/orgs/${fleet}/parts`, brakePads(null)).expect(400)).body),
    ).toBe("not_a_provider");
    const bad = await f.owner
      .post(f.parts, { ...brakePads(f.main), stock: { status: "out_of_stock", quantity: 3 } })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain("quantity");
    expect(
      reason(
        (
          await f.owner
            .post(f.parts, {
              ...brakePads(f.main),
              price: { type: "fixed", currency: "ZAR", amount: "10.123", unit: "item" },
            })
            .expect(400)
        ).body,
      ),
    ).toBe("too_many_decimals");
    expect(reason((await f.owner.post(f.parts, brakePads(randomUUID())).expect(400)).body)).toBe(
      "invalid_branch",
    );
    const part = (await f.owner.post(f.parts, brakePads(null)).expect(201)).body as PartDto;
    // Organization-wide stock is visible to branch staff, but only organization-wide members change it.
    await f.staffNorth.get(`${f.parts}/${part.id}`).expect(200);
    await f.staffNorth.put(`${f.parts}/${part.id}/stock`, { status: "in_stock" }).expect(403);

    // No checkout, cart or reservation exists for a part.
    for (const path of ["checkout", "cart", "reserve", "order"]) {
      await fleetOwner.post(`/v1/parts/${part.id}/${path}`).expect(404);
    }
    const listed = (await request(t.server).get(`/v1/parts/${part.id}`).expect(200))
      .body as PublicPart;
    expect(listed.disclaimer).toBe(PARTS_DISCLAIMER);
    expect(listed.price.indicative).toBe(true);

    // Deleting a listing is audited.
    await f.owner.del(`${f.parts}/${part.id}`).expect(204);
    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, "part"), eq(auditEvents.targetId, part.id)));
    expect(audit.map((a) => a.action)).toEqual(["part.created", "part.deleted"]);
  });
});

describe("parts availability inquiries", () => {
  it("customers and fleets ask; branch staff answer; answering confirms the stock", async () => {
    const f = await shop("q1");
    const part = (await f.owner.post(f.parts, brakePads(f.main)).expect(201)).body as PartDto;
    const customer = await person("q1-customer");
    const vehicle = (
      await customer
        .post("/v1/me/vehicles", {
          vehicleType: "heavy_truck",
          make: "Mercedes-Benz",
          model: "Actros",
          year: 2018,
        })
        .expect(201)
    ).body as { id: string };

    clock.offsetMs = 10 * DAY; // the stock is "aging"
    const asked = (
      await customer
        .post("/v1/me/part-inquiries", {
          partId: part.id,
          quantity: 2,
          message: "Need them by Friday.",
          vehicleId: vehicle.id,
        })
        .expect(201)
    ).body as PartInquiryDto;
    expect(asked).toMatchObject({
      status: "open",
      partName: "Brake pad set, rear axle",
      partNumber: "0 986 494 104",
      quantity: 2,
      vehicle: { vehicleType: "heavy_truck", make: "Mercedes-Benz", model: "Actros", year: 2018 },
      provider: { slug: "q1-parts" },
      answer: null,
      disclaimer: PARTS_DISCLAIMER,
    });
    expect(Object.keys(asked)).not.toContain("price");
    expect(
      reason((await customer.post("/v1/me/part-inquiries", { partId: part.id }).expect(409)).body),
    ).toBe("already_asked");
    // Members can't ask their own business.
    expect(
      reason(
        (await f.staffNorth.post("/v1/me/part-inquiries", { partId: part.id }).expect(400)).body,
      ),
    ).toBe("own_part");

    // Branch scope: North staff don't see Main's inquiry; Main's staff answer it.
    const received = `/v1/orgs/${f.orgId}/received-part-inquiries`;
    expect((await f.staffNorth.get(received).expect(200)).body).toEqual([]);
    await f.staffNorth
      .post(`${received}/${asked.id}/answer`, { availability: "available" })
      .expect(404);
    const inbox = (await f.staffMain.get(received).expect(200)).body as PartInquiryDto[];
    expect(inbox.map((i) => [i.id, i.requester.name])).toEqual([[asked.id, "q1-customer"]]);
    await f.staffMain
      .post(`${received}/${asked.id}/answer`, { availability: "not_available", etaDays: 3 })
      .expect(400);
    const answered = (
      await f.staffMain
        .post(`${received}/${asked.id}/answer`, {
          availability: "available",
          quantityAvailable: 3,
          message: "Collect at the Main counter.",
        })
        .expect(200)
    ).body as PartInquiryDto;
    expect(answered).toMatchObject({
      status: "answered",
      answer: { availability: "available", quantityAvailable: 3, etaDays: null },
    });
    // The answer was a shelf check: the listing is fresh again with the new count.
    const listing = (await f.owner.get(`${f.parts}/${part.id}`).expect(200)).body as PartDto;
    expect(listing.stock).toMatchObject({ status: "in_stock", quantity: 3, freshness: "fresh" });

    // Notifications both ways.
    const relay = t.app.get(OutboxRelay);
    await relay.drain();
    const staffKinds = (
      (await f.staffMain.get("/v1/me/inbox").expect(200)).body as InboxDto
    ).notifications.map((n) => n.kind);
    expect(staffKinds).toContain("part_inquiry");
    expect(
      ((await f.staffNorth.get("/v1/me/inbox").expect(200)).body as InboxDto).notifications.map(
        (n) => n.kind,
      ),
    ).not.toContain("part_inquiry");
    const customerInbox = (await customer.get("/v1/me/inbox").expect(200)).body as InboxDto;
    expect(customerInbox.notifications.map((n) => [n.kind, n.body])).toContainEqual([
      "part_inquiry_answered",
      "q1 parts answered about Brake pad set, rear axle: it's available.",
    ]);

    // The customer closes it; it can't be answered after that.
    await customer.post(`/v1/me/part-inquiries/${asked.id}/close`).expect(200);
    expect(
      reason(
        (
          await f.staffMain
            .post(`${received}/${asked.id}/answer`, { availability: "can_order" })
            .expect(409)
        ).body,
      ),
    ).toBe("invalid_transition");

    // A fleet asks too; an unanswered question expires after 14 days.
    const fleetOwner = await person("q1-fleet");
    const fleet = (
      (await fleetOwner.post("/v1/orgs", { kind: "fleet", name: "Q1 Fleet" }).expect(201))
        .body as MyOrganization
    ).organization.id;
    const fleetAsk = (
      await fleetOwner
        .post(`/v1/orgs/${fleet}/part-inquiries`, { partId: part.id, quantity: 8 })
        .expect(201)
    ).body as PartInquiryDto;
    expect(fleetAsk.requester).toMatchObject({
      kind: "organization",
      name: "Q1 Fleet",
      organizationId: fleet,
    });
    await customer.get(`/v1/me/part-inquiries/${fleetAsk.id}`).expect(404);
    clock.offsetMs = 25 * DAY;
    const later = (await fleetOwner.get(`/v1/orgs/${fleet}/part-inquiries`).expect(200))
      .body as PartInquiryDto[];
    expect(later.map((i) => i.status)).toEqual(["expired"]);
    await f.owner
      .post(`${received}/${fleetAsk.id}/answer`, { availability: "can_order", etaDays: 5 })
      .expect(409);
  });
});

describe("provider referrals", () => {
  async function upload(p: Person, data: Buffer): Promise<string> {
    const created = (
      await p
        .post("/v1/service-request-attachments", { contentType: "image/png", size: data.length })
        .expect(201)
    ).body as { attachmentId: string; upload: { url: string; headers: Record<string, string> } };
    await request(t.server)
      .put(new URL(created.upload.url).pathname)
      .set(created.upload.headers)
      .send(data)
      .expect(200);
    await p.post(`/v1/service-request-attachments/${created.attachmentId}/complete`).expect(200);
    return created.attachmentId;
  }

  it("shares nothing until the customer consents, discloses relationships and is audited", async () => {
    const a = await shop("r1a");
    const bOwner = await person("r1b-owner");
    const b = await publishProvider(bOwner, {
      slug: "r1-gearbox",
      at: { lng: 28.05, lat: -26.15 },
    });
    const cOwner = await person("r1c-owner");
    await publishProvider(cOwner, {
      slug: "r1-towing",
      at: { lng: 28.02, lat: -26.2 },
      categories: ["towing"],
    });
    const dOwner = await person("r1d-owner");
    await publishProvider(dOwner, { slug: "r1-other", at: { lng: 28.03, lat: -26.2 } });

    const customer = await person("r1-customer");
    const photo = await upload(customer, samplePng());
    const req = (
      await customer
        .post("/v1/me/service-requests", {
          clientRequestId: randomUUID(),
          category: "workshop",
          vehicle: { vehicleType: "heavy_truck", registration: "CA 123-456" },
          location: { lng: 28.0, lat: -26.2 },
          description: "Gearbox grinds when shifting into third gear.",
          urgency: "soon",
          photoIds: [photo],
          target: { mode: "direct", providerIds: [a.orgId] },
        })
        .expect(201)
    ).body as ServiceRequestDto;
    const recipientId =
      (
        (await a.staffMain.get(`/v1/orgs/${a.orgId}/inquiries`).expect(200)).body as InquiryDto[]
      ).find((i) => i.id === req.id)?.recipientId ?? "";
    const refer = `/v1/orgs/${a.orgId}/inquiries/${recipientId}/referrals`;
    const offer = {
      toProvider: "r1-gearbox",
      message: "They rebuild gearboxes; we don't.",
      relationship: "referral_fee",
      relationshipDetails: "We receive 5% of their invoice.",
    };

    // The relationship must be described; bad targets are refused.
    await a.staffMain.post(refer, { ...offer, relationshipDetails: null }).expect(400);
    await a.staffMain.post(refer, { ...offer, relationship: "none" }).expect(400);
    expect(
      reason(
        (await a.staffMain.post(refer, { ...offer, toProvider: "r1a-parts" }).expect(400)).body,
      ),
    ).toBe("self_referral");
    expect(
      reason(
        (await a.staffMain.post(refer, { ...offer, toProvider: "r1-towing" }).expect(400)).body,
      ),
    ).toBe("provider_not_matching");
    expect(
      reason(
        (await a.staffMain.post(refer, { ...offer, toProvider: "nobody-here" }).expect(400)).body,
      ),
    ).toBe("provider_not_found");
    // North staff can't act on Main's inquiry.
    await a.staffNorth.post(refer, offer).expect(404);

    const created = (await a.staffMain.post(refer, offer).expect(201)).body as ReferralDto;
    expect(created).toMatchObject({
      status: "pending_consent",
      to: { slug: "r1-gearbox" },
      relationship: "referral_fee",
      relationshipDetails: "We receive 5% of their invoice.",
      sharing: null,
      recipientId: null,
      history: [{ action: "proposed", side: "referrer" }],
    });
    expect(reason((await a.staffMain.post(refer, offer).expect(409)).body)).toBe(
      "already_referred",
    );

    // Before consent the other provider sees nothing at all.
    const bInquiries = `/v1/orgs/${b.orgId}/inquiries`;
    expect(
      ((await bOwner.get(bInquiries).expect(200)).body as InquiryDto[]).map((i) => i.id),
    ).not.toContain(req.id);
    expect(
      (await bOwner.get(`/v1/orgs/${b.orgId}/referrals?direction=received`).expect(200)).body,
    ).toEqual([]);
    await bOwner.get(`/v1/orgs/${b.orgId}/referrals/${created.id}`).expect(404);

    // The customer sees the suggestion with the declared relationship.
    const mine = `/v1/me/service-requests/${req.id}/referrals`;
    const pending = (await customer.get(mine).expect(200)).body as ReferralDto[];
    expect(pending).toMatchObject([
      {
        id: created.id,
        from: { slug: "r1a-parts" },
        relationshipLabel: expect.stringContaining("referral fee") as string,
        status: "pending_consent",
      },
    ]);
    const relay = t.app.get(OutboxRelay);
    await relay.drain();
    expect(
      ((await customer.get("/v1/me/inbox").expect(200)).body as InboxDto).notifications.map((n) => [
        n.kind,
        n.body,
      ]),
    ).toContainEqual([
      "referral_proposed",
      "r1a parts suggests r1 gearbox for your request. Nothing is shared with them unless you agree.",
    ]);
    // Someone else can't see or decide it.
    const stranger = await person("r1-stranger");
    await stranger.get(mine).expect(404);
    await stranger.post(`${mine}/${created.id}/consent`, { consent: true }).expect(404);

    // Consent must be explicit.
    await customer.post(`${mine}/${created.id}/consent`, {}).expect(400);
    await customer.post(`${mine}/${created.id}/consent`, { consent: false }).expect(400);
    const consented = (
      await customer
        .post(`${mine}/${created.id}/consent`, {
          consent: true,
          sharePhotos: false,
          shareOutcomeWithReferrer: true,
        })
        .expect(200)
    ).body as ReferralDto;
    expect(consented.status).toBe("consented");
    expect(consented.sharing?.consentText).toContain(
      "I agree to send my service request to r1 gearbox.",
    );
    expect(consented.sharing?.consentText).toContain("They will not see my photos.");
    expect(consented.history.map((h) => [h.action, h.side])).toEqual([
      ["proposed", "referrer"],
      ["consented", "customer"],
    ]);
    await customer.post(`${mine}/${created.id}/decline`).expect(409);

    // Now B has a normal inquiry, marked as referred, without the photo or the registration.
    const bInquiry = ((await bOwner.get(bInquiries).expect(200)).body as InquiryDto[]).find(
      (i) => i.id === req.id,
    );
    expect(bInquiry?.referredBy).toMatchObject({
      referralId: created.id,
      name: "r1a parts",
      relationship: "referral_fee",
      relationshipDetails: "We receive 5% of their invoice.",
      photosShared: false,
    });
    expect(bInquiry?.attachments).toEqual([]);
    expect(bInquiry?.vehicle.registration).toBeNull();
    await bOwner.get(`/v1/service-requests/${req.id}/attachments/${photo}`).expect(404);
    // A (chosen directly by the customer) still sees the photo.
    const aInquiry = (
      await a.staffMain.get(`/v1/orgs/${a.orgId}/inquiries/${recipientId}`).expect(200)
    ).body as InquiryDto;
    expect(aInquiry.attachments.map((x) => x.id)).toEqual([photo]);
    expect(aInquiry.referredBy).toBeNull();

    // B quotes; A may see the outcome because the customer allowed it.
    await bOwner
      .post(`${bInquiries}/${bInquiry?.recipientId ?? ""}/quotes`, {
        price: { type: "fixed", currency: "ZAR", amount: "9000", unit: "job" },
      })
      .expect(201);
    const sent = (await a.staffMain.get(`/v1/orgs/${a.orgId}/referrals`).expect(200))
      .body as ReferralDto[];
    expect(sent.map((r) => [r.id, r.outcome, r.recipientId])).toEqual([
      [created.id, "quoted", null],
    ]);
    const receivedList = (
      await bOwner.get(`/v1/orgs/${b.orgId}/referrals?direction=received`).expect(200)
    ).body as ReferralDto[];
    expect(receivedList.map((r) => [r.id, r.outcome])).toEqual([[created.id, null]]);

    // Withdraw and decline.
    const toOther = (
      await a.owner
        .post(refer, {
          ...offer,
          toProvider: "r1-other",
          relationship: "none",
          relationshipDetails: null,
        })
        .expect(201)
    ).body as ReferralDto;
    await a.owner.post(`/v1/orgs/${a.orgId}/referrals/${toOther.id}/withdraw`).expect(200);
    expect(
      reason(
        (await customer.post(`${mine}/${toOther.id}/consent`, { consent: true }).expect(409)).body,
      ),
    ).toBe("invalid_transition");
    const again = (
      await a.owner
        .post(refer, {
          ...offer,
          toProvider: "r1-other",
          relationship: "none",
          relationshipDetails: null,
        })
        .expect(201)
    ).body as ReferralDto;
    const declined = (await customer.post(`${mine}/${again.id}/decline`).expect(200))
      .body as ReferralDto;
    expect(declined).toMatchObject({ status: "declined", sharing: null });
    await relay.drain();
    const aKinds = (
      (await a.staffMain.get("/v1/me/inbox").expect(200)).body as InboxDto
    ).notifications.map((n) => n.body);
    expect(aKinds).toContain("The customer agreed to send their request to r1 gearbox.");
    expect(aKinds).toContain("The customer declined your suggestion of r1 other.");

    // The audit log has every step, with what was disclosed and consented to.
    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetType, "provider_referral"))
      .orderBy(auditEvents.occurredAt, auditEvents.id);
    const forFirst = audit.filter((e) => e.targetId === created.id);
    expect(forFirst.map((e) => e.action)).toEqual(["referral.proposed", "referral.consented"]);
    expect(forFirst[0]?.metadata).toMatchObject({
      relationship: "referral_fee",
      relationshipDetails: "We receive 5% of their invoice.",
    });
    expect(forFirst[1]?.metadata).toMatchObject({
      sharePhotos: false,
      shareOutcomeWithReferrer: true,
      consentVersion: 1,
    });
    expect(audit.filter((e) => e.targetId === toOther.id).map((e) => e.action)).toEqual([
      "referral.proposed",
      "referral.withdrawn",
    ]);
    // The request history shows the referral steps to the customer.
    const history = (
      (await customer.get(`/v1/me/service-requests/${req.id}`).expect(200))
        .body as ServiceRequestDto
    ).events.map((e) => e.type);
    expect(history).toEqual(
      expect.arrayContaining(["referral_proposed", "referral_consented", "referral_declined"]),
    );
  });

  it("lets the customer share photos and keeps the outcome private by default; pending referrals expire", async () => {
    const a = await shop("r2a");
    const bOwner = await person("r2b-owner");
    const b = await publishProvider(bOwner, {
      slug: "r2-gearbox",
      at: { lng: 28.05, lat: -26.15 },
    });
    const customer = await person("r2-customer");
    const photo = await upload(customer, samplePng());
    const make = async () =>
      (
        await customer
          .post("/v1/me/service-requests", {
            clientRequestId: randomUUID(),
            category: "workshop",
            vehicle: { vehicleType: "heavy_truck" },
            location: { lng: 28.0, lat: -26.2 },
            description: "Clutch slipping under load on hills.",
            urgency: "routine",
            target: { mode: "direct", providerIds: [a.orgId] },
          })
          .expect(201)
      ).body as ServiceRequestDto;
    const withPhoto = (
      await customer
        .post("/v1/me/service-requests", {
          clientRequestId: randomUUID(),
          category: "workshop",
          vehicle: { vehicleType: "heavy_truck" },
          location: { lng: 28.0, lat: -26.2 },
          description: "Clutch slipping under load on hills.",
          urgency: "routine",
          photoIds: [photo],
          target: { mode: "direct", providerIds: [a.orgId] },
        })
        .expect(201)
    ).body as ServiceRequestDto;
    const recipientOf = async (id: string) =>
      ((await a.owner.get(`/v1/orgs/${a.orgId}/inquiries`).expect(200)).body as InquiryDto[]).find(
        (i) => i.id === id,
      )?.recipientId ?? "";
    const offer = {
      toProvider: "r2-gearbox",
      message: "Clutch specialists nearby.",
      relationship: "partner",
      relationshipDetails: "Shared workshop space.",
    };

    const referral = (
      await a.owner
        .post(`/v1/orgs/${a.orgId}/inquiries/${await recipientOf(withPhoto.id)}/referrals`, offer)
        .expect(201)
    ).body as ReferralDto;
    await customer
      .post(`/v1/me/service-requests/${withPhoto.id}/referrals/${referral.id}/consent`, {
        consent: true,
        sharePhotos: true,
      })
      .expect(200);
    const bInquiry = (
      (await bOwner.get(`/v1/orgs/${b.orgId}/inquiries`).expect(200)).body as InquiryDto[]
    ).find((i) => i.id === withPhoto.id);
    expect(bInquiry?.referredBy?.photosShared).toBe(true);
    expect(bInquiry?.attachments.map((x) => x.id)).toEqual([photo]);
    await bOwner.get(`/v1/service-requests/${withPhoto.id}/attachments/${photo}`).expect(200);
    // Outcome not shared by default.
    await bOwner
      .post(`/v1/orgs/${b.orgId}/inquiries/${bInquiry?.recipientId ?? ""}/decline`, {})
      .expect(200);
    const sent = (await a.owner.get(`/v1/orgs/${a.orgId}/referrals/${referral.id}`).expect(200))
      .body as ReferralDto;
    expect(sent.outcome).toBeNull();
    const customerView = (
      await customer.get(`/v1/me/service-requests/${withPhoto.id}/referrals`).expect(200)
    ).body as ReferralDto[];
    expect(customerView[0]?.outcome).toBe("declined");

    // A pending referral expires with its request.
    const plain = await make();
    const later = (
      await a.owner
        .post(`/v1/orgs/${a.orgId}/inquiries/${await recipientOf(plain.id)}/referrals`, offer)
        .expect(201)
    ).body as ReferralDto;
    clock.offsetMs = 15 * DAY;
    const expired = (
      await customer.get(`/v1/me/service-requests/${plain.id}/referrals`).expect(200)
    ).body as ReferralDto[];
    expect(expired.map((r) => r.status)).toEqual(["expired"]);
    await customer
      .post(`/v1/me/service-requests/${plain.id}/referrals/${later.id}/consent`, { consent: true })
      .expect(409);
  });
});
