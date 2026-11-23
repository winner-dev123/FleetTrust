import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  auditEvents,
  emergencyGuidance,
  emergencyIncidents,
  eq,
  incidentDeliveries,
  quotaConsumptions,
  quotaOverrides,
} from "@fleettrust/db";
import {
  CAPABILITIES,
  type ConversationDto,
  EMERGENCY_DISCLAIMER,
  type EmergencyGuidance,
  FORBIDDEN_EMERGENCY_WORDING,
  type IncidentDto,
  type ProviderAlertDto,
  type TrustedContactDto,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EmergencyDispatcher } from "../src/modules/emergency/index.js";
import { EMAIL_SENDER, type RecordingEmailSender } from "../src/platform/email/index.js";
import { PUSH_SENDER, type RecordingPushSender } from "../src/platform/push/index.js";
import { makePerson, type Person, publishProvider } from "./support/providers.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;
const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };
const SECOND = 1_000;
let push: RecordingPushSender;
let email: RecordingEmailSender;
let dispatcher: EmergencyDispatcher;

beforeAll(async () => {
  t = await createTestApp({ clock });
  push = t.app.get<RecordingPushSender>(PUSH_SENDER);
  email = t.app.get<RecordingEmailSender>(EMAIL_SENDER);
  dispatcher = t.app.get(EmergencyDispatcher);
});

afterAll(async () => {
  await t.close();
});

const reason = (body: unknown) => (body as { reason?: string }).reason;

interface Member extends Person {
  id: string;
  fid: string;
}

/** A user with a display name and (optionally) a registered push device. */
async function person(uid: string, options: { device?: boolean } = {}): Promise<Member> {
  const p = makePerson(t, uid);
  const me = (await p.patch("/v1/me", { displayName: uid }).expect(200)).body as { id: string };
  const fid = `fid-${uid}-000000000000`.slice(0, 60);
  if (options.device ?? true)
    await p.put("/v1/me/devices", { fid, platform: "android" }).expect(204);
  return { ...p, id: me.id, fid };
}

async function trust(owner: Member, contact: Member, priority: "primary" | "backup" = "primary") {
  const invite = (
    await owner.post("/v1/me/trusted-contacts", { userId: contact.id, priority }).expect(201)
  ).body as TrustedContactDto;
  await contact.post(`/v1/me/trusted-contacts/${invite.id}/accept`).expect(200);
  return invite;
}

const raise = (p: Person, extra: object = {}) =>
  p.post("/v1/emergency/incidents", {
    clientIncidentId: randomUUID(),
    category: "breakdown",
    shareLocation: true,
    location: { lng: 28.05, lat: -26.2, accuracyM: 25 },
    note: "Truck stopped on the N3 shoulder",
    ...extra,
  });

const pushesTo = (fid: string) => push.sent.filter((s) => s.fids.includes(fid));
const advance = async (ms: number) => {
  clock.offsetMs += ms;
  await dispatcher.tick();
};

describe("official guidance", () => {
  it("is public, falls back to a generic message, and uses the configured number when there is one", async () => {
    const fallback = (await request(t.server).get("/v1/emergency/guidance").expect(200))
      .body as EmergencyGuidance;
    expect(fallback).toEqual({
      countryCode: null,
      number: null,
      label: "Local emergency services",
      text: "Call your local emergency number.",
      disclaimer: EMERGENCY_DISCLAIMER,
    });
    await t.db.db.insert(emergencyGuidance).values({
      countryCode: "ZA",
      emergencyNumber: "112",
      label: "Emergency services",
      guidance: "Call 112 from any phone.",
    });
    const za = (await request(t.server).get("/v1/emergency/guidance?country=za").expect(200))
      .body as EmergencyGuidance;
    expect(za).toMatchObject({
      countryCode: "ZA",
      number: "112",
      text: "Call 112 from any phone.",
    });
  });
});

