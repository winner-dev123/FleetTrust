import type pg from "pg";

import type { Api, TestUser } from "./http.ts";

/**
 * Seeds `count` published provider branches. One provider is published through the real API
 * (so every derived row is correct), then cloned in SQL to random points around Johannesburg.
 * Rows are copied with jsonb_populate_record, so the copy stays right when columns change.
 */
export async function seedProviders(
  api: Api,
  db: pg.Client,
  owner: TestUser,
  count: number,
): Promise<string> {
  const token = owner.token;
  const org = (await api.expect("POST", "/v1/orgs", 201, {
    token,
    body: { kind: "provider", name: "Perf Template Garage" },
  })) as { organization: { id: string } };
  const orgId = org.organization.id;
  const base = `/v1/orgs/${orgId}/provider-profile`;
  await api.expect("PATCH", base, 200, {
    token,
    body: {
      slug: "perf-template",
      legalName: "Perf Template Garage Ltd",
      tradingName: "Perf Template Garage",
      categories: ["workshop"],
      categoryDetails: { workshop: { specialities: ["brakes"], bays: 4 } },
      vehicleTypes: ["car", "heavy_truck"],
      contactPhone: "+27 11 555 0100",
    },
  });
  const branch = (await api.expect("POST", `/v1/orgs/${orgId}/branches`, 201, {
    token,
    body: { name: "Main" },
  })) as { id: string };
  await api.expect("PATCH", `${base}/branches/${branch.id}`, 200, {
    token,
    body: {
      addressLine1: "1 Main Road",
      locality: "Johannesburg",
      countryCode: "ZA",
      location: { lng: 28.04, lat: -26.2 },
    },
  });
  await api.expect("POST", `${base}/offerings`, 201, {
    token,
    body: {
      category: "workshop",
      name: "Brake inspection",
      vehicleTypes: ["car", "heavy_truck"],
      price: { type: "from", currency: "ZAR", amount: "450", unit: "job" },
    },
  });
  await api.expect("POST", `${base}/publish`, 200, { token });

  const clones = count - 1;
  await db.query("BEGIN");
  try {
    await db.query(
      `CREATE TEMP TABLE perf_clone ON COMMIT DROP AS
         SELECT g AS n, gen_random_uuid() AS org_id, gen_random_uuid() AS branch_id,
                27.6 + random() AS lng, -26.6 + random() * 0.8 AS lat
         FROM generate_series(1, $1::int) g`,
      [clones],
    );
    const point = (column: string) =>
      `'${column}', 'SRID=4326;POINT(' || c.lng || ' ' || c.lat || ')'`;
    await db.query(
      `INSERT INTO organizations
         SELECT (jsonb_populate_record(NULL::organizations, to_jsonb(o) ||
           jsonb_build_object('id', c.org_id, 'name', 'Perf Garage ' || c.n))).*
         FROM organizations o CROSS JOIN perf_clone c WHERE o.id = $1`,
      [orgId],
    );
    await db.query(
      `INSERT INTO provider_profiles
         SELECT (jsonb_populate_record(NULL::provider_profiles, to_jsonb(p) ||
           jsonb_build_object('organization_id', c.org_id, 'slug', 'perf-garage-' || c.n,
             'trading_name', 'Perf Garage ' || c.n))).*
         FROM provider_profiles p CROSS JOIN perf_clone c WHERE p.organization_id = $1`,
      [orgId],
    );
    await db.query(
      `INSERT INTO branches
         SELECT (jsonb_populate_record(NULL::branches, to_jsonb(b) ||
           jsonb_build_object('id', c.branch_id, 'organization_id', c.org_id, ${point("location")}))).*
         FROM branches b CROSS JOIN perf_clone c WHERE b.id = $1`,
      [branch.id],
    );
    await db.query(
      `INSERT INTO provider_search_entries
         SELECT (jsonb_populate_record(NULL::provider_search_entries, to_jsonb(e) ||
           jsonb_build_object('branch_id', c.branch_id, 'organization_id', c.org_id,
             'slug', 'perf-garage-' || c.n, 'trading_name', 'Perf Garage ' || c.n,
             ${point("location")}, ${point("approx_location")}))).*
         FROM provider_search_entries e CROSS JOIN perf_clone c WHERE e.branch_id = $1`,
      [branch.id],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  await db.query("ANALYZE provider_search_entries");
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM provider_search_entries",
  );
  return rows[0]?.n ?? "0";
}
