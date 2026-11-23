import { randomUUID } from "node:crypto";

import { eq, serviceRequestEvents, serviceRequests, sql } from "@fleettrust/db";
import {
  type BranchDto,
  createdInvitationSchema,
  type EntitlementsResponse,
  type InquiryDto,
  type MyOrganization,
  PAYMENT_DISCLAIMER,
  QUOTE_SCAM_WARNING,
  type ServiceRequestDto,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { samplePng } from "./support/images.js";
import { makePerson, type Person, publishProvider } from "./support/providers.js";
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

/** Two workshops (and a fuel station) around a point, each in its own region. */
async function region(prefix: string, lng: number, lat: number) {
  const ownerA = makePerson(t, `${prefix}-a-owner`);
  const ownerB = makePerson(t, `${prefix}-b-owner`);
  const ownerFuel = makePerson(t, `${prefix}-f-owner`);
  const a = await publishProvider(ownerA, {
    slug: `${prefix}-garage-a`,
    at: { lng: lng + 0.01, lat },
  });
  const b = await publishProvider(ownerB, {
    slug: `${prefix}-garage-b`,
    at: { lng: lng + 0.05, lat },
  });
  const fuel = await publishProvider(ownerFuel, {
    slug: `${prefix}-fuel`,
    at: { lng, lat: lat + 0.01 },
    categories: ["fuel_station"],
  });
  return { ownerA, ownerB, ownerFuel, a, b, fuel, at: { lng, lat } };
}

function requestBody(at: { lng: number; lat: number }, target: object, extra: object = {}) {
  return {
    clientRequestId: randomUUID(),
    category: "workshop",
    vehicle: {
      vehicleType: "heavy_truck",
      make: "Volvo",
      model: "FH16",
      registration: "CA 123-456",
    },
    location: { lng: at.lng + 0.001234, lat: at.lat + 0.004321 },
    locationNote: "Truck stop bay 4",
    description: "Air brake warning light on, losing pressure slowly.",
    target,
    ...extra,
  };
}

const quote = (amount = "1800") => ({
  price: { type: "from", currency: "ZAR", amount, unit: "job" },
  message: "Can be there within the hour.",
});

async function usage(p: Person, path = "/v1/me/entitlements"): Promise<number> {
  const body = (await p.get(path).expect(200)).body as EntitlementsResponse;
  return body.entitlements.find((e) => e.key === "service_requests.daily")?.used ?? -1;
}

describe("creating requests and the quota", () => {
  it("consumes one quota unit atomically; retries with the same clientRequestId don't consume again", async () => {
    const r = await region("q1", 24.0, -29.0);
    const user = makePerson(t, "q1-user");
    const body = requestBody(r.at, { mode: "direct", providerIds: [r.a.orgId, r.b.orgId] });
    const first = (await user.post("/v1/me/service-requests", body).expect(201))
      .body as ServiceRequestDto;
    const retry = (await user.post("/v1/me/service-requests", body).expect(201))
      .body as ServiceRequestDto;
    expect(retry.id).toBe(first.id);
    expect(await usage(user)).toBe(1);
    expect(first).toMatchObject({
      status: "open",
      requester: { kind: "user", organizationId: null },
      recipients: [
        { providerOrganizationId: r.a.orgId, status: "pending", quotes: [] },
        { providerOrganizationId: r.b.orgId, status: "pending", quotes: [] },
      ],
      agreement: null,
    });
    expect(first.events.map((e) => e.type)).toEqual(["created", "sent", "sent"]);
  });

  it("refuses requests above the daily limit, also under concurrency (exactly the limit succeeds)", async () => {
    const r = await region("q2", 24.5, -29.5);
    const user = makePerson(t, "q2-user");
    const target = { mode: "direct", providerIds: [r.a.orgId] };
    // personal-free allows 3 per day.
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        user.post("/v1/me/service-requests", requestBody(r.at, target)),
      ),
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(3);
    const refused = results.filter((res) => res.status === 403);
    expect(refused).toHaveLength(3);
    expect(reason(refused[0]?.body)).toBe("quota_exceeded");
    expect(await usage(user)).toBe(3);
    const rows = await t.db.db
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.createdBy, ((await user.get("/v1/me")).body as { id: string }).id));
    expect(rows).toHaveLength(3);
  });

  it("matches providers by category and vehicle near the location; no match uses no quota", async () => {
    const r = await region("q3", 25.0, -30.0);
    const user = makePerson(t, "q3-user");
    const matched = (
      await user
        .post("/v1/me/service-requests", requestBody(r.at, { mode: "match", radiusKm: 20 }))
        .expect(201)
    ).body as ServiceRequestDto;
    // The fuel station doesn't offer workshop services.
    expect(matched.recipients.map((x) => x.providerOrganizationId).sort()).toEqual(
      [r.a.orgId, r.b.orgId].sort(),
    );

    const nobody = await user
      .post(
        "/v1/me/service-requests",
        requestBody({ lng: 40, lat: 10 }, { mode: "match", radiusKm: 5 }),
      )
      .expect(422);
    expect(reason(nobody.body)).toBe("no_matching_providers");
    const wrong = await user
      .post(
        "/v1/me/service-requests",
        requestBody(r.at, { mode: "direct", providerIds: [r.fuel.orgId] }),
      )
      .expect(400);
    expect(reason(wrong.body)).toBe("provider_not_matching");
    const car = await user
      .post(
        "/v1/me/service-requests",
        requestBody(
          r.at,
          { mode: "direct", providerIds: [r.a.orgId] },
          { vehicle: { vehicleType: "car" } },
        ),
      )
      .expect(400);
    expect(reason(car.body)).toBe("provider_not_matching");
    expect(await usage(user)).toBe(1);
  });

  it("validates input", async () => {
    const user = makePerson(t, "q4-user");
    const at = { lng: 1, lat: 1 };
    for (const bad of [
      requestBody(at, { mode: "direct", providerIds: [] }),
      requestBody(at, {
        mode: "direct",
        providerIds: Array.from({ length: 6 }, () => randomUUID()),
      }),
      requestBody(at, { mode: "match", radiusKm: 500 }),
      requestBody(at, { mode: "match" }, { description: "short" }),
      requestBody(at, { mode: "match" }, { clientRequestId: "nope" }),
      requestBody(at, { mode: "match" }, { category: "car_wash" }),
      requestBody(at, { mode: "match" }, { paymentAmount: 100 }),
      requestBody(at, { mode: "match" }, { fleetBranchId: randomUUID() }),
    ]) {
      const res = await user.post("/v1/me/service-requests", bad);
      expect([400], JSON.stringify(res.body)).toContain(res.status);
    }
  });
});