describe("trusted contacts need mutual consent", () => {
  it("invite, accept, decline, pause and leave; only active, unpaused contacts are alerted", async () => {
    const owner = await person("tc-owner");
    const friend = await person("tc-friend");
    const decliner = await person("tc-decliner");
    const pending = await person("tc-pending");
    await owner.post("/v1/me/trusted-contacts", { userId: owner.id }).expect(400);
    const invite = (await owner.post("/v1/me/trusted-contacts", { userId: friend.id }).expect(201))
      .body as TrustedContactDto;
    expect(invite).toMatchObject({ status: "pending", role: "my_contact", priority: "primary" });
    expect(
      reason((await owner.post("/v1/me/trusted-contacts", { userId: friend.id }).expect(409)).body),
    ).toBe("already_contact");
    await owner.post(`/v1/me/trusted-contacts/${invite.id}/accept`).expect(404); // only the contact can accept
    const asContact = (await friend.get("/v1/me/trusted-contacts").expect(200))
      .body as TrustedContactDto[];
    expect(asContact[0]).toMatchObject({
      role: "contact_for",
      status: "pending",
      person: { userId: owner.id },
    });
    await friend.post(`/v1/me/trusted-contacts/${invite.id}/accept`).expect(200);
    const d = (await owner.post("/v1/me/trusted-contacts", { userId: decliner.id }).expect(201))
      .body as TrustedContactDto;
    await decliner.post(`/v1/me/trusted-contacts/${d.id}/decline`).expect(200);
    await owner.post("/v1/me/trusted-contacts", { userId: pending.id }).expect(201);

    const incident = (await raise(owner).expect(201)).body as IncidentDto;
    expect(incident.contacts.map((c) => c.userId)).toEqual([friend.id]);
    await owner.post(`/v1/emergency/incidents/${incident.id}/cancel`, {}).expect(200);

    // Paused by the contact: not alerted.
    await friend.post(`/v1/me/trusted-contacts/${invite.id}/mute`, { muted: true }).expect(200);
    const second = (await raise(owner).expect(201)).body as IncidentDto;
    expect(second.contacts).toEqual([]);
    await owner.post(`/v1/emergency/incidents/${second.id}/cancel`, {}).expect(200);

    // Blocks end the link; leaving removes it.
    const blocker = await person("tc-blocker");
    await blocker.put(`/v1/me/blocks/${owner.id}`).expect(204);
    await owner.post("/v1/me/trusted-contacts", { userId: blocker.id }).expect(404);
    await friend.del(`/v1/me/trusted-contacts/${invite.id}`).expect(204);
    expect(
      ((await owner.get("/v1/me/trusted-contacts").expect(200)).body as TrustedContactDto[]).map(
        (c) => c.person.userId,
      ),
    ).not.toContain(friend.id);
  });
});

