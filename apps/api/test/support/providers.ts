import type { BranchDto, MyOrganization } from "@fleettrust/types";
import request from "supertest";

import type { TestApp } from "./test-app.js";

/** A signed-in test user with request helpers. */
export function makePerson(t: TestApp, uid: string) {
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
    put: (path: string, body?: object) =>
      request(t.server)
        .put(path)
        .set(auth())
        .send(body ?? {}),
    del: (path: string) => request(t.server).delete(path).set(auth()),
  };
}
export type Person = ReturnType<typeof makePerson>;

const DETAILS: Record<string, object> = {
  workshop: { specialities: ["brakes"], bays: 2 },
  towing: { maxTowWeightKg: 20_000, recoveryTypes: ["heavy"], operates24h: true },
  fuel_station: { fuelTypes: ["diesel"], heavyVehicleAccess: true },
};

/** Creates a provider through the wizard API and publishes it. */
export async function publishProvider(
  owner: Person,
  spec: { slug: string; at: { lng: number; lat: number }; categories?: string[] },
) {
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
      categories,
      categoryDetails: Object.fromEntries(categories.map((c) => [c, DETAILS[c]])),
      vehicleTypes: ["heavy_truck"],
      contactPhone: "+27 21 555 0100",
    })
    .expect(200);
  const branchId = (
    (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "Main" }).expect(201)).body as BranchDto
  ).id;
  await owner
    .patch(`${base}/branches/${branchId}`, {
      addressLine1: "1 Main Road",
      locality: "Testville",
      countryCode: "ZA",
      location: spec.at,
      ...(categories.includes("towing") ? { serviceRadiusKm: 50 } : {}),
    })
    .expect(200);
  await owner.post(`${base}/publish`).expect(200);
  return { orgId, base, branchId };
}
