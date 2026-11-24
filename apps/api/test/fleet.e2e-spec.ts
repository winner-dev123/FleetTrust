import { platformStaff, verificationBadges, verificationCases } from "@fleettrust/db";
import {
  type ApplicationDto,
  type BranchDto,
  createdInvitationSchema,
  type ExpenseDto,
  type FleetDashboardDto,
  type FleetIncidentDto,
  type InboxDto,
  JOB_SCAM_WARNING,
  type JobDto,
  type JobRequest,
  type MyOrganization,
  type PreferredProviderDto,
  type PublicJob,
  SPENDING_DISCLAIMER,
  UNVERIFIED_EMPLOYER_NOTICE,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OutboxRelay } from "../src/modules/notifications/index.js";
import { makePerson, type Person, publishProvider } from "./support/providers.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

const reason = (body: unknown) => (body as { reason?: string }).reason;
const DAY = 86_400_000;
const isoDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

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

/** A fleet with branches Main and North, a North-only manager, a driver and a recruiter. */
async function fleet(prefix: string) {
  const owner = await person(`${prefix}-owner`);
  const orgId = (
    (await owner.post("/v1/orgs", { kind: "fleet", name: `${prefix} Haulage` }).expect(201))
      .body as MyOrganization
  ).organization.id;
  const branch = async (name: string) =>
    ((await owner.post(`/v1/orgs/${orgId}/branches`, { name }).expect(201)).body as BranchDto).id;
  const main = await branch("Main");
  const north = await branch("North");
  const northManager = await person(`${prefix}-northmgr`);
  const driver = await person(`${prefix}-driver`);
  const recruiter = await person(`${prefix}-recruiter`);
  await join(owner, orgId, northManager, "manager", north);
  await join(owner, orgId, driver, "driver", main);
  await join(owner, orgId, recruiter, "recruiter", null);
  const vehicle = async (registration: string, branchId: string) =>
    (
      (
        await owner
          .post(`/v1/orgs/${orgId}/vehicles`, {
            vehicleType: "heavy_truck",
            make: "Volvo",
            model: "FH16",
            registration,
            branchId,
          })
          .expect(201)
      ).body as { id: string }
    ).id;
  const v1 = await vehicle("CA 100-001", main);
  const v2 = await vehicle("CA 200-002", north);
  await owner.put(`/v1/vehicles/${v1}/driver`, { userId: driver.id }).expect(200);
  return {
    owner,
    orgId,
    main,
    north,
    northManager,
    driver,
    recruiter,
    v1,
    v2,
    base: `/v1/orgs/${orgId}/fleet`,
  };
}

/** Grants the organization an active business badge, as a verification reviewer would. */
async function verifyBusiness(orgId: string, reviewerId: string) {
  const now = new Date();
  const [c] = await t.db.db
    .insert(verificationCases)
    .values({
      subjectType: "organization",
      organizationId: orgId,
      badgeType: "business",
      status: "approved",
      openedBy: reviewerId,
      submittedAt: now,
      decidedAt: now,
      decidedBy: reviewerId,
    })
    .returning();
  if (!c) throw new Error("no case");
  await t.db.db.insert(verificationBadges).values({
    subjectType: "organization",
    organizationId: orgId,
    badgeType: "business",
    caseId: c.id,
    grantedBy: reviewerId,
    grantedAt: now,
    expiresAt: new Date(now.getTime() + 365 * DAY),
  });
}

