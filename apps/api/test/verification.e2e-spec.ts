import {
  auditEvents,
  documentAccessGrants,
  eq,
  platformStaff,
  verificationBadges,
  verificationCases,
  verificationDocuments,
} from "@fleettrust/db";
import type {
  BadgeDto,
  DocumentUpload,
  MyOrganization,
  PlanDto,
  ReviewCaseDto,
  VerificationCaseDto,
  VerificationLabels,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ReviewService } from "../src/modules/verification/index.js";
import { type MemoryObjectStorage, OBJECT_STORAGE } from "../src/platform/storage/index.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;
let storage: MemoryObjectStorage;

beforeAll(async () => {
  t = await createTestApp();
  storage = t.app.get(OBJECT_STORAGE);
});

afterAll(async () => {
  await t.close();
});

const reason = (body: unknown) => (body as { reason?: string }).reason;
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n", "latin1");
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("fake image body"),
]);
const EICAR = Buffer.from(
  "%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n",
  "latin1",
);

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
  };
}
type Person = ReturnType<typeof person>;

async function userIdOf(p: Person): Promise<string> {
  return ((await p.get("/v1/me").expect(200)).body as { id: string }).id;
}

async function staff(
  uid: string,
  role: "verification_reviewer" | "billing_operator",
): Promise<Person> {
  const p = person(uid);
  await t.db.db.insert(platformStaff).values({ userId: await userIdOf(p), role });
  return p;
}

async function createOrg(
  owner: Person,
  kind: "provider" | "fleet",
  name = `${owner.uid} org`,
): Promise<string> {
  const response = await owner.post("/v1/orgs", { kind, name }).expect(201);
  return (response.body as MyOrganization).organization.id;
}

/** The full client flow: register, PUT the bytes to the upload URL, then complete. */
async function upload(
  p: Person,
  caseId: string,
  data: Buffer,
  contentType = "application/pdf",
  kind = "identity_document",
  declaredSize = data.length,
) {
  const created = (
    await p
      .post(`/v1/verification/cases/${caseId}/documents`, { kind, contentType, size: declaredSize })
      .expect(201)
  ).body as DocumentUpload;
  const path = new URL(created.upload.url).pathname;
  await request(t.server).put(path).set(created.upload.headers).send(data).expect(200);
  const completed = await p.post(
    `/v1/verification/cases/${caseId}/documents/${created.document.id}/complete`,
  );
  return { documentId: created.document.id, completed, uploadPath: path };
}

async function driverCase(p: Person): Promise<string> {
  const response = await p.post("/v1/me/verification/cases", { badgeType: "driver" }).expect(201);
  return (response.body as VerificationCaseDto).id;
}

async function submittedDriverCase(p: Person): Promise<{ caseId: string; documentId: string }> {
  const caseId = await driverCase(p);
  const { documentId, completed } = await upload(p, caseId, PDF);
  expect(completed.status).toBe(200);
  await p.post(`/v1/verification/cases/${caseId}/submit`).expect(200);
  return { caseId, documentId };
}

let reviewer: Person;
let secondReviewer: Person;

beforeAll(async () => {
  reviewer = await staff("reviewer-one", "verification_reviewer");
  secondReviewer = await staff("reviewer-two", "verification_reviewer");
});

async function labelsOf(type: "users" | "organizations", id: string) {
  return (await person("label-reader").get(`/v1/verification/labels/${type}/${id}`).expect(200))
    .body as VerificationLabels;
}