describe("independent of plans and quotas (ADR-0010)", () => {
  it("works with every quota at zero, and never consumes quota", async () => {
    const owner = await person("q-owner");
    const contact = await person("q-contact");
    await trust(owner, contact);
    for (const key of Object.entries(CAPABILITIES)
      .filter(([, c]) => c.kind === "daily")
      .map(([k]) => k)) {
      await t.db.db.insert(quotaOverrides).values({
        subjectType: "user",
        userId: owner.id,
        key,
        limitValue: 0,
        reason: "test: all quotas exhausted",
        createdBy: owner.id,
      });
    }
    // Ordinary features are blocked...
    const blocked = await owner
      .post("/v1/groups", { name: "Q owner group", kind: "region", locationLabel: "Gauteng" })
      .expect(403);
    expect(reason(blocked.body)).toBe("quota_exceeded");
    // ...emergency isn't.
    const incident = (await raise(owner).expect(201)).body as IncidentDto;
    expect(incident.status).toBe("active");
    expect(pushesTo(contact.fid)).toHaveLength(1);
    const room = (
      await contact.get(`/v1/conversations/${incident.conversationId ?? ""}`).expect(200)
    ).body as ConversationDto;
    await contact
      .post(`/v1/conversations/${room.id}/messages`, {
        clientMessageId: randomUUID(),
        body: "Calling you now",
      })
      .expect(201);
    const consumed = await t.db.db
      .select()
      .from(quotaConsumptions)
      .where(eq(quotaConsumptions.subjectId, owner.id));
    expect(consumed).toEqual([]);
    await owner.post(`/v1/emergency/incidents/${incident.id}/resolve`, {}).expect(200);
  });

  it("the emergency module never imports entitlements", () => {
    const dir = join(import.meta.dirname, "../src/modules/emergency");
    for (const file of readdirSync(dir)) {
      expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(
        /from\s+["'][^"']*entitlements/,
      );
    }
  });
});

describe("raising an incident", () => {
  it("alerts primary contacts at once, is idempotent, shares the location with contacts only, and opens a room", async () => {
    const owner = await person("i1-owner");
    const primary = await person("i1-primary");
    const backup = await person("i1-backup");
    const stranger = await person("i1-stranger");
    await trust(owner, primary, "primary");
    await trust(owner, backup, "backup");
    const body = {
      clientIncidentId: randomUUID(),
      category: "accident",
      shareLocation: true,
      location: { lng: 28.1, lat: -26.1, accuracyM: 10 },
      countryCode: "ZA",
    };
    const incident = (await owner.post("/v1/emergency/incidents", body).expect(201))
      .body as IncidentDto;
    expect(incident).toMatchObject({
      status: "active",
      categoryLabel: "Accident",
      owner: { userId: owner.id, mine: true },
      location: { lng: 28.1, lat: -26.1, accuracyM: 10 },
      wave: 1,
      disclaimer: EMERGENCY_DISCLAIMER,
      guidance: { number: "112" },
    });
    expect(incident.contacts.map((c) => c.userId)).toEqual([primary.id]);
    // The first push went out inline, before the response.
    expect(pushesTo(primary.fid).at(-1)?.message).toMatchObject({
      title: "Emergency alert from i1-owner",
      data: { type: "emergency", incidentId: incident.id },
    });
    expect(pushesTo(backup.fid)).toEqual([]);

    // Repeated taps and retries return the same incident.
    expect(
      ((await owner.post("/v1/emergency/incidents", body).expect(201)).body as IncidentDto).id,
    ).toBe(incident.id);
    expect(((await raise(owner).expect(201)).body as IncidentDto).id).toBe(incident.id);
    expect(pushesTo(primary.fid)).toHaveLength(1);

    const seen = (await primary.get(`/v1/emergency/incidents/${incident.id}`).expect(200))
      .body as IncidentDto;
    expect(seen).toMatchObject({
      owner: { displayName: "i1-owner", mine: false },
      location: { lng: 28.1, lat: -26.1 },
      note: null,
    });
    expect(
      ((await primary.get("/v1/emergency/alerts").expect(200)).body as IncidentDto[]).map(
        (i) => i.id,
      ),
    ).toContain(incident.id);
    await stranger.get(`/v1/emergency/incidents/${incident.id}`).expect(404);
    await backup.get(`/v1/emergency/incidents/${incident.id}`).expect(404); // not alerted yet
    await stranger.get(`/v1/conversations/${incident.conversationId ?? ""}`).expect(404);
    await request(t.server).post("/v1/emergency/incidents").send(body).expect(401);

    // Not sharing the location: nobody sees one, and it isn't stored.
    await owner.post(`/v1/emergency/incidents/${incident.id}/cancel`, {}).expect(200);
    const hidden = (await raise(owner, { shareLocation: false, location: null }).expect(201))
      .body as IncidentDto;
    expect(hidden.location).toBeNull();
    const [row] = await t.db.db
      .select()
      .from(emergencyIncidents)
      .where(eq(emergencyIncidents.id, hidden.id));
    expect(row?.location).toBeNull();
    await owner.post(`/v1/emergency/incidents/${hidden.id}/cancel`, {}).expect(200);
  });

  it("flags repeated alerts for review but never blocks them; the first is never flagged", async () => {
    const owner = await person("s1-owner");
    const contact = await person("s1-contact");
    await trust(owner, contact);
    const flags: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      const incident = (await raise(owner).expect(201)).body as IncidentDto;
      flags.push(incident.flagged);
      await owner.post(`/v1/emergency/incidents/${incident.id}/cancel`, {}).expect(200);
    }
    expect(flags).toEqual([false, false, false, true, true]);
    expect(
      pushesTo(contact.fid).filter((p) => p.message.title.startsWith("Emergency alert")),
    ).toHaveLength(5);
    const audit = await t.db.db.select().from(auditEvents).where(eq(auditEvents.actorId, owner.id));
    expect(audit.filter((a) => a.action === "emergency.soft_limit_flagged")).toHaveLength(2);
  });
});