describe("fleet operations: tenant isolation and permissions", () => {
  it("scopes incidents, spending, dashboards and preferred providers to the fleet and branch", async () => {
    const f = await fleet("f1");
    const other = await fleet("f2");
    const outsider = await person("f1-outsider");

    // Incidents: the driver reports on their own vehicle only; recruiters and other fleets can't.
    const incident = {
      vehicleId: f.v1,
      kind: "breakdown",
      severity: "high",
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
      location: "N1 near Beaufort West",
      description: "Air pressure warning, stopped on the shoulder.",
    };
    const reported = (await f.driver.post(`${f.base}/incidents`, incident).expect(201))
      .body as FleetIncidentDto;
    expect(reported).toMatchObject({
      vehicle: { id: f.v1, name: "CA 100-001" },
      status: "open",
      branchId: f.main,
    });
    await f.driver.post(`${f.base}/incidents`, { ...incident, vehicleId: f.v2 }).expect(404);
    await f.recruiter.post(`${f.base}/incidents`, incident).expect(404);
    await other.owner.post(`${other.base}/incidents`, incident).expect(404);
    await other.owner.get(`${f.base}/incidents`).expect(404);
    await outsider.get(`${f.base}/incidents/${reported.id}`).expect(404);
    const northIncident = (
      await f.northManager
        .post(`${f.base}/incidents`, { ...incident, vehicleId: f.v2, severity: "low" })
        .expect(201)
    ).body as FleetIncidentDto;
    await f.northManager.post(`${f.base}/incidents`, incident).expect(404);

    // Who sees what: owner everything, the North manager North, the driver their own.
    const ids = async (p: Person) =>
      ((await p.get(`${f.base}/incidents`).expect(200)).body as FleetIncidentDto[])
        .map((i) => i.id)
        .sort();
    expect(await ids(f.owner)).toEqual([reported.id, northIncident.id].sort());
    expect(await ids(f.northManager)).toEqual([northIncident.id]);
    expect(await ids(f.driver)).toEqual([reported.id]);
    expect(await ids(f.recruiter)).toEqual([]);
    await f.driver.patch(`${f.base}/incidents/${reported.id}`, { status: "resolved" }).expect(403);
    await f.northManager.get(`${f.base}/incidents/${reported.id}`).expect(404);
    const resolved = (
      await f.owner
        .patch(`${f.base}/incidents/${reported.id}`, {
          status: "resolved",
          resolutionNote: "Towed and repaired.",
        })
        .expect(200)
    ).body as FleetIncidentDto;
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).not.toBeNull();

    // Spending records: the driver records fuel for their vehicle; organization costs are for managers.
    const fuel = (
      await f.driver
        .post(`${f.base}/expenses`, {
          vehicleId: f.v1,
          category: "fuel",
          amount: "2450.50",
          currency: "ZAR",
          spentOn: isoDate(-2),
          vendor: "Engen N1",
          litres: "105.2",
        })
        .expect(201)
    ).body as ExpenseDto;
    expect(fuel).toMatchObject({
      amount: "2450.5",
      verified: false,
      source: "entered_by_user",
      disclaimer: SPENDING_DISCLAIMER,
    });
    expect(JSON.stringify(fuel)).not.toMatch(/"(paid|payment|receiptVerified)"/i);
    await f.driver
      .post(`${f.base}/expenses`, {
        category: "insurance",
        amount: "9000",
        currency: "ZAR",
        spentOn: isoDate(-1),
      })
      .expect(403);
    await f.driver
      .post(`${f.base}/expenses`, {
        vehicleId: f.v1,
        category: "tolls",
        amount: "120",
        currency: "ZAR",
        spentOn: isoDate(-1),
        litres: "5",
      })
      .expect(400);
    await f.owner
      .post(`${f.base}/expenses`, {
        category: "insurance",
        amount: "9000",
        currency: "ZAR",
        spentOn: isoDate(-1),
      })
      .expect(201);
    await f.owner
      .post(`${f.base}/expenses`, {
        vehicleId: f.v2,
        category: "tolls",
        amount: "35",
        currency: "USD",
        spentOn: isoDate(-1),
      })
      .expect(201);
    await f.recruiter.get(`${f.base}/expenses`).expect(200).expect([]);
    await other.owner.get(`${f.base}/expenses`).expect(404);
    await f.northManager.del(`${f.base}/expenses/${fuel.id}`).expect(404);
    // A service record with a cost counts as spending too.
    await f.owner
      .post(`/v1/vehicles/${f.v1}/service-records`, {
        performedOn: isoDate(-5),
        category: "repair",
        title: "Air compressor",
        cost: { amount: "3200", currency: "ZAR" },
      })
      .expect(201);
    await f.owner
      .post(`/v1/vehicles/${f.v1}/schedules`, {
        title: "Major service",
        kind: "service",
        intervalDays: 30,
        lastDoneOn: isoDate(-45),
      })
      .expect(201);

    // Dashboard: managers only, branch-scoped managers see their branch.
    const dash = (await f.owner.get(`${f.base}/dashboard`).expect(200)).body as FleetDashboardDto;
    expect(dash).toMatchObject({
      vehicles: { active: 2, withDriver: 1 },
      maintenance: { overdue: 1, items: [{ title: "Major service", status: "overdue" }] },
      incidents: { open: 1, inWindow: 2, highSeverityOpen: 0 },
      spending: { verified: false, disclaimer: SPENDING_DISCLAIMER },
    });
    expect(dash.spending.lines).toEqual([
      {
        currency: "USD",
        total: "35",
        byCategory: [{ category: "tolls", total: "35" }],
        bySource: { expenses: "35", serviceRecords: "0" },
      },
      {
        currency: "ZAR",
        total: "14650.5",
        byCategory: [
          { category: "insurance", total: "9000" },
          { category: "repair", total: "3200" },
          { category: "fuel", total: "2450.5" },
        ],
        bySource: { expenses: "11450.5", serviceRecords: "3200" },
      },
    ]);
    const northDash = (await f.northManager.get(`${f.base}/dashboard`).expect(200))
      .body as FleetDashboardDto;
    expect(northDash).toMatchObject({
      branchId: f.north,
      vehicles: { active: 1 },
      maintenance: { overdue: 0 },
    });
    expect(northDash.spending.lines.map((l) => l.currency)).toEqual(["USD"]);
    await f.northManager.get(`${f.base}/dashboard?branchId=${f.main}`).expect(403);
    await f.driver.get(`${f.base}/dashboard`).expect(403);
    await f.recruiter.get(`${f.base}/dashboard`).expect(403);
    await other.owner.get(`${f.base}/dashboard`).expect(404);

    // Preferred providers: managers edit, drivers see, providers only see a count.
    const pOwner = await person("f1-provider");
    const provider = await publishProvider(pOwner, {
      slug: "f1-workshop",
      at: { lng: 28.0, lat: -26.2 },
    });
    const pref = `${f.base}/preferred-providers`;
    const added = (
      await f.owner
        .post(pref, {
          providerSlug: "f1-workshop",
          categories: ["workshop"],
          note: "Fast on brakes",
        })
        .expect(201)
    ).body as PreferredProviderDto[];
    expect(added).toMatchObject([
      { provider: { slug: "f1-workshop", available: true }, branchId: null },
    ]);
    expect(
      reason((await f.owner.post(pref, { providerSlug: "f1-workshop" }).expect(409)).body),
    ).toBe("already_preferred");
    expect(
      reason((await f.owner.post(pref, { providerSlug: "nobody-here" }).expect(400)).body),
    ).toBe("provider_not_found");
    await f.driver.post(pref, { providerSlug: "f1-workshop" }).expect(403);
    expect(((await f.driver.get(pref).expect(200)).body as PreferredProviderDto[]).length).toBe(1);
    await f.recruiter.get(pref).expect(403);
    await f.northManager.post(pref, { providerSlug: "f1-workshop" }).expect(403);
    await f.northManager.post(pref, { providerSlug: "f1-workshop", branchId: f.north }).expect(201);
    await f.northManager.del(`${pref}/${added[0]?.id ?? ""}`).expect(403);
    await other.owner.get(pref).expect(404);
    await other.owner
      .post(`${other.base}/preferred-providers`, { providerSlug: "f1-workshop" })
      .expect(201);
    expect((await pOwner.get(`/v1/orgs/${provider.orgId}/preferred-by`).expect(200)).body).toEqual({
      fleets: 2,
    });
    expect(reason((await f.owner.get(`/v1/orgs/${f.orgId}/preferred-by`).expect(400)).body)).toBe(
      "not_a_provider",
    );
  });
});