describe("labels are accurate", () => {
  it("a person is unverified until a reviewer approves, and verified only while the badge is current", async () => {
    const driver = person("label-driver");
    const id = await userIdOf(driver);
    expect((await labelsOf("users", id)).labels).toEqual([
      { badgeType: "driver", status: "unverified", expiresAt: null },
    ]);

    const { caseId } = await submittedDriverCase(driver);
    // Pending review is still unverified.
    expect((await labelsOf("users", id)).labels[0]?.status).toBe("unverified");

    await reviewer
      .post(`/v1/admin/verification/cases/${caseId}/decision`, { decision: "approve" })
      .expect(200);
    const verified = (await labelsOf("users", id)).labels[0];
    expect(verified?.status).toBe("verified");
    expect(verified?.expiresAt).not.toBeNull();

    // Expired badges disappear from labels automatically.
    await t.db.db
      .update(verificationBadges)
      .set({
        grantedAt: new Date(Date.now() - 400 * 86_400_000),
        expiresAt: new Date(Date.now() - 1000),
      })
      .where(eq(verificationBadges.caseId, caseId));
    expect((await labelsOf("users", id)).labels[0]).toEqual({
      badgeType: "driver",
      status: "unverified",
      expiresAt: null,
    });
    const badges = (await driver.get("/v1/me/verification/badges").expect(200)).body as BadgeDto[];
    expect(badges[0]).toMatchObject({ status: "expired", reverificationDue: true });
  });

  it("rejected and revoked mean unverified; labels never reveal reasons", async () => {
    const rejected = person("label-rejected");
    const { caseId } = await submittedDriverCase(rejected);
    await reviewer
      .post(`/v1/admin/verification/cases/${caseId}/decision`, {
        decision: "reject",
        reason: "Document unreadable",
      })
      .expect(200);
    const labels = await labelsOf("users", await userIdOf(rejected));
    expect(labels.labels[0]?.status).toBe("unverified");
    expect(JSON.stringify(labels)).not.toContain("unreadable");

    const revoked = person("label-revoked");
    const second = await submittedDriverCase(revoked);
    await reviewer
      .post(`/v1/admin/verification/cases/${second.caseId}/decision`, { decision: "approve" })
      .expect(200);
    const [badge] = (await revoked.get("/v1/me/verification/badges").expect(200))
      .body as BadgeDto[];
    await reviewer
      .post(`/v1/admin/verification/badges/${badge?.id ?? ""}/revoke`, {
        reason: "Licence reported suspended",
      })
      .set("X-Confirm-Action", "badge.revoke")
      .expect(204);
    expect((await labelsOf("users", await userIdOf(revoked))).labels[0]?.status).toBe("unverified");
  });

  it("plans never change badges or labels (ADR-0009)", async () => {
    const operator = await staff("verif-billing", "billing_operator");
    const free = person("plan-free-owner");
    const paying = person("plan-pro-owner");
    const freeOrg = await createOrg(free, "provider", "Same Garage");
    const proOrg = await createOrg(paying, "provider", "Same Garage Two");
    const catalog = (await operator.get("/v1/admin/billing/plans").expect(200)).body as PlanDto[];
    const pro = catalog
      .find((p) => p.code === "provider-pro")
      ?.versions.find((v) => v.status === "published");
    await operator
      .post("/v1/admin/billing/assignments", {
        subject: { type: "organization", id: proOrg },
        planVersionId: pro?.id,
        externalReference: "Invoice 1",
      })
      .expect(201);
    const strip = (labels: VerificationLabels) => labels.labels;
    expect(strip(await labelsOf("organizations", proOrg))).toEqual(
      strip(await labelsOf("organizations", freeOrg)),
    );
    // The paying org gets no shortcut through review either.
    const caseResponse = await paying
      .post(`/v1/orgs/${proOrg}/verification/cases`, { badgeType: "business" })
      .expect(201);
    expect((caseResponse.body as VerificationCaseDto).status).toBe("draft");
  });
});