describe("delivery retries, email fallback and escalation", () => {
  it("retries a failing push with backoff, exactly once per attempt, then emails after the last attempt", async () => {
    const owner = await person("r1-owner");
    const contact = await person("r1-contact");
    await trust(owner, contact);
    push.failNext = 2;
    const incident = (await raise(owner).expect(201)).body as IncidentDto;
    const delivery = async () =>
      (
        await t.db.db
          .select()
          .from(incidentDeliveries)
          .where(eq(incidentDeliveries.incidentId, incident.id))
      ).filter((d) => d.userId === contact.id && d.channel === "push");
    expect((await delivery())[0]).toMatchObject({ status: "pending", attempts: 1 });
    await dispatcher.tick(); // before the backoff: nothing happens
    expect((await delivery())[0]?.attempts).toBe(1);
    await advance(5 * SECOND);
    expect((await delivery())[0]).toMatchObject({ status: "pending", attempts: 2 });
    await advance(15 * SECOND);
    expect((await delivery())[0]).toMatchObject({ status: "sent", attempts: 3 });
    expect(pushesTo(contact.fid)).toHaveLength(1);
    await dispatcher.tick();
    expect(pushesTo(contact.fid)).toHaveLength(1); // no duplicates
    await contact.post(`/v1/emergency/incidents/${incident.id}/acknowledge`).expect(200);
    await owner.post(`/v1/emergency/incidents/${incident.id}/resolve`, {}).expect(200);

    // Push down for good: five attempts, then email.
    const second = await person("r2-contact");
    await trust(owner, second);
    push.failNext = 50;
    const again = (await raise(owner, { contactIds: [second.id] }).expect(201)).body as IncidentDto;
    for (const wait of [5, 15, 45, 135]) await advance(wait * SECOND);
    push.failNext = 0;
    await dispatcher.tick(); // sends the email queued by the last failed attempt
    const rows = await t.db.db
      .select()
      .from(incidentDeliveries)
      .where(eq(incidentDeliveries.incidentId, again.id));
    expect(rows.find((d) => d.channel === "push")).toMatchObject({ status: "failed", attempts: 5 });
    expect(rows.find((d) => d.channel === "email")).toMatchObject({ status: "sent" });
    expect(email.sent.at(-1)).toMatchObject({
      to: "r2-contact@example.test",
      subject: "Emergency alert from r1-owner",
    });
    expect(email.sent.at(-1)?.text).toContain(EMERGENCY_DISCLAIMER);
    await owner.post(`/v1/emergency/incidents/${again.id}/resolve`, {}).expect(200);
  });

  it("emails contacts without devices, and contacts who don't acknowledge in time", async () => {
    const owner = await person("e1-owner");
    const noDevice = await person("e1-nodevice", { device: false });
    const quiet = await person("e1-quiet");
    await trust(owner, noDevice);
    await trust(owner, quiet);
    const before = email.sent.length;
    const incident = (await raise(owner).expect(201)).body as IncidentDto;
    await dispatcher.tick();
    expect(email.sent.slice(before).map((m) => m.to)).toEqual(["e1-nodevice@example.test"]);
    await advance(61 * SECOND);
    expect(email.sent.slice(before).map((m) => m.to)).toEqual([
      "e1-nodevice@example.test",
      "e1-quiet@example.test",
    ]);
    await owner.post(`/v1/emergency/incidents/${incident.id}/resolve`, {}).expect(200);
  });

  it("escalates to backups when nobody acknowledges; an acknowledgement stops it and tells the owner", async () => {
    const owner = await person("x1-owner");
    const primary = await person("x1-primary");
    const backup = await person("x1-backup");
    await trust(owner, primary, "primary");
    await trust(owner, backup, "backup");
    const incident = (await raise(owner).expect(201)).body as IncidentDto;
    await advance(121 * SECOND);
    const escalated = (await owner.get(`/v1/emergency/incidents/${incident.id}`).expect(200))
      .body as IncidentDto;
    expect(escalated.wave).toBe(2);
    expect(escalated.contacts.map((c) => c.userId).sort()).toEqual([primary.id, backup.id].sort());
    expect(pushesTo(backup.fid).at(-1)?.message.title).toBe("Emergency alert from x1-owner");

    await backup.post(`/v1/emergency/incidents/${incident.id}/acknowledge`).expect(200);
    expect(pushesTo(owner.fid).at(-1)?.message).toMatchObject({ title: "Your alert was seen" });
    await advance(121 * SECOND);
    const after = (await owner.get(`/v1/emergency/incidents/${incident.id}`).expect(200))
      .body as IncidentDto;
    expect(after.wave).toBe(2);
    expect(after.contacts.find((c) => c.userId === backup.id)?.acknowledgedAt).not.toBeNull();
    await owner.post(`/v1/emergency/incidents/${incident.id}/resolve`, {}).expect(200);

    // No backups left: the next wave reminds the people already alerted.
    const lone = await person("x2-owner");
    const only = await person("x2-only");
    await trust(lone, only);
    const second = (await raise(lone).expect(201)).body as IncidentDto;
    await advance(121 * SECOND);
    expect(pushesTo(only.fid).at(-1)?.message.title).toBe(
      "Reminder: emergency alert from x2-owner",
    );
    await lone.post(`/v1/emergency/incidents/${second.id}/resolve`, {}).expect(200);
  });
});