const jobBody = (extra: Partial<JobRequest> = {}): JobRequest => ({
  title: "Long-haul truck driver (EC)",
  description:
    "Drive our Volvo FH16 fleet on the Johannesburg to Cape Town route. Two weeks on, one week off. Clean record required.",
  role: "driver",
  employmentType: "full_time",
  licenceClasses: ["EC"],
  locality: "Johannesburg",
  countryCode: "ZA",
  salary: { currency: "ZAR", min: "18000", max: "22000", period: "month" },
  closesOn: isoDate(30),
  ...extra,
});

describe("job board", () => {
  it("publishes verified employers directly, moderates the rest, and handles applications", async () => {
    const verified = await fleet("j1");
    const unverified = await fleet("j2");
    await verifyBusiness(verified.orgId, verified.owner.id);
    const mod = await person("j-moderator");
    await t.db.db.insert(platformStaff).values({ userId: mod.id, role: "trust_safety_moderator" });

    // Recruiters manage jobs but nothing else; drivers and other fleets can't.
    const jobsPath = `/v1/orgs/${verified.orgId}/jobs`;
    await verified.recruiter.get(`/v1/orgs/${verified.orgId}/fleet/dashboard`).expect(403);
    await verified.recruiter.get(`/v1/orgs/${verified.orgId}/vehicles`).expect(403);
    await verified.driver.post(jobsPath, jobBody()).expect(403);
    await unverified.owner.get(jobsPath).expect(404);
    const pOwner = await person("j-provider");
    const provider = await publishProvider(pOwner, {
      slug: "j-garage",
      at: { lng: 28.0, lat: -26.2 },
    });
    expect(
      reason((await pOwner.post(`/v1/orgs/${provider.orgId}/jobs`, jobBody()).expect(400)).body),
    ).toBe("not_a_fleet");
    expect(
      reason(
        (await verified.recruiter.post(jobsPath, jobBody({ closesOn: isoDate(-1) })).expect(400))
          .body,
      ),
    ).toBe("invalid_close_date");
    expect(
      reason(
        (await verified.recruiter.post(jobsPath, jobBody({ closesOn: isoDate(120) })).expect(400))
          .body,
      ),
    ).toBe("invalid_close_date");

    // Verified employer, clean text: live at once.
    const draft = (await verified.recruiter.post(jobsPath, jobBody()).expect(201)).body as JobDto;
    expect(draft.status).toBe("draft");
    const live = (await verified.recruiter.post(`${jobsPath}/${draft.id}/publish`).expect(200))
      .body as JobDto;
    expect(live).toMatchObject({
      status: "published",
      employer: { verified: true },
      salary: { label: "ZAR 18000–22000 per month (advertised)" },
      employerNotice: null,
    });

    // Unverified employer: waits for a moderator, then goes live with a notice.
    const uPath = `/v1/orgs/${unverified.orgId}/jobs`;
    const pending = (
      await unverified.owner
        .post(uPath, jobBody({ title: "Diesel mechanic", role: "mechanic" }))
        .expect(201)
    ).body as JobDto;
    const submitted = (await unverified.owner.post(`${uPath}/${pending.id}/publish`).expect(200))
      .body as JobDto;
    expect(submitted).toMatchObject({
      status: "pending_moderation",
      moderationNote: expect.stringContaining("not verified") as string,
    });
    await request(t.server).get(`/v1/jobs/${pending.id}`).expect(404);
    const queue = (await mod.get("/v1/moderation/queue").expect(200)).body as {
      targetType: string;
      targetId: string;
    }[];
    expect(queue).toContainEqual(
      expect.objectContaining({ targetType: "job", targetId: pending.id }),
    );
    await mod.post(`/v1/moderation/jobs/${pending.id}/approve`, {}).expect(200);
    const approved = (await request(t.server).get(`/v1/jobs/${pending.id}`).expect(200))
      .body as PublicJob;
    expect(approved).toMatchObject({
      employer: { verified: false },
      employerNotice: UNVERIFIED_EMPLOYER_NOTICE,
      scamWarning: JOB_SCAM_WARNING,
    });

    // Fee wording goes to moderation even for verified employers, also when edited in later.
    const feeJob = (
      await verified.recruiter
        .post(
          jobsPath,
          jobBody({
            title: "Bus driver",
            description: `${jobBody().description} A R500 training fee applies on the first day.`,
          }),
        )
        .expect(201)
    ).body as JobDto;
    expect(feeJob.warnings).toEqual(["asks_for_payment"]);
    expect(
      (
        (await verified.recruiter.post(`${jobsPath}/${feeJob.id}/publish`).expect(200))
          .body as JobDto
      ).status,
    ).toBe("pending_moderation");
    const edited = (
      await verified.recruiter
        .put(
          `${jobsPath}/${live.id}`,
          jobBody({ description: `${jobBody().description} Send a deposit to secure the job.` }),
        )
        .expect(200)
    ).body as JobDto;
    expect(edited.status).toBe("pending_moderation");
    await mod.post(`/v1/moderation/jobs/${live.id}/approve`, {}).expect(200);

    // Public board and filters.
    const board = (await request(t.server).get("/v1/jobs?countryCode=ZA").expect(200)).body as {
      items: PublicJob[];
    };
    expect(board.items.map((j) => j.id)).toEqual(expect.arrayContaining([live.id, pending.id]));
    expect(board.items.map((j) => j.id)).not.toContain(feeJob.id);
    const verifiedOnly = (await request(t.server).get("/v1/jobs?verifiedOnly=true").expect(200))
      .body as {
      items: PublicJob[];
    };
    expect(verifiedOnly.items.map((j) => j.id)).toContain(live.id);
    expect(verifiedOnly.items.map((j) => j.id)).not.toContain(pending.id);

    // Applications.
    const applicant = await person("j-applicant");
    const apply = {
      message: "Ten years of long-haul experience with a clean record.",
      phone: "+27 82 555 0101",
    };
    await applicant
      .post(`/v1/jobs/${live.id}/applications`, { message: apply.message })
      .expect(400);
    const application = (
      await applicant.post(`/v1/jobs/${live.id}/applications`, apply).expect(201)
    ).body as ApplicationDto;
    expect(application).toMatchObject({
      status: "submitted",
      job: { employer: { verified: true } },
    });
    expect(
      reason((await applicant.post(`/v1/jobs/${live.id}/applications`, apply).expect(409)).body),
    ).toBe("already_applied");
    expect(
      reason(
        (await verified.driver.post(`/v1/jobs/${live.id}/applications`, apply).expect(400)).body,
      ),
    ).toBe("own_job");
    expect(
      reason((await applicant.post(`/v1/jobs/${feeJob.id}/applications`, apply).expect(409)).body),
    ).toBe("job_not_open");

    const listed = (await verified.recruiter.get(`${jobsPath}/${live.id}/applications`).expect(200))
      .body as ApplicationDto[];
    expect(listed.map((a) => [a.applicant.name, a.phone, a.email])).toEqual([
      ["j-applicant", "+27 82 555 0101", null],
    ]);
    await unverified.owner
      .patch(`/v1/orgs/${unverified.orgId}/job-applications/${application.id}`, {
        status: "shortlisted",
      })
      .expect(404);
    await verified.recruiter
      .patch(`/v1/orgs/${verified.orgId}/job-applications/${application.id}`, {
        status: "shortlisted",
      })
      .expect(200);
    const relay = t.app.get(OutboxRelay);
    await relay.drain();
    const recruiterInbox = (await verified.recruiter.get("/v1/me/inbox").expect(200))
      .body as InboxDto;
    expect(recruiterInbox.notifications.map((n) => n.kind)).toContain("job_application");
    expect(
      ((await verified.driver.get("/v1/me/inbox").expect(200)).body as InboxDto).notifications.map(
        (n) => n.kind,
      ),
    ).not.toContain("job_application");
    const applicantInbox = (await applicant.get("/v1/me/inbox").expect(200)).body as InboxDto;
    expect(applicantInbox.notifications.map((n) => n.body)).toContain(
      'j1 Haulage shortlisted you for "Long-haul truck driver (EC)".',
    );
    await applicant.post(`/v1/me/job-applications/${application.id}/withdraw`).expect(200);
    await verified.recruiter
      .patch(`/v1/orgs/${verified.orgId}/job-applications/${application.id}`, { status: "hired" })
      .expect(409);
    expect(
      ((await applicant.get("/v1/me/job-applications").expect(200)).body as ApplicationDto[])[0]
        ?.status,
    ).toBe("withdrawn");

    // Reports: three reporters take a listing out of public view; a moderator hides it.
    for (const uid of ["j-r1", "j-r2", "j-r3"]) {
      const reporter = await person(uid);
      await reporter
        .post("/v1/reports", { targetType: "job", targetId: pending.id, reason: "scam" })
        .expect(201);
    }
    await request(t.server).get(`/v1/jobs/${pending.id}`).expect(404);
    await mod
      .post(`/v1/moderation/jobs/${pending.id}/hide`, { reason: "Asked applicants for money." })
      .expect(200);
    const hidden = (await unverified.owner.get(`${uPath}/${pending.id}`).expect(200))
      .body as JobDto;
    expect(hidden).toMatchObject({
      status: "hidden",
      moderationNote: "Asked applicants for money.",
    });
    await unverified.owner.put(`${uPath}/${pending.id}`, jobBody()).expect(409);
    await relay.drain();
    expect(
      ((await unverified.owner.get("/v1/me/inbox").expect(200)).body as InboxDto).notifications.map(
        (n) => n.body,
      ),
    ).toContain(
      'Your job listing "Diesel mechanic" was hidden by FleetTrust moderators. Reason: Asked applicants for money.',
    );
    // Moderators can't decide their own listings, and drafts aren't reportable.
    const draftOnly = (await verified.recruiter.post(jobsPath, jobBody()).expect(201))
      .body as JobDto;
    await applicant
      .post("/v1/reports", { targetType: "job", targetId: draftOnly.id, reason: "spam" })
      .expect(404);
  });
});