describe("evidence pipeline", () => {
  it("stores documents encrypted, never in plaintext, and empties quarantine", async () => {
    const applicant = person("pipeline-ok");
    const caseId = await driverCase(applicant);
    const { documentId, completed } = await upload(applicant, caseId, PDF);
    expect(completed.status).toBe(200);
    const body = completed.body as VerificationCaseDto;
    expect(body.documents[0]).toMatchObject({
      id: documentId,
      status: "available",
      contentType: "application/pdf",
    });

    const [row] = await t.db.db
      .select()
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, documentId));
    const raw = storage.raw("sensitive", row?.storageKey ?? "");
    expect(raw).toBeDefined();
    expect(raw?.includes(Buffer.from("%PDF"))).toBe(false);
    expect(raw?.equals(PDF)).toBe(false);
    expect(storage.raw("quarantine", row?.quarantineKey ?? "")).toBeUndefined();
    expect(row?.scanResult).toBe("clean:eicar-only");
    // The applicant view exposes metadata only: no keys, hashes or storage paths.
    const text = JSON.stringify(body);
    for (const secret of ["documents/", "uploads/", row?.wrappedKey ?? "x", row?.sha256 ?? "x"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("rejects malware, disguised file types and size mismatches", async () => {
    const applicant = person("pipeline-bad");
    const caseId = await driverCase(applicant);

    const infected = await upload(applicant, caseId, EICAR);
    expect(infected.completed.status).toBe(400);
    expect(reason(infected.completed.body)).toBe("malware_detected");

    const disguised = await upload(applicant, caseId, PDF, "image/png");
    expect(reason(disguised.completed.body)).toBe("content_type_mismatch");

    const truncated = await upload(applicant, caseId, PNG, "image/png", "other", PNG.length + 10);
    expect(reason(truncated.completed.body)).toBe("upload_size_mismatch");

    const rows = await t.db.db
      .select()
      .from(verificationDocuments)
      .where(eq(verificationDocuments.caseId, caseId));
    expect(rows.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(rows.find((r) => r.id === infected.documentId)?.scanResult).toBe(
      "infected:Eicar-Test-Signature",
    );
    expect(storage.keys().filter((k) => rows.some((r) => k.endsWith(r.quarantineKey)))).toEqual([]);

    // Nothing usable: submitting is refused.
    const submit = await applicant.post(`/v1/verification/cases/${caseId}/submit`).expect(409);
    expect(reason(submit.body)).toBe("no_documents");
  });

  it("upload links are single-use and bound to the declared content type", async () => {
    const applicant = person("pipeline-url");
    const caseId = await driverCase(applicant);
    const created = (
      await applicant
        .post(`/v1/verification/cases/${caseId}/documents`, {
          kind: "driving_licence",
          contentType: "image/png",
          size: PNG.length,
        })
        .expect(201)
    ).body as DocumentUpload;
    const path = new URL(created.upload.url).pathname;
    await request(t.server).put(path).set("Content-Type", "text/html").send(PNG).expect(403);
    // The failed attempt consumed the link, like a signed URL with a precondition.
    await request(t.server).put(path).set("Content-Type", "image/png").send(PNG).expect(404);
  });
});

describe("access control", () => {
  it("only the applicant (or org managers) can see a case; documents never go back to applicants", async () => {
    const applicant = person("access-owner");
    const { caseId } = await submittedDriverCase(applicant);
    await person("access-stranger").get(`/v1/verification/cases/${caseId}`).expect(404);
    await applicant.get(`/v1/verification/cases/${caseId}`).expect(200);
    // No applicant route serves document content.
    await applicant.get(`/v1/admin/verification/cases/${caseId}`).expect(404);
  });

  it("org cases need verification.manage; staff members can't even see them", async () => {
    const owner = person("org-verif-owner");
    const staffMember = person("org-verif-staff");
    const orgId = await createOrg(owner, "provider");
    const invite = await owner
      .post(`/v1/orgs/${orgId}/invitations`, { email: staffMember.email, role: "staff" })
      .expect(201);
    await staffMember
      .post("/v1/invitations/accept", { token: (invite.body as { token: string }).token })
      .expect(200);

    const opened = await owner
      .post(`/v1/orgs/${orgId}/verification/cases`, { badgeType: "business" })
      .expect(201);
    const caseId = (opened.body as VerificationCaseDto).id;
    const denied = await staffMember
      .post(`/v1/orgs/${orgId}/verification/cases`, { badgeType: "location" })
      .expect(403);
    expect(reason(denied.body)).toBe("insufficient_permission");
    await staffMember.get(`/v1/verification/cases/${caseId}`).expect(404);
    await person("org-verif-outsider").get(`/v1/orgs/${orgId}/verification/cases`).expect(404);
    // Members can see the org's badges (they're public labels anyway).
    await staffMember.get(`/v1/orgs/${orgId}/verification/badges`).expect(200);
  });

  it("badges must fit the subject", async () => {
    const someone = person("badge-fit");
    const asUser = await someone
      .post("/v1/me/verification/cases", { badgeType: "business" })
      .expect(400);
    expect(reason(asUser.body)).toBe("badge_not_applicable");
    const fleetOrg = await createOrg(someone, "fleet");
    const location = await someone
      .post(`/v1/orgs/${fleetOrg}/verification/cases`, { badgeType: "location" })
      .expect(400);
    expect(reason(location.body)).toBe("badge_not_applicable");
  });

  it("the reviewer API is invisible to non-reviewers", async () => {
    const someone = person("not-a-reviewer");
    await someone.get("/v1/admin/verification/cases").expect(404);
    const billing = await staff("billing-not-reviewer", "billing_operator");
    await billing.get("/v1/admin/verification/cases").expect(404);
  });

  it("reviewers get one-time, short-lived links to decrypted documents, and every access is audited", async () => {
    const applicant = person("access-doc");
    const { caseId, documentId } = await submittedDriverCase(applicant);
    const queue = (await reviewer.get("/v1/admin/verification/cases").expect(200))
      .body as ReviewCaseDto[];
    expect(queue.map((c) => c.id)).toContain(caseId);

    const link = (
      await reviewer.post(`/v1/admin/verification/documents/${documentId}/access`).expect(200)
    ).body as { url: string; expiresAt: string };
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
    const path = new URL(link.url).pathname;
    const fetched = await request(t.server)
      .get(path)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          done(null, Buffer.concat(chunks));
        });
      })
      .expect(200);
    expect((fetched.body as Buffer).equals(PDF)).toBe(true);
    expect(fetched.headers["cache-control"]).toContain("no-store");
    expect(fetched.headers["x-content-type-options"]).toBe("nosniff");
    expect(fetched.headers["content-security-policy"]).toContain("sandbox");
    // Single use.
    const again = await request(t.server).get(path).expect(410);
    expect(reason(again.body)).toBe("access_expired");

    // Expired links are refused.
    const second = (
      await reviewer.post(`/v1/admin/verification/documents/${documentId}/access`).expect(200)
    ).body as { url: string };
    await t.db.db.update(documentAccessGrants).set({ expiresAt: new Date(Date.now() - 1000) });
    await request(t.server).get(new URL(second.url).pathname).expect(410);

    const actions = (
      await t.db.db.select().from(auditEvents).where(eq(auditEvents.targetId, caseId))
    ).map((e) => e.action);
    expect(actions.filter((a) => a === "verification.document_access_granted")).toHaveLength(2);
    expect(actions.filter((a) => a === "verification.document_accessed")).toHaveLength(1);
  });
});