describe("closing and expiry", () => {
  it("resolving erases the location, tells contacts and leaves the room read-only for a day", async () => {
    const owner = await person("c1-owner");
    const contact = await person("c1-contact");
    await trust(owner, contact);
    const incident = (await raise(owner).expect(201)).body as IncidentDto;
    const room = incident.conversationId ?? "";
    await contact
      .post(`/v1/conversations/${room}/messages`, {
        clientMessageId: randomUUID(),
        body: "Are you OK?",
      })
      .expect(201);
    const resolved = (
      await owner.post(`/v1/emergency/incidents/${incident.id}/resolve`, {}).expect(200)
    ).body as IncidentDto;
    expect(resolved).toMatchObject({ status: "resolved", location: null });
    const [row] = await t.db.db
      .select()
      .from(emergencyIncidents)
      .where(eq(emergencyIncidents.id, incident.id));
    expect(row?.location).toBeNull();
    expect(pushesTo(contact.fid).at(-1)?.message).toMatchObject({
      title: "c1-owner closed their alert",
      body: "They marked themselves as safe.",
    });
    expect(
      reason(
        (await contact.post(`/v1/emergency/incidents/${incident.id}/acknowledge`).expect(409)).body,
      ),
    ).toBe("incident_closed");
    expect(
      reason(
        (
          await contact
            .post(`/v1/conversations/${room}/messages`, {
              clientMessageId: randomUUID(),
              body: "ok",
            })
            .expect(409)
        ).body,
      ),
    ).toBe("conversation_read_only");
    await contact.get(`/v1/conversations/${room}/messages`).expect(200);
    clock.offsetMs += 25 * 60 * 60 * SECOND;
    await contact.get(`/v1/conversations/${room}/messages`).expect(404);
    clock.offsetMs -= 25 * 60 * 60 * SECOND;
  });

  it("incidents expire on their own and their location is erased", async () => {
    const owner = await person("c2-owner");
    const incident = (await raise(owner).expect(201)).body as IncidentDto;
    await advance(13 * 60 * 60 * SECOND);
    const [row] = await t.db.db
      .select()
      .from(emergencyIncidents)
      .where(eq(emergencyIncidents.id, incident.id));
    expect(row).toMatchObject({ status: "expired", location: null });
    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, incident.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["emergency.incident_created", "emergency.incident_expired"]),
    );
    clock.offsetMs = 0;
    // A new incident can be raised afterwards.
    await raise(owner).expect(201);
  });
});