describe("quotes and the lifecycle", () => {
  it("full flow: inbox privacy, quotes with disclaimers, revision, acceptance as an informational agreement, completion", async () => {
    const r = await region("lc", 26.0, -31.0);
    const user = makePerson(t, "lc-user");
    const req = (
      await user
        .post(
          "/v1/me/service-requests",
          requestBody(r.at, { mode: "direct", providerIds: [r.a.orgId, r.b.orgId] }),
        )
        .expect(201)
    ).body as ServiceRequestDto;

    // Provider A's inbox: approximate location, no registration or address note yet.
    const inbox = (await r.ownerA.get(`/v1/orgs/${r.a.orgId}/inquiries`).expect(200))
      .body as InquiryDto[];
    expect(inbox).toHaveLength(1);
    const inquiryA = inbox[0];
    if (!inquiryA) throw new Error("no inquiry");
    expect(inquiryA).toMatchObject({
      id: req.id,
      recipientStatus: "pending",
      location: { approximate: true, lng: 26, lat: -31 },
      locationNote: null,
      vehicle: { make: "Volvo", registration: null },
    });
    expect(inquiryA.distanceKm).toBeGreaterThan(0);
    const viewed = (
      await r.ownerA.get(`/v1/orgs/${r.a.orgId}/inquiries/${inquiryA.recipientId}`).expect(200)
    ).body as InquiryDto;
    expect(viewed.recipientStatus).toBe("viewed");

    // Quotes: A quotes then revises; B quotes.
    const base = (org: string, rid: string) => `/v1/orgs/${org}/inquiries/${rid}`;
    await r.ownerA
      .post(`${base(r.a.orgId, inquiryA.recipientId)}/quotes`, quote("2000"))
      .expect(201);
    const revised = (
      await r.ownerA
        .post(`${base(r.a.orgId, inquiryA.recipientId)}/quotes`, quote("1800"))
        .expect(201)
    ).body as InquiryDto;
    expect(revised.quotes.map((q) => [q.price.label, q.status])).toEqual([
      ["From ZAR 1,800.00 per job", "active"],
    ]);
    const inquiryB = (
      (await r.ownerB.get(`/v1/orgs/${r.b.orgId}/inquiries`).expect(200)).body as InquiryDto[]
    )[0];
    if (!inquiryB) throw new Error("no inquiry");
    await r.ownerB
      .post(`${base(r.b.orgId, inquiryB.recipientId)}/quotes`, quote("2500"))
      .expect(201);

    // Requester sees both, each with the payment disclaimer and scam warning.
    const withQuotes = (await user.get(`/v1/me/service-requests/${req.id}`).expect(200))
      .body as ServiceRequestDto;
    const quotes = withQuotes.recipients.flatMap((x) => x.quotes);
    expect(quotes).toHaveLength(2);
    for (const q of quotes) {
      expect(q).toMatchObject({
        disclaimer: PAYMENT_DISCLAIMER,
        scamWarning: QUOTE_SCAM_WARNING,
        price: { indicative: true },
      });
    }
    // Provider B never sees A's quote or A's events.
    const bView = (await r.ownerB.get(base(r.b.orgId, inquiryB.recipientId)).expect(200))
      .body as InquiryDto;
    expect(bView.quotes).toHaveLength(1);
    expect(
      bView.events.every(
        (e) => e.providerOrganizationId === null || e.providerOrganizationId === r.b.orgId,
      ),
    ).toBe(true);

    // Accept A's quote: an informational agreement; B is not selected.
    const aQuote = quotes.find((q) => q.providerOrganizationId === r.a.orgId);
    const accepted = (
      await user
        .post(`/v1/me/service-requests/${req.id}/quotes/${aQuote?.id ?? ""}/accept`)
        .expect(200)
    ).body as ServiceRequestDto;
    expect(accepted).toMatchObject({
      status: "accepted",
      acceptedQuoteId: aQuote?.id,
      agreement: {
        providerOrganizationId: r.a.orgId,
        informational: true,
        disclaimer: PAYMENT_DISCLAIMER,
      },
    });
    expect(accepted.recipients.map((x) => x.status).sort()).toEqual(["accepted", "not_selected"]);

    // Now A sees the exact location, address note and registration; B still doesn't.
    const aAfter = (await r.ownerA.get(base(r.a.orgId, inquiryA.recipientId)).expect(200))
      .body as InquiryDto;
    expect(aAfter).toMatchObject({
      recipientStatus: "accepted",
      location: { approximate: false, lng: 26.001234, lat: -30.995679 },
      locationNote: "Truck stop bay 4",
      vehicle: { registration: "CA 123-456" },
    });
    const bAfter = (await r.ownerB.get(base(r.b.orgId, inquiryB.recipientId)).expect(200))
      .body as InquiryDto;
    expect(bAfter).toMatchObject({
      recipientStatus: "not_selected",
      location: { approximate: true },
      vehicle: { registration: null },
    });

    // Quoting is closed; B can't quote again.
    expect(
      reason(
        (
          await r.ownerB
            .post(`${base(r.b.orgId, inquiryB.recipientId)}/quotes`, quote())
            .expect(409)
        ).body,
      ),
    ).toBe("invalid_transition");
    // Provider marks it completed.
    await r.ownerA.post(`${base(r.a.orgId, inquiryA.recipientId)}/complete`).expect(200);
    const done = (await user.get(`/v1/me/service-requests/${req.id}`).expect(200))
      .body as ServiceRequestDto;
    expect(done.status).toBe("completed");
    expect(done.events.map((e) => e.type)).toEqual([
      "created",
      "sent",
      "sent",
      "viewed",
      "quote_submitted",
      "quote_revised",
      // B quoted straight from the inbox list without opening the inquiry: no "viewed".
      "quote_submitted",
      "quote_accepted",
      "not_selected",
      "completed",
    ]);
    await user.post(`/v1/me/service-requests/${req.id}/cancel`, { reason: "too late" }).expect(409);
  });

  it("the accepted provider can cancel: the request reopens and still-valid quotes return", async () => {
    const r = await region("pc", 26.5, -31.5);
    const user = makePerson(t, "pc-user");
    const req = (
      await user
        .post(
          "/v1/me/service-requests",
          requestBody(r.at, { mode: "direct", providerIds: [r.a.orgId, r.b.orgId] }),
        )
        .expect(201)
    ).body as ServiceRequestDto;
    const rid = async (owner: Person, org: string) =>
      ((await owner.get(`/v1/orgs/${org}/inquiries`).expect(200)).body as InquiryDto[])[0]
        ?.recipientId ?? "";
    const ra = await rid(r.ownerA, r.a.orgId);
    const rb = await rid(r.ownerB, r.b.orgId);
    const qa = (
      (await r.ownerA.post(`/v1/orgs/${r.a.orgId}/inquiries/${ra}/quotes`, quote()).expect(201))
        .body as InquiryDto
    ).quotes[0]?.id;
    await r.ownerB.post(`/v1/orgs/${r.b.orgId}/inquiries/${rb}/quotes`, quote("2100")).expect(201);
    await user.post(`/v1/me/service-requests/${req.id}/quotes/${qa ?? ""}/accept`).expect(200);

    await r.ownerA
      .post(`/v1/orgs/${r.a.orgId}/inquiries/${ra}/cancel`, { reason: "Truck broke down" })
      .expect(200);
    const reopened = (await user.get(`/v1/me/service-requests/${req.id}`).expect(200))
      .body as ServiceRequestDto;
    expect(reopened).toMatchObject({ status: "open", acceptedQuoteId: null, agreement: null });
    const b = reopened.recipients.find((x) => x.providerOrganizationId === r.b.orgId);
    expect(b).toMatchObject({ status: "quoted", quotes: [{ status: "active" }] });
    expect(reopened.events.slice(-2).map((e) => e.type)).toEqual([
      "provider_cancelled",
      "reopened",
    ]);
    // The requester can accept B's quote instead.
    await user
      .post(`/v1/me/service-requests/${req.id}/quotes/${b?.quotes[0]?.id ?? ""}/accept`)
      .expect(200);
  });

  it("quotes and requests expire; declining and withdrawing work; requesters cancel with a reason", async () => {
    const r = await region("ex", 27.0, -32.0);
    const user = makePerson(t, "ex-user");
    const mk = async () =>
      (
        await user
          .post(
            "/v1/me/service-requests",
            requestBody(r.at, { mode: "direct", providerIds: [r.a.orgId, r.b.orgId] }),
          )
          .expect(201)
      ).body as ServiceRequestDto;
    const req = await mk();
    const inbox = (await r.ownerA.get(`/v1/orgs/${r.a.orgId}/inquiries`).expect(200))
      .body as InquiryDto[];
    const ra = inbox.find((i) => i.id === req.id)?.recipientId ?? "";
    const q = (
      (
        await r.ownerA
          .post(`/v1/orgs/${r.a.orgId}/inquiries/${ra}/quotes`, { ...quote(), validDays: 1 })
          .expect(201)
      ).body as InquiryDto
    ).quotes[0];

    clock.offsetMs = 2 * DAY;
    try {
      const view = (await user.get(`/v1/me/service-requests/${req.id}`).expect(200))
        .body as ServiceRequestDto;
      expect(
        view.recipients.find((x) => x.providerOrganizationId === r.a.orgId)?.quotes[0]?.status,
      ).toBe("expired");
      expect(
        reason(
          (
            await user
              .post(`/v1/me/service-requests/${req.id}/quotes/${q?.id ?? ""}/accept`)
              .expect(409)
          ).body,
        ),
      ).toBe("quote_not_active");
      clock.offsetMs = 15 * DAY;
      const expired = (await user.get(`/v1/me/service-requests/${req.id}`).expect(200))
        .body as ServiceRequestDto;
      expect(expired.status).toBe("expired");
      await r.ownerA.post(`/v1/orgs/${r.a.orgId}/inquiries/${ra}/quotes`, quote()).expect(409);
    } finally {
      clock.offsetMs = 0;
    }

    const second = await mk();
    const rb = (
      (await r.ownerB.get(`/v1/orgs/${r.b.orgId}/inquiries`).expect(200)).body as InquiryDto[]
    ).find((i) => i.id === second.id)?.recipientId;
    const declined = (
      await r.ownerB
        .post(`/v1/orgs/${r.b.orgId}/inquiries/${rb ?? ""}/decline`, { reason: "Fully booked" })
        .expect(200)
    ).body as InquiryDto;
    expect(declined.recipientStatus).toBe("declined");
    await user.post(`/v1/me/service-requests/${second.id}/cancel`, {}).expect(400);
    const cancelled = (
      await user
        .post(`/v1/me/service-requests/${second.id}/cancel`, { reason: "Fixed it myself" })
        .expect(200)
    ).body as ServiceRequestDto;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.events.at(-1)).toMatchObject({
      type: "cancelled",
      actorSide: "requester",
      note: "Fixed it myself",
    });
    await user.post(`/v1/me/service-requests/${second.id}/complete`).expect(409);
  });

  it("the event history is append-only in the database", async () => {
    const r = await region("ao", 27.5, -32.5);
    const user = makePerson(t, "ao-user");
    const req = (
      await user
        .post(
          "/v1/me/service-requests",
          requestBody(r.at, { mode: "direct", providerIds: [r.a.orgId] }),
        )
        .expect(201)
    ).body as ServiceRequestDto;
    await expect(
      t.db.db
        .update(serviceRequestEvents)
        .set({ note: "rewritten" })
        .where(eq(serviceRequestEvents.requestId, req.id)),
    ).rejects.toThrow();
    await expect(
      t.db.db.delete(serviceRequestEvents).where(eq(serviceRequestEvents.requestId, req.id)),
    ).rejects.toThrow();
    // Purging the whole request (retention) still cascades.
    await t.db.db.execute(sql`DELETE FROM service_requests WHERE id = ${req.id}::uuid`);
    expect(
      await t.db.db
        .select()
        .from(serviceRequestEvents)
        .where(eq(serviceRequestEvents.requestId, req.id)),
    ).toEqual([]);
  });
});

