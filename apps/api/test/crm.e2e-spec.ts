import { randomUUID } from "node:crypto";

import {
  type AppointmentDto,
  type BranchDto,
  createdInvitationSchema,
  type CrmInquiryDto,
  type CrmQuoteDto,
  type CrmTaskDto,
  type CustomerAppointmentDto,
  type InboxDto,
  type InquiryDto,
  type PipelineDto,
  type ProviderAnalyticsDto,
  RESPONSE_STATUS_NOTE,
  type ResponseStatusDto,
  type ServiceRequestDto,
  type SlotsDto,
  type StaffMemberDto,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { OutboxRelay } from "../src/modules/notifications/index.js";
import { makePerson, type Person, publishProvider } from "./support/providers.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;
/**
 * Appointment tests pin "now" to a fixed instant so local dates (including the New York
 * spring-forward change on 14 March 2027) stay deterministic. Response-time tests use real time,
 * because inquiry timestamps come from the database clock.
 */
const clock = {
  pinned: null as number | null,
  offsetMs: 0,
  now: () => new Date(clock.pinned ?? Date.now() + clock.offsetMs),
};
const PINNED_NOW = Date.parse("2027-03-01T12:00:00Z"); // a Monday
const HOUR = 3_600_000;

beforeAll(async () => {
  t = await createTestApp({ clock });
});

afterAll(async () => {
  await t.close();
});

afterEach(() => {
  clock.pinned = null;
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

const weekdays = (opens: string, closes: string) =>
  Object.fromEntries(["mon", "tue", "wed", "thu", "fri"].map((d) => [d, [{ opens, closes }]]));

/**
 * A published provider: branch Main (Johannesburg, Mon–Fri 08:00–17:00) and North, an
 * organization-wide manager, staff A (Main), staff B (North) and a North-only manager.
 */
async function team(prefix: string) {
  const owner = await person(`${prefix}-owner`);
  const p = await publishProvider(owner, {
    slug: `${prefix}-garage`,
    at: { lng: 28.0, lat: -26.2 },
  });
  const main = p.branchId;
  const north = (
    (await owner.post(`/v1/orgs/${p.orgId}/branches`, { name: "North" }).expect(201))
      .body as BranchDto
  ).id;
  await owner
    .put(`${p.base}/branches/${main}/hours`, {
      timeZone: "Africa/Johannesburg",
      weekly: weekdays("08:00", "17:00"),
    })
    .expect(200);
  const manager = await person(`${prefix}-manager`);
  const staffA = await person(`${prefix}-staffa`);
  const staffB = await person(`${prefix}-staffb`);
  const northManager = await person(`${prefix}-northmgr`);
  await join(owner, p.orgId, manager, "manager", null);
  await join(owner, p.orgId, staffA, "staff", main);
  await join(owner, p.orgId, staffB, "staff", north);
  await join(owner, p.orgId, northManager, "manager", north);
  const crm = `/v1/orgs/${p.orgId}/crm`;
  return {
    owner,
    orgId: p.orgId,
    base: p.base,
    main,
    north,
    manager,
    staffA,
    staffB,
    northManager,
    crm,
  };
}

/** A customer's request to the provider; returns the request and the provider's recipient ID. */
async function inquiry(customer: Person, owner: Person, orgId: string, urgency = "routine") {
  const req = (
    await customer
      .post("/v1/me/service-requests", {
        clientRequestId: randomUUID(),
        category: "workshop",
        vehicle: { vehicleType: "heavy_truck" },
        location: { lng: 28.0, lat: -26.2 },
        description: "Brakes squealing badly on the trailer axle.",
        urgency,
        target: { mode: "direct", providerIds: [orgId] },
      })
      .expect(201)
  ).body as ServiceRequestDto;
  const found = (
    (await owner.get(`/v1/orgs/${orgId}/inquiries`).expect(200)).body as InquiryDto[]
  ).find((i) => i.id === req.id);
  return { req, recipientId: found?.recipientId ?? "" };
}

async function quoteAndAccept(
  customer: Person,
  owner: Person,
  orgId: string,
  req: ServiceRequestDto,
  recipientId: string,
) {
  const quoted = (
    await owner
      .post(`/v1/orgs/${orgId}/inquiries/${recipientId}/quotes`, {
        price: { type: "fixed", currency: "ZAR", amount: "2500", unit: "job" },
      })
      .expect(201)
  ).body as InquiryDto;
  await customer
    .post(`/v1/me/service-requests/${req.id}/quotes/${quoted.quotes[0]?.id ?? ""}/accept`)
    .expect(200);
}

const booking = (
  staffUserId: string,
  branchId: string,
  date: string,
  time: string,
  extra = {},
) => ({
  branchId,
  staffUserId,
  start: { date, time },
  durationMinutes: 60,
  title: "Brake service",
  ...extra,
});

describe("CRM staff permissions", () => {
  it("staff work on their branch's inquiries; managers assign, book and see analytics", async () => {
    const f = await team("c1");
    const customer = await person("c1-customer");
    const outsider = await person("c1-outsider");
    const { req, recipientId } = await inquiry(customer, f.owner, f.orgId, "urgent");

    // Branch scope: staff A (Main) sees it; staff B and the North manager (North) don't.
    const pipeline = (await f.staffA.get(`${f.crm}/pipeline`).expect(200)).body as PipelineDto;
    expect(pipeline.items.map((i) => i.recipientId)).toEqual([recipientId]);
    expect(pipeline.items[0]).toMatchObject({
      stage: "new",
      urgency: "urgent",
      assignee: null,
      priority: "normal",
      response: { state: "awaiting", overdue: false },
    });
    expect(pipeline.stages.new).toBe(1);
    expect(
      ((await f.staffB.get(`${f.crm}/pipeline`).expect(200)).body as PipelineDto).items,
    ).toEqual([]);
    await f.staffB.get(`${f.crm}/inquiries/${recipientId}`).expect(404);
    await f.northManager.get(`${f.crm}/inquiries/${recipientId}`).expect(404);
    await outsider.get(`${f.crm}/pipeline`).expect(404);
    await request(t.server).get(`${f.crm}/pipeline`).expect(401);
    await customer.get(`${f.crm}/pipeline`).expect(404);

    // Staff claim an unassigned inquiry, but can't hand work to others.
    const inquiryPath = `${f.crm}/inquiries/${recipientId}`;
    expect(
      reason(
        (await f.staffA.patch(inquiryPath, { assigneeUserId: f.manager.id }).expect(403)).body,
      ),
    ).toBe("not_allowed");
    await f.staffA.patch(inquiryPath, { priority: "high" }).expect(403); // not theirs yet
    const claimed = (await f.staffA.patch(inquiryPath, { assigneeUserId: f.staffA.id }).expect(200))
      .body as CrmInquiryDto;
    expect(claimed.item.assignee).toEqual({ userId: f.staffA.id, displayName: "c1-staffa" });
    await f.staffA.patch(inquiryPath, { priority: "high" }).expect(200);
    // Managers assign anyone who works at the inquiry's branch (staff B is North-only).
    expect(
      reason(
        (await f.manager.patch(inquiryPath, { assigneeUserId: f.staffB.id }).expect(400)).body,
      ),
    ).toBe("invalid_assignee");
    await f.manager.patch(inquiryPath, { assigneeUserId: f.manager.id }).expect(200);
    await f.staffA.patch(inquiryPath, { assigneeUserId: f.staffA.id }).expect(403); // no taking it back
    await f.manager.patch(inquiryPath, { assigneeUserId: f.staffA.id }).expect(200);
    const mine = (await f.staffA.get(`${f.crm}/pipeline?assignee=me&priority=high`).expect(200))
      .body as PipelineDto;
    expect(mine.items.map((i) => i.recipientId)).toEqual([recipientId]);

    // Management actions are refused to staff.
    for (const [path, body] of [
      [`${f.crm}/appointments`, booking(f.staffA.id, f.main, "2030-01-07", "09:00")],
      [
        `${f.crm}/staff/${f.staffA.id}/time-off`,
        { startsAt: "2030-01-01T00:00:00Z", endsAt: "2030-01-02T00:00:00Z" },
      ],
    ] as const) {
      await f.staffA.post(path, body).expect(403);
    }
    await f.staffA
      .put(`${f.crm}/staff/${f.staffA.id}/availability`, { branchId: f.main, weekly: {} })
      .expect(403);
    await f.staffA.get(`${f.crm}/analytics`).expect(403);
    await f.staffA
      .get(`${f.crm}/slots?branchId=${f.main}&date=2030-01-07&durationMinutes=60`)
      .expect(200);

    // Notes are internal; only the author deletes one.
    const noted = (
      await f.staffA
        .post(`${inquiryPath}/notes`, { body: "Customer prefers mornings." })
        .expect(201)
    ).body as CrmInquiryDto;
    const noteId = noted.notes[0]?.id ?? "";
    expect(reason((await f.manager.del(`${inquiryPath}/notes/${noteId}`).expect(403)).body)).toBe(
      "not_author",
    );
    const customerView = await customer.get(`/v1/me/service-requests/${req.id}`).expect(200);
    expect(JSON.stringify(customerView.body)).not.toContain("prefers mornings");
    await f.staffA.del(`${inquiryPath}/notes/${noteId}`).expect(204);

    // Tasks: staff keep their own; managers see and assign within their scope.
    const task = (
      await f.staffA
        .post(`${f.crm}/tasks`, { title: "Call back about parts", recipientId })
        .expect(201)
    ).body as CrmTaskDto;
    expect(task).toMatchObject({
      assignee: { userId: f.staffA.id },
      branchId: f.main,
      status: "open",
    });
    expect(
      reason(
        (
          await f.staffA
            .post(`${f.crm}/tasks`, { title: "Your job", assigneeUserId: f.manager.id })
            .expect(403)
        ).body,
      ),
    ).toBe("not_allowed");
    expect((await f.staffB.get(`${f.crm}/tasks`).expect(200)).body as CrmTaskDto[]).toEqual([]);
    await f.staffB.patch(`${f.crm}/tasks/${task.id}`, { done: true }).expect(404);
    expect(
      (
        (await f.manager.get(`${f.crm}/tasks?assignee=${f.staffA.id}`).expect(200))
          .body as CrmTaskDto[]
      ).map((x) => x.id),
    ).toEqual([task.id]);
    expect((await f.northManager.get(`${f.crm}/tasks`).expect(200)).body as CrmTaskDto[]).toEqual(
      [],
    );
    const done = (await f.staffA.patch(`${f.crm}/tasks/${task.id}`, { done: true }).expect(200))
      .body as CrmTaskDto;
    expect(done.status).toBe("done");
    expect(done.completedAt).not.toBeNull();

    // Analytics: branch-scoped managers only see their branch.
    expect(
      reason((await f.northManager.get(`${f.crm}/analytics?branchId=${f.main}`).expect(400)).body),
    ).toBe("invalid_branch");
    const northStats = (await f.northManager.get(`${f.crm}/analytics`).expect(200))
      .body as ProviderAnalyticsDto;
    expect(northStats).toMatchObject({ branchId: f.north, inquiries: { received: 0 } });
    const allStats = (await f.manager.get(`${f.crm}/analytics`).expect(200))
      .body as ProviderAnalyticsDto;
    expect(allStats.inquiries.received).toBe(1);
  });

  it("response deadlines follow urgency; the quote list flags expiring quotes", async () => {
    const f = await team("c2");
    const customer = await person("c2-customer");
    const { recipientId } = await inquiry(customer, f.owner, f.orgId, "urgent");
    clock.offsetMs = 3 * HOUR; // urgent requests should get a reply within 2 hours
    const late = ((await f.manager.get(`${f.crm}/pipeline`).expect(200)).body as PipelineDto)
      .items[0];
    expect(late?.response).toMatchObject({ state: "awaiting", overdue: true });
    clock.offsetMs = 0;
    await f.owner
      .post(`/v1/orgs/${f.orgId}/inquiries/${recipientId}/quotes`, {
        price: { type: "fixed", currency: "ZAR", amount: "900", unit: "job" },
        validDays: 2,
      })
      .expect(201);
    const after = ((await f.manager.get(`${f.crm}/pipeline`).expect(200)).body as PipelineDto)
      .items[0];
    expect(after).toMatchObject({
      stage: "quoted",
      response: { state: "responded", overdue: false },
      latestQuote: { status: "active", priceLabel: expect.stringContaining("900") as string },
    });
    const expiring = (await f.staffA.get(`${f.crm}/quotes?expiringWithinDays=3`).expect(200))
      .body as CrmQuoteDto[];
    expect(expiring).toHaveLength(1);
    expect(expiring[0]).toMatchObject({ recipientId, status: "active", expiringSoon: true });
    expect((await f.staffB.get(`${f.crm}/quotes`).expect(200)).body as CrmQuoteDto[]).toEqual([]);
    clock.offsetMs = 3 * 24 * HOUR;
    const expired = (await f.manager.get(`${f.crm}/quotes?status=expired`).expect(200))
      .body as CrmQuoteDto[];
    expect(expired.map((q) => q.recipientId)).toEqual([recipientId]);
  });
});

describe("appointments: atomic booking", () => {
  it("never double-books a staff member, even when bookings race", async () => {
    clock.pinned = PINNED_NOW;
    const f = await team("b1");
    const path = `${f.crm}/appointments`;
    // Johannesburg is UTC+2 all year.
    const first = (
      await f.manager.post(path, booking(f.staffA.id, f.main, "2027-03-08", "09:00")).expect(201)
    ).body as AppointmentDto;
    expect(first).toMatchObject({
      startsAt: "2027-03-08T07:00:00.000Z",
      endsAt: "2027-03-08T08:00:00.000Z",
      timeZone: "Africa/Johannesburg",
      local: { date: "2027-03-08", start: "09:00", end: "10:00" },
      status: "booked",
      staff: { userId: f.staffA.id },
    });
    expect(
      reason(
        (
          await f.manager
            .post(path, booking(f.staffA.id, f.main, "2027-03-08", "09:30"))
            .expect(409)
        ).body,
      ),
    ).toBe("slot_unavailable");
    await f.manager.post(path, booking(f.staffA.id, f.main, "2027-03-08", "10:00")).expect(201); // back-to-back
    await f.manager.post(path, booking(f.manager.id, f.main, "2027-03-08", "09:00")).expect(201); // another person

    // Five managers' clicks at once for the same time: exactly one wins.
    const race = await Promise.all(
      Array.from({ length: 5 }, () =>
        f.manager.post(path, booking(f.staffA.id, f.main, "2027-03-09", "11:00")),
      ),
    );
    expect(race.filter((r) => r.status === 201)).toHaveLength(1);
    expect(race.filter((r) => r.status === 409).map((r) => reason(r.body))).toEqual(
      Array.from({ length: 4 }, () => "slot_unavailable"),
    );
    const day = (
      await f.manager
        .get(`${path}?from=2027-03-09&to=2027-03-09&staffUserId=${f.staffA.id}`)
        .expect(200)
    ).body as AppointmentDto[];
    expect(day).toHaveLength(1);

    // Hours, dates and staff rules.
    const refuse = async (body: object, status: number, why: string) => {
      expect(reason((await f.manager.post(path, body).expect(status)).body)).toBe(why);
    };
    await refuse(booking(f.staffA.id, f.main, "2027-03-08", "17:00"), 409, "outside_availability");
    await refuse(booking(f.staffA.id, f.main, "2027-03-13", "10:00"), 409, "outside_availability"); // Saturday
    await refuse(booking(f.staffA.id, f.main, "2027-02-26", "10:00"), 409, "in_the_past");
    await refuse(booking(f.staffA.id, f.main, "2028-06-01", "10:00"), 409, "too_far_ahead");
    await refuse(booking(f.staffB.id, f.main, "2027-03-08", "12:00"), 400, "invalid_assignee");
    await refuse(booking(f.staffA.id, f.north, "2027-03-08", "12:00"), 400, "invalid_assignee");
    await f.northManager
      .post(path, booking(f.staffA.id, f.main, "2027-03-08", "12:00"))
      .expect(400);
    await f.manager
      .post(path, { ...booking(f.staffA.id, f.main, "2027-03-08", "12:00"), durationMinutes: 50 })
      .expect(400);

    // Slots leave out booked time.
    const slots = (
      await f.staffA
        .get(
          `${f.crm}/slots?branchId=${f.main}&date=2027-03-08&durationMinutes=60&staffUserId=${f.staffA.id}`,
        )
        .expect(200)
    ).body as SlotsDto;
    const starts = slots.slots.map((s) => s.start);
    expect(starts).toContain("08:00");
    expect(starts).toContain("11:00");
    expect(starts).toContain("16:00");
    expect(starts).not.toContain("08:15");
    expect(starts).not.toContain("09:00");
    expect(starts).not.toContain("10:45");
    expect(starts).not.toContain("16:15");

    // Staff hours and time off narrow the bookable time.
    const staff = (
      await f.manager
        .put(`${f.crm}/staff/${f.staffA.id}/availability`, {
          branchId: f.main,
          weekly: {
            mon: [{ opens: "12:00", closes: "17:00" }],
            tue: [{ opens: "08:00", closes: "17:00" }],
          },
        })
        .expect(200)
    ).body as StaffMemberDto[];
    expect(staff.find((s) => s.userId === f.staffA.id)?.availability).toEqual([
      {
        branchId: f.main,
        weekly: {
          mon: [{ opens: "12:00", closes: "17:00" }],
          tue: [{ opens: "08:00", closes: "17:00" }],
        },
      },
    ]);
    await refuse(booking(f.staffA.id, f.main, "2027-03-15", "09:00"), 409, "outside_availability");
    const afternoon = (
      await f.manager.post(path, booking(f.staffA.id, f.main, "2027-03-15", "13:00")).expect(201)
    ).body as AppointmentDto;
    await f.manager
      .post(`${f.crm}/staff/${f.staffA.id}/time-off`, {
        startsAt: "2027-03-15T12:00:00Z", // 14:00 local
        endsAt: "2027-03-15T13:00:00Z",
        reason: "Dentist",
      })
      .expect(201);
    await refuse(booking(f.staffA.id, f.main, "2027-03-15", "14:00"), 409, "outside_availability");
    expect(
      reason(
        (
          await f.manager
            .post(`${f.crm}/staff/${f.staffA.id}/time-off`, {
              startsAt: "2027-03-15T11:00:00Z",
              endsAt: "2027-03-15T11:30:00Z",
            })
            .expect(409)
        ).body,
      ),
    ).toBe("conflicts_with_appointments");
    // Colleagues see the time off, but not the reason.
    const seenByB = (await f.staffB.get(`${f.crm}/staff`).expect(200)).body as StaffMemberDto[];
    expect(seenByB.find((s) => s.userId === f.staffA.id)).toBeUndefined(); // other branch
    const seenByA = (await f.staffA.get(`${f.crm}/staff`).expect(200)).body as StaffMemberDto[];
    expect(seenByA.find((s) => s.userId === f.staffA.id)?.timeOff[0]?.reason).toBe("Dentist");

    // Rescheduling and reassigning go through the same checks.
    expect(
      reason(
        (
          await f.manager
            .patch(`${path}/${afternoon.id}`, { start: { date: "2027-03-15", time: "14:00" } })
            .expect(409)
        ).body,
      ),
    ).toBe("outside_availability");
    const moved = (
      await f.manager
        .patch(`${path}/${afternoon.id}`, { start: { date: "2027-03-15", time: "15:00" } })
        .expect(200)
    ).body as AppointmentDto;
    expect(moved.local).toEqual({ date: "2027-03-15", start: "15:00", end: "16:00" });
    expect(
      reason(
        (await f.manager.patch(`${path}/${afternoon.id}`, { staffUserId: f.staffB.id }).expect(400))
          .body,
      ),
    ).toBe("invalid_assignee");

    // Status changes: staff complete their own after the start; only managers cancel.
    const statusPath = `${path}/${first.id}/status`;
    expect(
      reason((await f.staffA.post(statusPath, { status: "completed" }).expect(409)).body),
    ).toBe("not_started");
    expect(
      reason(
        (await f.staffA.post(statusPath, { status: "cancelled", reason: "Sick" }).expect(403)).body,
      ),
    ).toBe("not_allowed");
    clock.pinned = Date.parse("2027-03-08T07:30:00Z");
    const completed = (await f.staffA.post(statusPath, { status: "completed" }).expect(200))
      .body as AppointmentDto;
    expect(completed.status).toBe("completed");
    await f.staffA.post(statusPath, { status: "no_show" }).expect(409);
    clock.pinned = PINNED_NOW;
    const raced = day[0]?.id ?? "";
    await f.manager
      .post(`${path}/${raced}/status`, { status: "cancelled", reason: "Customer called" })
      .expect(200);
    // A cancelled appointment frees the time.
    await f.manager.post(path, booking(f.staffA.id, f.main, "2027-03-09", "11:00")).expect(201);
  });

  it("links bookings to accepted inquiries; the customer sees them without staff details", async () => {
    clock.pinned = PINNED_NOW;
    const f = await team("b2");
    const customer = await person("b2-customer");
    const { req, recipientId } = await inquiry(customer, f.owner, f.orgId);
    const path = `${f.crm}/appointments`;
    const linked = booking(f.staffA.id, f.main, "2027-03-10", "10:00", {
      recipientId,
      notes: "Bring the torque wrench",
    });
    expect(reason((await f.manager.post(path, linked).expect(409)).body)).toBe(
      "inquiry_not_bookable",
    );
    await quoteAndAccept(customer, f.owner, f.orgId, req, recipientId);
    const appointment = (await f.manager.post(path, linked).expect(201)).body as AppointmentDto;
    expect(appointment).toMatchObject({ recipientId, requestId: req.id });

    const mine = (await customer.get("/v1/me/appointments").expect(200))
      .body as CustomerAppointmentDto[];
    expect(mine).toEqual([
      {
        id: appointment.id,
        requestId: req.id,
        providerOrganizationId: f.orgId,
        providerName: "b2-garage org",
        branchName: "Main",
        title: "Brake service",
        status: "booked",
        startsAt: "2027-03-10T08:00:00.000Z",
        endsAt: "2027-03-10T09:00:00.000Z",
        timeZone: "Africa/Johannesburg",
        local: { date: "2027-03-10", start: "10:00", end: "11:00" },
      },
    ]);
    expect(JSON.stringify(mine)).not.toContain("torque wrench");
    expect((await f.staffA.get("/v1/me/appointments").expect(200)).body as unknown[]).toEqual([]);
    const pipeline = ((await f.manager.get(`${f.crm}/pipeline`).expect(200)).body as PipelineDto)
      .items[0];
    expect(pipeline).toMatchObject({ stage: "won", nextAppointmentAt: "2027-03-10T08:00:00.000Z" });

    // Notifications: the customer hears about the booking and the move; staff A about the new work.
    const relay = t.app.get(OutboxRelay);
    await relay.drain();
    await f.manager
      .patch(`${path}/${appointment.id}`, { start: { date: "2027-03-10", time: "14:00" } })
      .expect(200);
    await relay.drain();
    const inbox = (await customer.get("/v1/me/inbox").expect(200)).body as InboxDto;
    const kinds = inbox.notifications.map((n) => [n.kind, n.body]);
    expect(kinds).toContainEqual([
      "appointment_booked",
      "b2-garage org booked Brake service on 2027-03-10 at 10:00 (Main).",
    ]);
    expect(kinds).toContainEqual([
      "appointment_changed",
      "b2-garage org moved Brake service to 2027-03-10 at 14:00.",
    ]);
    const staffInbox = (await f.staffA.get("/v1/me/inbox").expect(200)).body as InboxDto;
    expect(staffInbox.notifications.map((n) => n.kind)).toContain("appointment_assigned");
  });
});

describe("appointments: timezones", () => {
  it("books in the branch's local time across a daylight-saving change", async () => {
    clock.pinned = PINNED_NOW;
    const f = await team("tz1");
    const east = (
      (await f.owner.post(`/v1/orgs/${f.orgId}/branches`, { name: "Eastside" }).expect(201))
        .body as BranchDto
    ).id;
    await f.owner
      .put(`${f.base}/branches/${east}/hours`, {
        timeZone: "America/New_York",
        weekly: { sun: [{ opens: "01:00", closes: "04:00" }], ...weekdays("09:00", "17:00") },
      })
      .expect(200);
    // 14 March 2027: New York clocks jump from 02:00 to 03:00.
    const slots = (
      await f.manager
        .get(
          `${f.crm}/slots?branchId=${east}&date=2027-03-14&durationMinutes=60&staffUserId=${f.manager.id}`,
        )
        .expect(200)
    ).body as SlotsDto;
    expect(slots.timeZone).toBe("America/New_York");
    expect(slots.slots.map((s) => s.start)).toEqual(["01:00", "01:15", "01:30", "01:45", "03:00"]);
    expect(slots.slots.find((s) => s.start === "01:45")).toMatchObject({
      startsAt: "2027-03-14T06:45:00.000Z", // EST, UTC−5
      endsAt: "2027-03-14T07:45:00.000Z", // 03:45 EDT
    });
    expect(slots.slots.find((s) => s.start === "03:00")?.startsAt).toBe("2027-03-14T07:00:00.000Z");
    const path = `${f.crm}/appointments`;
    expect(
      reason(
        (await f.manager.post(path, booking(f.manager.id, east, "2027-03-14", "02:30")).expect(400))
          .body,
      ),
    ).toBe("invalid_local_time");

    // The same local time is a different UTC instant either side of the change.
    const before = (
      await f.manager.post(path, booking(f.manager.id, east, "2027-03-08", "09:00")).expect(201)
    ).body as AppointmentDto;
    const after = (
      await f.manager.post(path, booking(f.manager.id, east, "2027-03-15", "09:00")).expect(201)
    ).body as AppointmentDto;
    expect(before.startsAt).toBe("2027-03-08T14:00:00.000Z");
    expect(after.startsAt).toBe("2027-03-15T13:00:00.000Z");
    expect(after.local).toEqual({ date: "2027-03-15", start: "09:00", end: "10:00" });
    // A Johannesburg appointment at the same instant shows its own local time.
    const jhb = (
      await f.manager.post(path, booking(f.staffA.id, f.main, "2027-03-15", "15:30")).expect(201)
    ).body as AppointmentDto;
    expect(jhb.startsAt).toBe("2027-03-15T13:30:00.000Z");
    expect(jhb.local.start).toBe("15:30");

    const onThe15th = (await f.manager.get(`${path}?from=2027-03-15&to=2027-03-15`).expect(200))
      .body as AppointmentDto[];
    expect(onThe15th.map((a) => [a.id, a.timeZone, a.local.start])).toEqual([
      [after.id, "America/New_York", "09:00"],
      [jhb.id, "Africa/Johannesburg", "15:30"],
    ]);
    expect(
      reason((await f.manager.get(`${path}?from=2027-03-15&to=2027-01-01`).expect(400)).body),
    ).toBe("invalid_range");
  });
});

describe("analytics and response status", () => {
  it("measures replies from the request history and shows a public response status", async () => {
    const f = await team("an1");
    const slugPath = "/v1/providers/an1-garage/response-status";
    const early = (await request(t.server).get(slugPath).expect(200)).body as ResponseStatusDto;
    expect(early).toEqual({
      level: "not_enough_data",
      label: "Not enough inquiries yet to show a response time",
      responseRate: null,
      basedOnInquiries: 0,
      windowDays: 90,
      note: RESPONSE_STATUS_NOTE,
    });
    await request(t.server).get("/v1/providers/no-such-garage/response-status").expect(404);

    const inquiries = [];
    for (let i = 0; i < 5; i++) {
      inquiries.push(await inquiry(await person(`an1-customer${String(i)}`), f.owner, f.orgId));
    }
    // Four replies (three quotes, one decline); one left unanswered.
    for (const { recipientId } of inquiries.slice(0, 3)) {
      await f.owner
        .post(`/v1/orgs/${f.orgId}/inquiries/${recipientId}/quotes`, {
          price: { type: "fixed", currency: "ZAR", amount: "1200", unit: "job" },
        })
        .expect(201);
    }
    await f.owner
      .post(`/v1/orgs/${f.orgId}/inquiries/${inquiries[3]?.recipientId ?? ""}/decline`, {
        reason: "Fully booked",
      })
      .expect(200);
    const first = inquiries[0];
    const quoted = (
      await f.owner.get(`/v1/orgs/${f.orgId}/inquiries/${first?.recipientId ?? ""}`).expect(200)
    ).body as InquiryDto;
    await (
      await person("an1-customer0")
    )
      .post(
        `/v1/me/service-requests/${first?.req.id ?? ""}/quotes/${quoted.quotes[0]?.id ?? ""}/accept`,
      )
      .expect(200);

    const stats = (await f.manager.get(`${f.crm}/analytics?days=30`).expect(200))
      .body as ProviderAnalyticsDto;
    expect(stats).toMatchObject({
      periodDays: 30,
      branchId: null,
      inquiries: {
        received: 5,
        responded: 4,
        responseRate: 0.8,
        medianFirstResponseMinutes: 0,
        respondedWithinTarget: 4,
      },
      quotes: { sent: 3, won: 1, lost: 0, winRate: 1 },
      pipeline: { new: 1, open: 0, quoted: 2, won: 1, completed: 0, lost: 1 },
      responseStatus: { level: "within_hour", responseRate: 0.8, basedOnInquiries: 5 },
    });
    const visitor = (await request(t.server).get(slugPath).expect(200)).body as ResponseStatusDto;
    expect(visitor).toMatchObject({
      level: "within_hour",
      label: "Usually responds within an hour",
      responseRate: 0.8,
      basedOnInquiries: 5,
    });
  });
});
