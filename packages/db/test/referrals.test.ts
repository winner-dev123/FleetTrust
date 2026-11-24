import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  organizations,
  parts,
  providerProfiles,
  providerReferrals,
  serviceRequestRecipients,
  serviceRequests,
  users,
} from "../src/schema/index.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";
import { pgCode } from "./support/appointment-fixtures.js";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

async function user() {
  const [row] = await t.db
    .insert(users)
    .values({ firebaseUid: `referral-${uuidv7()}` })
    .returning();
  if (!row) throw new Error("no user");
  return row.id;
}

async function provider(owner: string, name: string) {
  const [org] = await t.db
    .insert(organizations)
    .values({ kind: "provider", name, createdBy: owner })
    .returning();
  if (!org) throw new Error("no org");
  await t.db.insert(providerProfiles).values({ organizationId: org.id });
  return org.id;
}

/** A customer request sent to provider A, with a pending referral from A to B. */
async function fixture(relationship: "none" | "referral_fee" = "none") {
  const owner = await user();
  const customer = await user();
  const a = await provider(owner, "Referrer Garage");
  const b = await provider(owner, "Receiver Garage");
  const [request] = await t.db
    .insert(serviceRequests)
    .values({
      requesterUserId: customer,
      createdBy: customer,
      clientRequestId: uuidv7(),
      category: "workshop",
      vehicleType: "car",
      location: { lng: 18.42, lat: -33.92 },
      description: "Gearbox noise when changing gears",
      urgency: "routine",
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  if (!request) throw new Error("no request");
  const [recipient] = await t.db
    .insert(serviceRequestRecipients)
    .values({ requestId: request.id, organizationId: a })
    .returning();
  if (!recipient) throw new Error("no recipient");
  const [referral] = await t.db
    .insert(providerReferrals)
    .values({
      requestId: request.id,
      fromOrganizationId: a,
      fromRecipientId: recipient.id,
      toOrganizationId: b,
      createdBy: owner,
      message: "They specialise in gearboxes.",
      relationship,
      relationshipDetails: relationship === "none" ? null : "10% of the invoice",
    })
    .returning();
  if (!referral) throw new Error("no referral");
  return { owner, customer, a, b, request, recipient, referral };
}

const failure = (promise: PromiseLike<unknown>) =>
  Promise.resolve(promise).then(
    () => null,
    (error: unknown) => error,
  );

describe("provider_referrals audit guard (ADR-0028)", () => {
  it("never lets the disclosure change after creation", async () => {
    const f = await fixture("referral_fee");
    for (const change of [
      { message: "Different reason entirely." },
      { relationship: "none" as const, relationshipDetails: null },
      { relationshipDetails: "5% of the invoice" },
      { toOrganizationId: f.a },
    ]) {
      const error = await failure(
        t.db.update(providerReferrals).set(change).where(eq(providerReferrals.id, f.referral.id)),
      );
      expect(pgCode(error)).toBe("23514");
    }
  });

  it("makes a decision final, and keeps the row", async () => {
    const f = await fixture();
    await t.db
      .update(providerReferrals)
      .set({
        status: "declined",
        decidedAt: new Date(),
        decidedBy: f.customer,
      })
      .where(eq(providerReferrals.id, f.referral.id));
    const reopen = await failure(
      t.db
        .update(providerReferrals)
        .set({ status: "pending_consent", decidedAt: null })
        .where(eq(providerReferrals.id, f.referral.id)),
    );
    expect(pgCode(reopen)).toBe("23514");
    const remove = await failure(
      t.db.delete(providerReferrals).where(eq(providerReferrals.id, f.referral.id)),
    );
    expect(pgCode(remove)).toBe("23514");
    // Deleting the whole request (account deletion) still cascades.
    await t.db.delete(serviceRequests).where(eq(serviceRequests.id, f.request.id));
    const left = await t.db
      .select()
      .from(providerReferrals)
      .where(eq(providerReferrals.id, f.referral.id));
    expect(left).toEqual([]);
  });

  it("requires a described relationship and a recorded consent", async () => {
    const f = await fixture();
    const undisclosed = await failure(
      t.db.insert(providerReferrals).values({
        requestId: f.request.id,
        fromOrganizationId: f.a,
        fromRecipientId: f.recipient.id,
        toOrganizationId: f.b,
        createdBy: f.owner,
        message: "They are good with gearboxes.",
        relationship: "referral_fee",
        relationshipDetails: null,
        status: "withdrawn",
        decidedAt: new Date(),
      }),
    );
    expect(pgCode(undisclosed)).toBe("23514");
    const self = await failure(
      t.db.insert(providerReferrals).values({
        requestId: f.request.id,
        fromOrganizationId: f.a,
        fromRecipientId: f.recipient.id,
        toOrganizationId: f.a,
        createdBy: f.owner,
        message: "Referring to ourselves.",
        relationship: "none",
      }),
    );
    expect(pgCode(self)).toBe("23514");
    // Consent without the consent text it was given against.
    const silent = await failure(
      t.db
        .update(providerReferrals)
        .set({ status: "consented", decidedAt: new Date() })
        .where(eq(providerReferrals.id, f.referral.id)),
    );
    expect(pgCode(silent)).toBe("23514");
    // A second open referral to the same provider for the same request.
    const duplicate = await failure(
      t.db.insert(providerReferrals).values({
        requestId: f.request.id,
        fromOrganizationId: f.a,
        fromRecipientId: f.recipient.id,
        toOrganizationId: f.b,
        createdBy: f.owner,
        message: "Again, the gearbox people.",
        relationship: "none",
      }),
    );
    expect(pgCode(duplicate)).toBe("23505");
  });
});

describe("parts constraints (ADR-0028)", () => {
  it("keeps prices indicative-shaped and quantities only on stocked parts", async () => {
    const owner = await user();
    const org = await provider(owner, "Parts Counter");
    const base = {
      organizationId: org,
      name: "Brake pads",
      category: "brakes" as const,
      condition: "new" as const,
      priceType: "fixed" as const,
      currency: "ZAR",
      priceAmount: "450",
      priceUnit: "item",
    };
    await t.db.insert(parts).values({ ...base, stockStatus: "in_stock", stockQuantity: 4 });
    const quantityOut = await failure(
      t.db.insert(parts).values({ ...base, stockStatus: "out_of_stock", stockQuantity: 3 }),
    );
    expect(pgCode(quantityOut)).toBe("23514");
    const noCurrency = await failure(
      t.db.insert(parts).values({ ...base, currency: null, stockStatus: "in_stock" }),
    );
    expect(pgCode(noCurrency)).toBe("23514");
    const badNumber = await failure(
      t.db.insert(parts).values({
        ...base,
        stockStatus: "in_stock",
        partNumber: "0 986-494",
        partNumberNormalized: "0 986-494",
      }),
    );
    expect(pgCode(badNumber)).toBe("23514");
  });
});