describe("tenant permissions", () => {
  it("only recipients see an inquiry; branch-scoped staff see their branch only; outsiders 404", async () => {
    const r = await region("tp", 28.0, -26.0);
    const user = makePerson(t, "tp-user");
    const req = (
      await user
        .post(
          "/v1/me/service-requests",
          requestBody(r.at, { mode: "direct", providerIds: [r.a.orgId] }),
        )
        .expect(201)
    ).body as ServiceRequestDto;
    const rid = req.recipients[0]?.id ?? "";

    // Provider B wasn't sent it.
    await r.ownerB.get(`/v1/orgs/${r.b.orgId}/inquiries/${rid}`).expect(404);
    await r.ownerB.get(`/v1/orgs/${r.a.orgId}/inquiries/${rid}`).expect(404); // not a member of A
    expect(
      (
        (await r.ownerB.get(`/v1/orgs/${r.b.orgId}/inquiries`).expect(200)).body as InquiryDto[]
      ).map((i) => i.id),
    ).not.toContain(req.id);

    // Staff on A's main branch can quote; staff on another branch can't see it.
    const mainStaff = makePerson(t, "tp-staff-main");
    await join(r.ownerA, r.a.orgId, mainStaff, "staff", r.a.branchId);
    await mainStaff.post(`/v1/orgs/${r.a.orgId}/inquiries/${rid}/quotes`, quote()).expect(201);
    const north = (
      (await r.ownerA.post(`/v1/orgs/${r.a.orgId}/branches`, { name: "North" }).expect(201))
        .body as BranchDto
    ).id;
    const northStaff = makePerson(t, "tp-staff-north");
    await join(r.ownerA, r.a.orgId, northStaff, "staff", north);
    await northStaff.get(`/v1/orgs/${r.a.orgId}/inquiries/${rid}`).expect(404);
    expect((await northStaff.get(`/v1/orgs/${r.a.orgId}/inquiries`).expect(200)).body).toEqual([]);

    // Other individuals can't see the request.
    await makePerson(t, "tp-stranger").get(`/v1/me/service-requests/${req.id}`).expect(404);
    // Providers don't raise requests through fleet routes.
    const fleetRoute = await r.ownerA.post(
      `/v1/orgs/${r.a.orgId}/service-requests`,
      requestBody(r.at, { mode: "match" }),
    );
    expect(fleetRoute.status).toBe(400);
    expect(reason(fleetRoute.body)).toBe("not_a_fleet");
  });

  it("fleets: drivers raise requests on the fleet quota; drivers see only their own; admins see all; recruiters can't", async () => {
    const r = await region("fl", 28.5, -26.5);
    const fleetOwner = makePerson(t, "fl-owner");
    const fleet = (
      await fleetOwner.post("/v1/orgs", { kind: "fleet", name: "Haul Co" }).expect(201)
    ).body as MyOrganization;
    const orgId = fleet.organization.id;
    const depot = (
      (await fleetOwner.post(`/v1/orgs/${orgId}/branches`, { name: "Depot" }).expect(201))
        .body as BranchDto
    ).id;
    const driver1 = makePerson(t, "fl-driver-1");
    const driver2 = makePerson(t, "fl-driver-2");
    const recruiter = makePerson(t, "fl-recruiter");
    await join(fleetOwner, orgId, driver1, "driver", depot);
    await join(fleetOwner, orgId, driver2, "driver", null);
    await join(fleetOwner, orgId, recruiter, "recruiter", null);

    const created = (
      await driver1
        .post(
          `/v1/orgs/${orgId}/service-requests`,
          requestBody(r.at, { mode: "direct", providerIds: [r.a.orgId] }),
        )
        .expect(201)
    ).body as ServiceRequestDto;
    // Branch-scoped driver: the request is filed under their branch.
    expect(created.requester).toMatchObject({
      kind: "organization",
      organizationId: orgId,
      fleetBranchId: depot,
    });
    expect(await usage(fleetOwner, `/v1/orgs/${orgId}/entitlements`)).toBe(1);
    expect(await usage(driver1)).toBe(0);

    await driver2.get(`/v1/orgs/${orgId}/service-requests/${created.id}`).expect(404);
    expect((await driver2.get(`/v1/orgs/${orgId}/service-requests`).expect(200)).body).toEqual([]);
    await fleetOwner.get(`/v1/orgs/${orgId}/service-requests/${created.id}`).expect(200);
    await recruiter.get(`/v1/orgs/${orgId}/service-requests`).expect(403);
    await recruiter
      .post(`/v1/orgs/${orgId}/service-requests`, requestBody(r.at, { mode: "match" }))
      .expect(403);
    // The fleet request isn't visible through personal routes.
    await driver1.get(`/v1/me/service-requests/${created.id}`).expect(404);
    // The owner (requests.manage) can cancel it.
    await fleetOwner
      .post(`/v1/orgs/${orgId}/service-requests/${created.id}/cancel`, { reason: "Duplicate" })
      .expect(200);
  });
});