describe("review decisions", () => {
  it("are audited with the reviewer, and rejections need a reason", async () => {
    const applicant = person("decision-audit");
    const { caseId } = await submittedDriverCase(applicant);
    await reviewer
      .post(`/v1/admin/verification/cases/${caseId}/decision`, { decision: "reject" })
      .expect(400);
    await reviewer
      .post(`/v1/admin/verification/cases/${caseId}/decision`, {
        decision: "request_changes",
        reason: "Back side missing",
      })
      .expect(200);
    const view = (await applicant.get(`/v1/verification/cases/${caseId}`).expect(200))
      .body as VerificationCaseDto;
    expect(view).toMatchObject({
      status: "changes_requested",
      decisionReason: "Back side missing",
    });

    await upload(applicant, caseId, PNG, "image/png", "driving_licence");
    await applicant.post(`/v1/verification/cases/${caseId}/submit`).expect(200);
    await reviewer
      .post(`/v1/admin/verification/cases/${caseId}/decision`, { decision: "approve" })
      .expect(200);
    // Decided cases can't be decided again.
    await reviewer
      .post(`/v1/admin/verification/cases/${caseId}/decision`, {
        decision: "reject",
        reason: "Changed my mind",
      })
      .expect(409);

    const reviewerId = await userIdOf(reviewer);
    const events = await t.db.db.select().from(auditEvents).where(eq(auditEvents.targetId, caseId));
    const decisions = events.filter((e) =>
      ["verification.changes_requested", "verification.badge_granted"].includes(e.action),
    );
    expect(decisions).toHaveLength(2);
    expect(decisions.every((e) => e.actorType === "admin" && e.actorId === reviewerId)).toBe(true);
  });

  it("reviewers can't decide their own case or one for an organization they belong to", async () => {
    const { caseId } = await submittedDriverCase(reviewer);
    const own = await reviewer
      .post(`/v1/admin/verification/cases/${caseId}/decision`, { decision: "approve" })
      .expect(403);
    expect(reason(own.body)).toBe("conflict_of_interest");

    const orgId = await createOrg(secondReviewer, "provider");
    const opened = await secondReviewer
      .post(`/v1/orgs/${orgId}/verification/cases`, { badgeType: "business" })
      .expect(201);
    const orgCase = (opened.body as VerificationCaseDto).id;
    await upload(secondReviewer, orgCase, PDF, "application/pdf", "business_registration");
    await secondReviewer.post(`/v1/verification/cases/${orgCase}/submit`).expect(200);
    await secondReviewer
      .post(`/v1/admin/verification/cases/${orgCase}/decision`, { decision: "approve" })
      .expect(403);
    await secondReviewer
      .post(
        `/v1/admin/verification/documents/${(await t.db.db.select().from(verificationDocuments).where(eq(verificationDocuments.caseId, orgCase)))[0]?.id ?? ""}/access`,
      )
      .expect(403);
  });

  it("one open case per badge, and renewal only near expiry", async () => {
    const applicant = person("renewal");
    const first = await driverCase(applicant);
    const duplicate = await applicant
      .post("/v1/me/verification/cases", { badgeType: "driver" })
      .expect(409);
    expect(reason(duplicate.body)).toBe("case_already_open");
    await upload(applicant, first, PDF);
    await applicant.post(`/v1/verification/cases/${first}/submit`).expect(200);
    await reviewer
      .post(`/v1/admin/verification/cases/${first}/decision`, { decision: "approve" })
      .expect(200);

    const early = await applicant
      .post("/v1/me/verification/cases", { badgeType: "driver" })
      .expect(409);
    expect(reason(early.body)).toBe("renewal_not_due");

    // Ten days left: reverification is due and a renewal case links to the badge.
    await t.db.db
      .update(verificationBadges)
      .set({ expiresAt: new Date(Date.now() + 10 * 86_400_000) })
      .where(eq(verificationBadges.caseId, first));
    const [due] = (await applicant.get("/v1/me/verification/badges").expect(200))
      .body as BadgeDto[];
    expect(due).toMatchObject({ status: "active", reverificationDue: true });
    const renewal = (
      await applicant.post("/v1/me/verification/cases", { badgeType: "driver" }).expect(201)
    ).body as VerificationCaseDto;
    expect(renewal.renewsBadgeId).toBe(due?.id);
    await upload(applicant, renewal.id, PDF);
    await applicant.post(`/v1/verification/cases/${renewal.id}/submit`).expect(200);
    await secondReviewer
      .post(`/v1/admin/verification/cases/${renewal.id}/decision`, { decision: "approve" })
      .expect(200);
    const badges = (await applicant.get("/v1/me/verification/badges").expect(200))
      .body as BadgeDto[];
    expect(badges.map((b) => b.status).sort()).toEqual(["active", "superseded"]);
  });
});

