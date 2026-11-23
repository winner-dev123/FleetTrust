import { randomUUID } from "node:crypto";

import { auditEvents, eq, vehicleDocuments, vehicleDocumentShares } from "@fleettrust/db";
import {
  type BranchDto,
  createdInvitationSchema,
  type CreatedDocumentShare,
  type InboxDto,
  type InquiryDto,
  type MaintenanceScheduleDto,
  type MyOrganization,
  SERVICE_RECORD_NOTICE,
  type ServiceHistory,
  type ServiceRecordDto,
  type ServiceRequestDto,
  type VehicleDocumentDto,
  type VehicleDto,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OutboxRelay } from "../src/modules/notifications/index.js";
import { VehicleReminderJob } from "../src/modules/vehicles/index.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../src/platform/storage/index.js";
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
const today = (offsetDays = 0) =>
  new Date(clock.now().getTime() + offsetDays * DAY).toISOString().slice(0, 10);

interface Member extends Person {
  id: string;
}

async function person(uid: string): Promise<Member> {
  const p = makePerson(t, uid);
  const me = (await p.patch("/v1/me", { displayName: uid }).expect(200)).body as { id: string };
  return { ...p, id: me.id };
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

/** A fleet with two branches, a branch-A manager, a branch-A driver and a recruiter. */
async function fleet(prefix: string) {
  const owner = await person(`${prefix}-owner`);
  const org = (await owner.post("/v1/orgs", { kind: "fleet", name: `${prefix} Fleet` }).expect(201))
    .body as MyOrganization;
  const orgId = org.organization.id;
  const branchA = (
    (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "North" }).expect(201))
      .body as BranchDto
  ).id;
  const branchB = (
    (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "South" }).expect(201))
      .body as BranchDto
  ).id;
  const manager = await person(`${prefix}-manager`);
  const driver = await person(`${prefix}-driver`);
  const driverB = await person(`${prefix}-driverb`);
  const recruiter = await person(`${prefix}-recruiter`);
  await join(owner, orgId, manager, "manager", branchA);
  await join(owner, orgId, driver, "driver", branchA);
  await join(owner, orgId, driverB, "driver", branchB);
  await join(owner, orgId, recruiter, "recruiter", null);
  const vehicle = (branchId: string, registration: string) =>
    owner.post(`/v1/orgs/${orgId}/vehicles`, {
      vehicleType: "heavy_truck",
      make: "Scania",
      model: "R500",
      registration,
      branchId,
      odometerKm: 120_000,
    });
  const inA = (await vehicle(branchA, `${prefix}A1`.toUpperCase().slice(0, 15)).expect(201))
    .body as VehicleDto;
  const inB = (await vehicle(branchB, `${prefix}B1`.toUpperCase().slice(0, 15)).expect(201))
    .body as VehicleDto;
  return { owner, orgId, branchA, branchB, manager, driver, driverB, recruiter, inA, inB };
}

const record = (extra: object = {}) => ({
  performedOn: today(),
  category: "service",
  title: "Oil and filters",
  odometerKm: null,
  ...extra,
});