describe("photos and evidence", () => {
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

  const bytes = (res: request.Test) =>
    res.buffer(true).parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => {
        done(null, Buffer.concat(chunks));
      });
    });

  it("photos are private, stripped of GPS, and visible only to the requester and recipients", async () => {
    const r = await region("ph", 29.0, -27.0);
    const user = makePerson(t, "ph-user");
    const photo = await upload(user, samplePng("GPSLatitude=-27.0;GPSLongitude=29.0"));
    const req = (
      await user
        .post(
          "/v1/me/service-requests",
          requestBody(r.at, { mode: "direct", providerIds: [r.a.orgId] }, { photoIds: [photo] }),
        )
        .expect(201)
    ).body as ServiceRequestDto;
    const path = req.attachments[0]?.path ?? "";
    expect(path).toBe(`/v1/service-requests/${req.id}/attachments/${photo}`);

    const mine = (await bytes(user.get(path)).expect(200)).body as Buffer;
    expect(mine.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(mine.equals(samplePng())).toBe(true);
    await bytes(r.ownerA.get(path)).expect(200);
    await r.ownerB.get(path).expect(404);
    await makePerson(t, "ph-stranger").get(path).expect(404);
    await request(t.server).get(path).expect(401);
    // A photo can't be reused on another request, or by someone else.
    await user
      .post(
        "/v1/me/service-requests",
        requestBody(r.at, { mode: "direct", providerIds: [r.a.orgId] }, { photoIds: [photo] }),
      )
      .expect(400);
  });

  it("provider evidence is visible to the requester but never to other providers", async () => {
    const r = await region("ev", 29.5, -27.5);
    const user = makePerson(t, "ev-user");
    const req = (
      await user
        .post(
          "/v1/me/service-requests",
          requestBody(r.at, { mode: "direct", providerIds: [r.a.orgId, r.b.orgId] }),
        )
        .expect(201)
    ).body as ServiceRequestDto;
    const ra = req.recipients.find((x) => x.providerOrganizationId === r.a.orgId)?.id ?? "";
    const rb = req.recipients.find((x) => x.providerOrganizationId === r.b.orgId)?.id ?? "";
    const photo = await upload(r.ownerA, samplePng());
    await r.ownerA
      .post(`/v1/orgs/${r.a.orgId}/inquiries/${ra}/evidence`, {
        note: "Photo of the worn pads",
        photoIds: [photo],
      })
      .expect(200);
    const path = `/v1/service-requests/${req.id}/attachments/${photo}`;
    await bytes(user.get(path)).expect(200);
    await r.ownerB.get(path).expect(404);
    const bView = (await r.ownerB.get(`/v1/orgs/${r.b.orgId}/inquiries/${rb}`).expect(200))
      .body as InquiryDto;
    expect(bView.attachments).toEqual([]);
    expect(bView.events.map((e) => e.type)).not.toContain("evidence_added");
    await r.ownerA.post(`/v1/orgs/${r.a.orgId}/inquiries/${ra}/evidence`, {}).expect(400);
  });
});

describe("no payment handling", () => {
  it("has no payment routes or fields; agreements are informational", async () => {
    const r = await region("np", 30.0, -28.0);
    const user = makePerson(t, "np-user");
    const req = (
      await user
        .post(
          "/v1/me/service-requests",
          requestBody(r.at, { mode: "direct", providerIds: [r.a.orgId] }),
        )
        .expect(201)
    ).body as ServiceRequestDto;
    for (const path of ["pay", "payment", "checkout", "deposit"]) {
      await user.post(`/v1/me/service-requests/${req.id}/${path}`, {}).expect(404);
    }
    await r.ownerA
      .post(`/v1/orgs/${r.a.orgId}/inquiries/${req.recipients[0]?.id ?? ""}/quotes`, {
        ...quote(),
        paymentLink: "https://pay.example",
      })
      .expect(400);
    const text = JSON.stringify(
      (await user.get(`/v1/me/service-requests/${req.id}`).expect(200)).body,
    );
    expect(text).not.toMatch(/checkout|paymentUrl|paymentLink|deposit"|amountDue|paid"/i);
  });
});