describe("nearby providers", () => {
  it("only opted-in providers in range are alerted; they see an approximate area, never the person; offers reach the owner", async () => {
    clock.offsetMs = 0;
    const providerOwner = await person("p1-provider");
    const farOwner = await person("p1-far");
    const shyOwner = await person("p1-shy");
    const near = await publishProvider(providerOwner, {
      slug: "p1-garage",
      at: { lng: 29.01, lat: -25.5 },
    });
    const far = await publishProvider(farOwner, {
      slug: "p1-far-garage",
      at: { lng: 30.5, lat: -25.5 },
    });
    await publishProvider(shyOwner, { slug: "p1-shy-garage", at: { lng: 29.02, lat: -25.5 } });
    await providerOwner
      .put(`/v1/orgs/${near.orgId}/emergency-assist`, { optedIn: true, radiusKm: 20 })
      .expect(200);
    await farOwner
      .put(`/v1/orgs/${far.orgId}/emergency-assist`, { optedIn: true, radiusKm: 20 })
      .expect(200);
    const fleetOwner = await person("p1-fleet");
    const fleet = (
      await fleetOwner.post("/v1/orgs", { kind: "fleet", name: "P1 Fleet" }).expect(201)
    ).body as { organization: { id: string } };
    expect(
      reason(
        (
          await fleetOwner
            .put(`/v1/orgs/${fleet.organization.id}/emergency-assist`, { optedIn: true })
            .expect(400)
        ).body,
      ),
    ).toBe("not_a_provider");

    const driver = await person("p1-driver");
    const incident = (
      await raise(driver, {
        location: { lng: 29.0, lat: -25.5, accuracyM: 30 },
        notifyNearbyProviders: true,
      }).expect(201)
    ).body as IncidentDto;
    expect(pushesTo(providerOwner.fid).at(-1)?.message.title).toBe("Nearby emergency alert");
    expect(
      pushesTo(farOwner.fid).filter((p) => p.message.data["incidentId"] === incident.id),
    ).toEqual([]);
    expect(
      pushesTo(shyOwner.fid).filter((p) => p.message.data["incidentId"] === incident.id),
    ).toEqual([]);

    const alerts = (await providerOwner.get(`/v1/orgs/${near.orgId}/emergency-alerts`).expect(200))
      .body as ProviderAlertDto[];
    expect(alerts[0]).toMatchObject({
      incidentId: incident.id,
      status: "active",
      approximateLocation: { lng: 29, lat: -25.5 },
      offered: false,
    });
    expect(JSON.stringify(alerts)).not.toContain(driver.id);
    expect(JSON.stringify(alerts)).not.toContain("p1-driver");
    await providerOwner.get(`/v1/emergency/incidents/${incident.id}`).expect(404);

    await providerOwner
      .post(`/v1/orgs/${near.orgId}/emergency-alerts/${alerts[0]?.recipientId ?? ""}/offer`, {
        message: "Tow truck 10 minutes away",
      })
      .expect(200);
    const view = (await driver.get(`/v1/emergency/incidents/${incident.id}`).expect(200))
      .body as IncidentDto;
    expect(view.providerOffers).toMatchObject([
      {
        organizationId: near.orgId,
        name: "p1 garage",
        phone: "+27 21 555 0100",
        message: "Tow truck 10 minutes away",
      },
    ]);
    expect(pushesTo(driver.fid).at(-1)?.message.title).toBe("A nearby provider offered to help");
    await driver.post(`/v1/emergency/incidents/${incident.id}/resolve`, {}).expect(200);
    const closed = (await providerOwner.get(`/v1/orgs/${near.orgId}/emergency-alerts`).expect(200))
      .body as ProviderAlertDto[];
    expect(closed[0]).toMatchObject({ status: "resolved", approximateLocation: null });
  });
});

describe("safe wording", () => {
  it("no emergency copy promises rescue", () => {
    const sources = [
      ...readdirSync(join(import.meta.dirname, "../src/modules/emergency")).map((f) =>
        join(import.meta.dirname, "../src/modules/emergency", f),
      ),
      join(import.meta.dirname, "../../../packages/types/src/emergency.ts"),
    ];
    for (const file of sources) {
      const text = readFileSync(file, "utf8").replace(
        /export const FORBIDDEN_EMERGENCY_WORDING[\s\S]*?;\n/,
        "",
      );
      expect(text, file).not.toMatch(FORBIDDEN_EMERGENCY_WORDING);
    }
    for (const sent of push.sent) {
      expect(`${sent.message.title} ${sent.message.body}`).not.toMatch(FORBIDDEN_EMERGENCY_WORDING);
    }
    for (const sent of email.sent)
      expect(`${sent.subject} ${sent.text}`).not.toMatch(FORBIDDEN_EMERGENCY_WORDING);
    expect(EMERGENCY_DISCLAIMER).toMatch(/doesn't replace emergency services/);
  });
});