describe("vehicle access boundaries", () => {
  it("personal vehicles belong to their owner only", async () => {
    const owner = await person("p1-owner");
    const stranger = await person("p1-stranger");
    const vehicle = (
      await owner
        .post("/v1/me/vehicles", {
          vehicleType: "light_truck",
          make: "Isuzu",
          registration: "ca 12-34",
          odometerKm: 80_000,
        })
        .expect(201)
    ).body as VehicleDto;
    expect(vehicle).toMatchObject({
      access: "owner",
      registration: "CA 12-34",
      owner: { kind: "user", userId: owner.id },
    });
    expect(
      reason(
        (
          await owner
            .post("/v1/me/vehicles", { vehicleType: "car", registration: "CA 12-34" })
            .expect(409)
        ).body,
      ),
    ).toBe("duplicate_registration");
    const base = `/v1/vehicles/${vehicle.id}`;
    for (const path of [
      base,
      `${base}/service-records`,
      `${base}/schedules`,
      `${base}/documents`,
    ]) {
      await stranger.get(path).expect(404);
    }
    await stranger.patch(base, { nickname: "mine now" }).expect(404);
    await stranger.post(`${base}/odometer`, { odometerKm: 90_000 }).expect(404);
    await stranger.post(`${base}/service-records`, record()).expect(404);
    await request(t.server).get(base).expect(401);
    expect(
      reason((await owner.post(`${base}/odometer`, { odometerKm: 70_000 }).expect(409)).body),
    ).toBe("odometer_decreased");
    expect(
      (
        (await owner.post(`${base}/odometer`, { odometerKm: 81_000 }).expect(200))
          .body as VehicleDto
      ).odometerKm,
    ).toBe(81_000);
    expect(
      ((await owner.get("/v1/me/vehicles").expect(200)).body as VehicleDto[]).map((v) => v.id),
    ).toEqual([vehicle.id]);
  });

  it("fleet managers see their branch; drivers only their assigned vehicle and only some actions", async () => {
    const f = await fleet("f1");
    const outsider = await person("f1-outsider");
    // Branch-scoped manager.
    const list = (await f.manager.get(`/v1/orgs/${f.orgId}/vehicles`).expect(200))
      .body as VehicleDto[];
    expect(list.map((v) => v.id)).toEqual([f.inA.id]);
    await f.manager.get(`/v1/vehicles/${f.inB.id}`).expect(404);
    expect(
      ((await f.manager.get(`/v1/vehicles/${f.inA.id}`).expect(200)).body as VehicleDto).access,
    ).toBe("manager");
    expect(
      reason(
        (
          await f.manager
            .post(`/v1/orgs/${f.orgId}/vehicles`, { vehicleType: "van", branchId: f.branchB })
            .expect(400)
        ).body,
      ),
    ).toBe("invalid_branch");
    // Drivers, recruiters and outsiders.
    await f.driver.get(`/v1/vehicles/${f.inA.id}`).expect(404);
    await f.driver.get(`/v1/orgs/${f.orgId}/vehicles`).expect(403);
    await f.recruiter.get(`/v1/vehicles/${f.inA.id}`).expect(404);
    await outsider.get(`/v1/vehicles/${f.inA.id}`).expect(404);

    // Assignment rules.
    expect(
      reason(
        (
          await f.manager
            .put(`/v1/vehicles/${f.inA.id}/driver`, { userId: outsider.id })
            .expect(400)
        ).body,
      ),
    ).toBe("not_a_member");
    expect(
      reason(
        (
          await f.manager
            .put(`/v1/vehicles/${f.inA.id}/driver`, { userId: f.driverB.id })
            .expect(400)
        ).body,
      ),
    ).toBe("invalid_branch");
    const assigned = (
      await f.manager.put(`/v1/vehicles/${f.inA.id}/driver`, { userId: f.driver.id }).expect(200)
    ).body as VehicleDto;
    expect(assigned.driver).toMatchObject({ userId: f.driver.id, displayName: "f1-driver" });

    // The driver: read, odometer, records and completing maintenance; nothing else.
    const mine = (await f.driver.get("/v1/me/vehicles").expect(200)).body as VehicleDto[];
    expect(mine.map((v) => [v.id, v.access])).toEqual([[f.inA.id, "driver"]]);
    await f.driver.post(`/v1/vehicles/${f.inA.id}/odometer`, { odometerKm: 121_000 }).expect(200);
    const driverRecord = (
      await f.driver
        .post(
          `/v1/vehicles/${f.inA.id}/service-records`,
          record({ title: "Tyre pressure check", category: "tyres" }),
        )
        .expect(201)
    ).body as ServiceRecordDto;
    expect(driverRecord).toMatchObject({ source: "driver", sourceLabel: "Entered by driver" });
    await f.driver.patch(`/v1/vehicles/${f.inA.id}`, { nickname: "My truck" }).expect(403);
    await f.driver
      .post(`/v1/vehicles/${f.inA.id}/schedules`, {
        title: "Service",
        kind: "service",
        intervalKm: 20_000,
      })
      .expect(403);
    await f.driver
      .post(`/v1/vehicles/${f.inA.id}/documents`, {
        kind: "insurance",
        title: "Insurance",
        contentType: "application/pdf",
        size: 100,
      })
      .expect(403);
    await f.driver.put(`/v1/vehicles/${f.inA.id}/driver`, { userId: f.driver.id }).expect(403);
    await f.driver.get(`/v1/vehicles/${f.inB.id}`).expect(404);

    // Unassigned: access ends.
    await f.manager.del(`/v1/vehicles/${f.inA.id}/driver`).expect(200);
    await f.driver.get(`/v1/vehicles/${f.inA.id}`).expect(404);
    expect((await f.driver.get("/v1/me/vehicles").expect(200)).body).toEqual([]);
    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, f.inA.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "vehicle.created",
        "vehicle.driver_assigned",
        "vehicle.driver_unassigned",
        "vehicle.service_record_added",
      ]),
    );
  });
});