describe("appeals", () => {
  it("a rejection can be appealed once, and a different reviewer decides", async () => {
    const applicant = person("appeal-case");
    const { caseId } = await submittedDriverCase(applicant);
    await reviewer
      .post(`/v1/admin/verification/cases/${caseId}/decision`, {
        decision: "reject",
        reason: "Name mismatch",
      })
      .expect(200);
    const appealed = (
      await applicant
        .post(`/v1/verification/cases/${caseId}/appeal`, {
          statement: "My licence shows my legal name; see page 2.",
        })
        .expect(200)
    ).body as VerificationCaseDto;
    expect(appealed.appeal?.status).toBe("open");
    const twice = await applicant
      .post(`/v1/verification/cases/${caseId}/appeal`, {
        statement: "Second attempt at appealing this.",
      })
      .expect(409);
    expect(reason(twice.body)).toBe("appeal_exists");

    const appealId = appealed.appeal?.id ?? "";
    const self = await reviewer
      .post(`/v1/admin/verification/appeals/${appealId}/decision`, {
        decision: "overturn",
        reason: "Looks fine to me",
      })
      .expect(403);
    expect(reason(self.body)).toBe("conflict_of_interest");
    await secondReviewer
      .post(`/v1/admin/verification/appeals/${appealId}/decision`, {
        decision: "overturn",
        reason: "Name matches on page 2",
      })
      .expect(200);
    const [row] = await t.db.db
      .select()
      .from(verificationCases)
      .where(eq(verificationCases.id, caseId));
    expect(row?.status).toBe("submitted"); // back in the queue for a fresh review
  });

  it("a revoked badge can be appealed and reinstated", async () => {
    const applicant = person("appeal-badge");
    const { caseId } = await submittedDriverCase(applicant);
    await reviewer
      .post(`/v1/admin/verification/cases/${caseId}/decision`, { decision: "approve" })
      .expect(200);
    const [badge] = (await applicant.get("/v1/me/verification/badges").expect(200))
      .body as BadgeDto[];
    await reviewer
      .post(`/v1/admin/verification/badges/${badge?.id ?? ""}/revoke`, {
        reason: "Reported as forged",
      })
      .set("X-Confirm-Action", "badge.revoke")
      .expect(204);
    const appealed = (
      await applicant
        .post(`/v1/verification/badges/${badge?.id ?? ""}/appeal`, {
          statement: "The report was malicious; originals available.",
        })
        .expect(200)
    ).body as BadgeDto;
    expect(appealed).toMatchObject({ status: "revoked", revocationReason: "Reported as forged" });
    await secondReviewer
      .post(`/v1/admin/verification/appeals/${appealed.appeal?.id ?? ""}/decision`, {
        decision: "overturn",
        reason: "Originals checked",
      })
      .expect(200);
    expect((await labelsOf("users", await userIdOf(applicant))).labels[0]?.status).toBe("verified");
  });
});

describe("retention", () => {
  it("purges evidence after the retention period but keeps the record", async () => {
    const applicant = person("retention");
    const { caseId, documentId } = await submittedDriverCase(applicant);
    await reviewer
      .post(`/v1/admin/verification/cases/${caseId}/decision`, { decision: "approve" })
      .expect(200);
    const [before] = await t.db.db
      .select()
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, documentId));
    await t.db.db
      .update(verificationCases)
      .set({ decidedAt: new Date(Date.now() - 91 * 86_400_000) })
      .where(eq(verificationCases.id, caseId));

    const purged = await t.app.get(ReviewService).purgeExpiredDocuments(null);
    expect(purged).toBeGreaterThanOrEqual(1);
    const [after] = await t.db.db
      .select()
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, documentId));
    expect(after).toMatchObject({ status: "purged", storageKey: null, wrappedKey: null });
    expect(storage.raw("sensitive", before?.storageKey ?? "")).toBeUndefined();
    await reviewer.post(`/v1/admin/verification/documents/${documentId}/access`).expect(404);
    // The badge outlives the evidence.
    expect((await labelsOf("users", await userIdOf(applicant))).labels[0]?.status).toBe("verified");
  });
});