describe("service history is never labelled verified", () => {
  it("records carry their source; clients can't set a source or a verified flag", async () => {
    const f = await fleet("s1");
    const owner = await person("s1-personal");
    const personal = (await owner.post("/v1/me/vehicles", { vehicleType: "car" }).expect(201))
      .body as VehicleDto;
    const own = (
      await owner
        .post(
          `/v1/vehicles/${personal.id}/service-records`,
          record({ cost: { amount: "1250.50", currency: "ZAR" }, providerName: "Corner Garage" }),
        )
        .expect(201)
    ).body as ServiceRecordDto;
    expect(own).toMatchObject({
      source: "owner",
      sourceLabel: "Entered by owner",
      cost: { amount: "1250.50", currency: "ZAR" },
      provider: { organizationId: null, name: "Corner Garage" },
    });
    const fleetRecord = (
      await f.manager.post(`/v1/vehicles/${f.inA.id}/service-records`, record()).expect(201)
    ).body as ServiceRecordDto;
    expect(fleetRecord).toMatchObject({ source: "fleet", sourceLabel: "Entered by fleet" });

    for (const forged of [
      { source: "provider" },
      { verified: true },
      { source: "fleet", verifiedBy: "FleetTrust" },
    ]) {
      await owner.post(`/v1/vehicles/${personal.id}/service-records`, record(forged)).expect(400);
    }
    const history = (await owner.get(`/v1/vehicles/${personal.id}/service-records`).expect(200))
      .body as ServiceHistory;
    expect(history.notice).toBe(SERVICE_RECORD_NOTICE);
    const json = JSON.stringify(history);
    expect(json).not.toMatch(/"verified/i);
    expect(history.items.every((r) => !/verified/i.test(r.sourceLabel))).toBe(true);

    // Only the author can delete their record.
    await f.owner.del(`/v1/vehicles/${f.inA.id}/service-records/${fleetRecord.id}`).expect(403);
    await f.manager.del(`/v1/vehicles/${f.inA.id}/service-records/${fleetRecord.id}`).expect(204);
  });

  it("providers add records through an accepted request on a linked vehicle", async () => {
    const owner = await person("s2-owner");
    const providerOwner = await person("s2-provider");
    const stranger = await person("s2-stranger");
    const p = await publishProvider(providerOwner, {
      slug: "s2-garage",
      at: { lng: 27.9, lat: -26.1 },
    });
    const vehicle = (
      await owner
        .post("/v1/me/vehicles", {
          vehicleType: "heavy_truck",
          make: "MAN",
          model: "TGX",
          registration: "S2 TRUCK",
        })
        .expect(201)
    ).body as VehicleDto;
    const body = (vehicleId: string | null) => ({
      clientRequestId: randomUUID(),
      category: "workshop",
      vehicle: { vehicleType: "heavy_truck" },
      location: { lng: 27.9, lat: -26.1 },
      description: "Clutch slipping under load, needs inspection.",
      target: { mode: "direct", providerIds: [p.orgId] },
      vehicleId,
    });
    await stranger.post("/v1/me/service-requests", body(vehicle.id)).expect(404);
    const req = (await owner.post("/v1/me/service-requests", body(vehicle.id)).expect(201))
      .body as ServiceRequestDto;
    expect(req).toMatchObject({
      vehicleId: vehicle.id,
      vehicle: { make: "MAN", model: "TGX", registration: "S2 TRUCK" },
    });
    const inquiry = (
      (await providerOwner.get(`/v1/orgs/${p.orgId}/inquiries`).expect(200)).body as InquiryDto[]
    ).find((i) => i.id === req.id);
    const recipientId = inquiry?.recipientId ?? "";
    const providerRecord = {
      performedOn: today(),
      category: "repair",
      title: "Clutch replaced",
      odometerKm: 410_000,
      cost: { amount: "18500", currency: "ZAR" },
    };
    expect(
      reason(
        (
          await providerOwner
            .post(`/v1/orgs/${p.orgId}/inquiries/${recipientId}/service-record`, providerRecord)
            .expect(409)
        ).body,
      ),
    ).toBe("invalid_transition");
    const quote = (
      await providerOwner
        .post(`/v1/orgs/${p.orgId}/inquiries/${recipientId}/quotes`, {
          price: { type: "from", currency: "ZAR", amount: "18000", unit: "job" },
        })
        .expect(201)
    ).body as InquiryDto;
    await owner
      .post(`/v1/me/service-requests/${req.id}/quotes/${quote.quotes[0]?.id ?? ""}/accept`)
      .expect(200);
    const added = (
      await providerOwner
        .post(`/v1/orgs/${p.orgId}/inquiries/${recipientId}/service-record`, providerRecord)
        .expect(201)
    ).body as ServiceRecordDto;
    expect(added).toMatchObject({
      source: "provider",
      sourceLabel: "Entered by provider · s2 garage",
      provider: { organizationId: p.orgId },
      serviceRequestId: req.id,
    });
    const history = (await owner.get(`/v1/vehicles/${vehicle.id}/service-records`).expect(200))
      .body as ServiceHistory;
    expect(history.items.map((r) => r.id)).toEqual([added.id]);
    expect(
      ((await owner.get(`/v1/vehicles/${vehicle.id}`).expect(200)).body as VehicleDto).odometerKm,
    ).toBeNull(); // provider records don't move the odometer
    await providerOwner.get(`/v1/vehicles/${vehicle.id}`).expect(404); // the provider gets no vehicle access

    // Without a linked vehicle there is nothing to add a record to.
    const plain = (await owner.post("/v1/me/service-requests", body(null)).expect(201))
      .body as ServiceRequestDto;
    const plainRecipient =
      (
        (await providerOwner.get(`/v1/orgs/${p.orgId}/inquiries`).expect(200)).body as InquiryDto[]
      ).find((i) => i.id === plain.id)?.recipientId ?? "";
    const q2 = (
      await providerOwner
        .post(`/v1/orgs/${p.orgId}/inquiries/${plainRecipient}/quotes`, {
          price: { type: "from", currency: "ZAR", amount: "900", unit: "job" },
        })
        .expect(201)
    ).body as InquiryDto;
    await owner
      .post(`/v1/me/service-requests/${plain.id}/quotes/${q2.quotes[0]?.id ?? ""}/accept`)
      .expect(200);
    expect(
      reason(
        (
          await providerOwner
            .post(`/v1/orgs/${p.orgId}/inquiries/${plainRecipient}/service-record`, providerRecord)
            .expect(409)
        ).body,
      ),
    ).toBe("no_vehicle_linked");
  });
});

describe("maintenance schedules and reminders", () => {
  it("distance and time schedules move from ok to due soon to overdue, with one reminder per change", async () => {
    clock.offsetMs = 0;
    const relay = t.app.get(OutboxRelay);
    const job = t.app.get(VehicleReminderJob);
    await job.run();
    await relay.drain();
    const owner = await person("m1-owner");
    const vehicle = (
      await owner
        .post("/v1/me/vehicles", {
          vehicleType: "heavy_truck",
          nickname: "Big Blue",
          odometerKm: 50_000,
        })
        .expect(201)
    ).body as VehicleDto;
    const base = `/v1/vehicles/${vehicle.id}`;
    const schedule = (
      await owner
        .post(`${base}/schedules`, { title: "Major service", kind: "service", intervalKm: 10_000 })
        .expect(201)
    ).body as MaintenanceScheduleDto;
    expect(schedule).toMatchObject({ lastDoneKm: 50_000, nextDueKm: 60_000, status: "ok" });
    await owner.post(`${base}/schedules`, { title: "Nothing", kind: "other" }).expect(400);

    await owner.post(`${base}/odometer`, { odometerKm: 59_200 }).expect(200);
    expect(
      ((await owner.get(`${base}/schedules`).expect(200)).body as MaintenanceScheduleDto[])[0]
        ?.status,
    ).toBe("due_soon");
    expect((await job.run()).maintenance).toBe(1);
    expect((await job.run()).maintenance).toBe(0);
    await relay.drain();
    const inbox = (await owner.get("/v1/me/inbox").expect(200)).body as InboxDto;
    expect(inbox.notifications[0]).toMatchObject({
      kind: "maintenance_due",
      title: "Maintenance due soon",
      body: "Major service for Big Blue is due soon.",
      data: { vehicleId: vehicle.id },
    });

    await owner.post(`${base}/odometer`, { odometerKm: 60_100 }).expect(200);
    expect(((await owner.get(base).expect(200)).body as VehicleDto).maintenance).toEqual({
      dueSoon: 0,
      overdue: 1,
    });
    expect((await job.run()).maintenance).toBe(1);
    expect((await job.run()).maintenance).toBe(0);
    clock.offsetMs = 8 * DAY;
    expect((await job.run()).maintenance).toBe(1); // weekly while overdue
    await relay.drain();
    expect(
      ((await owner.get("/v1/me/inbox").expect(200)).body as InboxDto).notifications[0],
    ).toMatchObject({ title: "Maintenance overdue" });

    // A service record against the schedule resets it.
    await owner
      .post(
        `${base}/service-records`,
        record({ scheduleId: schedule.id, odometerKm: 60_200, performedOn: today() }),
      )
      .expect(201);
    expect(
      ((await owner.get(`${base}/schedules`).expect(200)).body as MaintenanceScheduleDto[])[0],
    ).toMatchObject({ lastDoneKm: 60_200, nextDueKm: 70_200, status: "ok" });

    // Time-based.
    const yearly = (
      await owner
        .post(`${base}/schedules`, {
          title: "Roadworthy test",
          kind: "inspection",
          intervalDays: 30,
          lastDoneOn: today(-25),
        })
        .expect(201)
    ).body as MaintenanceScheduleDto;
    expect(yearly).toMatchObject({ nextDueOn: today(5), status: "due_soon" });
    const done = (
      await owner.post(`${base}/schedules/${yearly.id}/complete`, { doneOn: today() }).expect(200)
    ).body as MaintenanceScheduleDto;
    expect(done).toMatchObject({ nextDueOn: today(30), status: "ok" });
    clock.offsetMs = 0;
  });
});

describe("document vault and controlled sharing", () => {
  const pdf = Buffer.from("%PDF-1.4\n% Vehicle licence disc FLEETSECRET-123\n%%EOF\n");

  async function upload(p: Person, vehicleId: string, extra: object = {}) {
    const created = (
      await p
        .post(`/v1/vehicles/${vehicleId}/documents`, {
          kind: "registration",
          title: "Licence disc",
          contentType: "application/pdf",
          size: pdf.length,
          ...extra,
        })
        .expect(201)
    ).body as {
      document: VehicleDocumentDto;
      upload: { url: string; headers: Record<string, string> };
    };
    await request(t.server)
      .put(new URL(created.upload.url).pathname)
      .set(created.upload.headers)
      .send(pdf)
      .expect(200);
    return (
      await p
        .post(`/v1/vehicles/${vehicleId}/documents/${created.document.id}/complete`)
        .expect(200)
    ).body as VehicleDocumentDto;
  }

  it("stores documents encrypted, limits drivers to shared ones, and audits every download", async () => {
    const f = await fleet("d1");
    await f.manager.put(`/v1/vehicles/${f.inA.id}/driver`, { userId: f.driver.id }).expect(200);
    const doc = await upload(f.manager, f.inA.id);
    expect(doc).toMatchObject({
      status: "available",
      driverVisible: false,
      contentType: "application/pdf",
    });
    const [row] = await t.db.db
      .select()
      .from(vehicleDocuments)
      .where(eq(vehicleDocuments.id, doc.id));
    const stored = await t.app
      .get<ObjectStorage>(OBJECT_STORAGE)
      .read("sensitive", row?.storageKey ?? "");
    expect(stored.toString("latin1")).not.toContain("FLEETSECRET");
    const file = await f.manager
      .get(`/v1/vehicles/${f.inA.id}/documents/${doc.id}/file`)
      .buffer(true)
      .expect(200);
    expect(Buffer.from(file.body as Buffer).equals(pdf)).toBe(true);
    expect(file.headers["cache-control"]).toBe("private, no-store");

    expect((await f.driver.get(`/v1/vehicles/${f.inA.id}/documents`).expect(200)).body).toEqual([]);
    await f.driver.get(`/v1/vehicles/${f.inA.id}/documents/${doc.id}/file`).expect(404);
    await f.manager
      .patch(`/v1/vehicles/${f.inA.id}/documents/${doc.id}`, { driverVisible: true })
      .expect(200);
    await f.driver.get(`/v1/vehicles/${f.inA.id}/documents/${doc.id}/file`).expect(200);
    await f.manager.get(`/v1/vehicles/${f.inB.id}/documents`).expect(404);
    await f.recruiter.get(`/v1/vehicles/${f.inA.id}/documents/${doc.id}/file`).expect(404);

    // From a document: a record with that source.
    const fromDoc = (
      await f.manager
        .post(
          `/v1/vehicles/${f.inA.id}/service-records`,
          record({ fromDocumentId: doc.id, title: "Licence renewed" }),
        )
        .expect(201)
    ).body as ServiceRecordDto;
    expect(fromDoc).toMatchObject({
      source: "document",
      sourceLabel: "From document",
      documentId: doc.id,
    });

    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, f.inA.id));
    expect(audit.filter((a) => a.action === "vehicle.document_downloaded")).toHaveLength(2);
  });

  it("share links expire, have a view limit, can be revoked, and only a hash is stored", async () => {
    clock.offsetMs = 0;
    const owner = await person("d2-owner");
    const vehicle = (await owner.post("/v1/me/vehicles", { vehicleType: "car" }).expect(201))
      .body as VehicleDto;
    const doc = await upload(owner, vehicle.id, {
      kind: "insurance",
      title: "Insurance certificate",
    });
    const share = (
      await owner
        .post(`/v1/vehicles/${vehicle.id}/documents/${doc.id}/shares`, {
          label: "Insurance broker",
          maxViews: 2,
          expiresInHours: 24,
        })
        .expect(201)
    ).body as CreatedDocumentShare;
    const [stored] = await t.db.db
      .select()
      .from(vehicleDocumentShares)
      .where(eq(vehicleDocumentShares.id, share.id));
    expect(stored?.tokenHash).not.toBe(share.token);
    expect(JSON.stringify(stored)).not.toContain(share.token);

    const open = () => request(t.server).get(share.path).buffer(true);
    expect(Buffer.from((await open().expect(200)).body as Buffer).equals(pdf)).toBe(true);
    await open().expect(200);
    await open().expect(404); // view limit
    await request(t.server).get("/v1/shared-documents/not-a-real-token").expect(404);

    const second = (
      await owner
        .post(`/v1/vehicles/${vehicle.id}/documents/${doc.id}/shares`, {
          label: "Buyer",
          expiresInHours: 1,
        })
        .expect(201)
    ).body as CreatedDocumentShare;
    clock.offsetMs = 2 * 60 * 60 * 1000;
    await request(t.server).get(second.path).expect(404); // expired
    clock.offsetMs = 0;
    const third = (
      await owner
        .post(`/v1/vehicles/${vehicle.id}/documents/${doc.id}/shares`, { label: "Mechanic" })
        .expect(201)
    ).body as CreatedDocumentShare;
    await owner
      .del(`/v1/vehicles/${vehicle.id}/documents/${doc.id}/shares/${third.id}`)
      .expect(204);
    await request(t.server).get(third.path).expect(404); // revoked
    const shares = (
      await owner.get(`/v1/vehicles/${vehicle.id}/documents/${doc.id}/shares`).expect(200)
    ).body as { label: string; views: number; revoked: boolean }[];
    expect(shares.map((s) => [s.label, s.views, s.revoked])).toEqual([
      ["Mechanic", 0, true],
      ["Buyer", 0, false],
      ["Insurance broker", 2, false],
    ]);
    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, vehicle.id));
    expect(audit.filter((a) => a.action === "vehicle.document_share_opened")).toHaveLength(2);
  });

  it("reminds before documents expire", async () => {
    clock.offsetMs = 0;
    const relay = t.app.get(OutboxRelay);
    const job = t.app.get(VehicleReminderJob);
    await job.run();
    await relay.drain();
    const owner = await person("d3-owner");
    const vehicle = (
      await owner
        .post("/v1/me/vehicles", { vehicleType: "van", registration: "D3 VAN" })
        .expect(201)
    ).body as VehicleDto;
    const doc = await upload(owner, vehicle.id, {
      kind: "insurance",
      title: "Insurance",
      expiresOn: today(10),
    });
    expect(doc.expiring).toBe(true);
    expect((await job.run()).documents).toBe(1);
    expect((await job.run()).documents).toBe(0);
    await relay.drain();
    expect(
      ((await owner.get("/v1/me/inbox").expect(200)).body as InboxDto).notifications[0],
    ).toMatchObject({
      kind: "document_expiring",
      body: `Insurance for D3 VAN expires on ${today(10)}.`,
    });
  });
});
