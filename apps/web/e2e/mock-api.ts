/**
 * Contract-checked mock of the FleetTrust API for the web end-to-end tests (ADR-0031).
 *
 * - Every response is validated against the shared @fleettrust/types schema before it's sent.
 *   A mismatch answers 500 and is recorded; the tests fail if any were recorded
 *   (`GET /__mock/contract-errors`), so the mock can't drift from the real API contract.
 * - Identity comes from the Firebase Auth emulator: the bearer token is an emulator ID token,
 *   whose payload is read without verification (emulator tokens are unsigned).
 * - State is in memory and per user, so tests that sign in with different emails don't interact.
 *
 * Run: `node e2e/mock-api.ts` (Node strips the TypeScript types). Port: MOCK_API_PORT or 8787.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  articleCommentSchema,
  articlePageSchema,
  branchHoursSchema,
  branchSchema,
  commentListSchema,
  COMMUNITY_CONTENT_LABEL,
  conversationSchema,
  EMERGENCY_DISCLAIMER,
  emergencyGuidanceSchema,
  entitlementsResponseSchema,
  fleetDashboardSchema,
  geocodeResultSchema,
  groupSchema,
  inboxSchema,
  incidentSchema,
  INCIDENT_CATEGORY_LABELS,
  INDICATIVE_PRICE_DISCLAIMER,
  invitationSchema,
  JOB_SCAM_WARNING,
  mapConfigSchema,
  meResponseSchema,
  memberSchema,
  messagePageSchema,
  moderationAppealSchema,
  myOrganizationSchema,
  myPowerUserSchema,
  offeringSchema,
  PAYMENT_DISCLAIMER,
  PERMISSIONS,
  POWER_USER_MEANING,
  POWER_USER_RULES,
  personSchema,
  providerProfileSchema,
  providerSearchPageSchema,
  publicArticleSchema,
  publicJobListSchema,
  publicJobSchema,
  publicProviderProfileSchema,
  QUOTE_SCAM_WARNING,
  sanctionSchema,
  serviceRequestSchema,
  SPENDING_DISCLAIMER,
  trustedContactSchema,
  UNVERIFIED_EMPLOYER_NOTICE,
  vehicleSchema,
  verificationCaseSchema,
  type IncidentDto,
  type MyOrganization,
  type OfferingDto,
  type ProviderProfileDto,
  type ProviderSearchResult,
  type PublicProviderProfile,
  type ServiceRequestDto,
  type TrustedContactDto,
  type VehicleDto,
  adminMeSchema,
  CONSENT_PURPOSES,
  consentStateSchema,
  CURRENT_CONSENT_VERSIONS,
  dataExportSchema,
  REQUIRED_CONSENTS,
  type AuditEntryDto,
  auditPageSchema,
  defaultServiceCategory,
  FEATURE_SETTINGS,
  FEATURE_SETTING_KEYS,
  featureSettingSchema,
  platformStaffMemberSchema,
  publicConfigSchema,
  serviceCategorySchema,
  STAFF_ROLES,
  type StaffRole,
} from "@fleettrust/types";
import { z } from "zod";

const PORT = Number(process.env["MOCK_API_PORT"] ?? 8787);
const NOW = "2026-11-24T10:00:00.000Z";
const contractErrors: string[] = [];
let idCounter = 0x100;

/** RFC 4122-shaped IDs that zod's z.uuid() accepts. */
function newId(): string {
  idCounter += 1;
  return `0190a000-0000-7000-8000-${idCounter.toString(16).padStart(12, "0")}`;
}

// --- Static public data ----------------------------------------------------------------------

const ACME = {
  org: "0190a000-0000-7000-8000-00000000a001",
  branch: "0190a000-0000-7000-8000-00000000a002",
};
const TOW = {
  org: "0190a000-0000-7000-8000-00000000b001",
  branch: "0190a000-0000-7000-8000-00000000b002",
};
const ARTICLE_ID = "0190a000-0000-7000-8000-00000000c001";
const JOB_ID = "0190a000-0000-7000-8000-00000000d001";
const CONTACT_USER = "0190a000-0000-7000-8000-00000000e002";
const CAPE_TOWN = { lat: -33.9249, lng: 18.4241 };

const weekday = [{ opens: "08:00", closes: "17:00" }];
const openStatus = {
  known: true,
  isOpen: true,
  localTime: "2026-11-24T10:00",
  closesAt: "2026-11-24T17:00",
  opensAt: null,
  exception: null,
};

function acmeProfile(signedIn: boolean): PublicProviderProfile {
  return {
    organizationId: ACME.org,
    slug: "acme-garage",
    tradingName: "Acme Garage",
    legalName: "Acme Garage (Pty) Ltd",
    description: "Family workshop since 1998. Brakes, suspension and servicing for cars and vans.",
    categories: ["workshop"],
    categoryDetails: {},
    vehicleTypes: ["car", "van"],
    contact: signedIn
      ? { phone: "+27 21 555 0100", email: "hello@acme.example", website: "https://acme.example" }
      : null,
    branches: [
      {
        id: ACME.branch,
        name: "Woodstock",
        addressLine1: signedIn ? "12 Main Road" : null,
        addressLine2: null,
        locality: "Woodstock",
        region: "Western Cape",
        postalCode: null,
        countryCode: "ZA",
        location: { lng: 18.447, lat: -33.927, approximate: !signedIn },
        serviceRadiusKm: 15,
        phone: signedIn ? "+27 21 555 0100" : null,
        timeZone: "Africa/Johannesburg",
        hours: {
          weekly: {
            mon: weekday,
            tue: weekday,
            wed: weekday,
            thu: weekday,
            fri: weekday,
            sat: [],
            sun: [],
          },
          exceptions: [],
          status: openStatus,
        },
      },
    ],
    catalog: {
      disclaimer: INDICATIVE_PRICE_DISCLAIMER,
      offerings: [
        {
          id: "0190a000-0000-7000-8000-00000000a010",
          category: "workshop",
          name: "Brake pad replacement",
          description: "Front axle, pads only",
          vehicleTypes: ["car"],
          serviceLocation: "at_premises",
          branchIds: [],
          price: {
            type: "from",
            currency: "ZAR",
            amount: "850",
            unit: "job",
            indicative: true,
            label: "From ZAR 850.00 per job",
          },
        },
      ],
    },
    media: [],
    verification: [
      { badgeType: "business", status: "verified", expiresAt: "2027-06-30T00:00:00.000Z" },
      { badgeType: "location", status: "unverified", expiresAt: null },
    ],
    publishedAt: "2026-10-01T08:00:00.000Z",
  };
}

function searchResults(signedIn: boolean): ProviderSearchResult[] {
  const base = {
    countryCode: "ZA",
    vehicleTypes: ["car" as const, "van" as const],
    serviceRadiusKm: 15,
    coversSearchLocation: true,
    hours: openStatus,
    logoUrl: null,
  };
  return [
    {
      ...base,
      branchId: ACME.branch,
      organizationId: ACME.org,
      slug: "acme-garage",
      tradingName: "Acme Garage",
      branchName: "Woodstock",
      locality: "Woodstock",
      categories: ["workshop"],
      location: { lng: 18.447, lat: -33.927, approximate: !signedIn },
      distanceKm: 2.3,
      verification: [
        { badgeType: "business", status: "verified" },
        { badgeType: "location", status: "unverified" },
      ],
      priceHighlights: [{ name: "Brake pad replacement", label: "From ZAR 850.00 per job" }],
    },
    {
      ...base,
      branchId: TOW.branch,
      organizationId: TOW.org,
      slug: "cape-tow",
      tradingName: "Cape Tow",
      branchName: "Salt River",
      locality: "Salt River",
      categories: ["towing"],
      location: { lng: 18.466, lat: -33.931, approximate: !signedIn },
      distanceKm: 4.1,
      coversSearchLocation: false,
      verification: [
        { badgeType: "business", status: "unverified" },
        { badgeType: "location", status: "unverified" },
      ],
      priceHighlights: [],
    },
  ];
}

const article = {
  id: ARTICLE_ID,
  slug: "checking-tyre-pressure",
  title: "Checking tyre pressure before a long trip",
  summary: "Five minutes that save fuel and tyres.",
  excerpt: "Check your tyres when they are cold...",
  category: "maintenance" as const,
  tags: ["tyres"],
  coverImage: null,
  author: { displayName: "Thandi M", organization: null },
  publishedAt: "2026-11-01T09:00:00.000Z",
  editedAt: null,
  commentCount: 1,
  label: COMMUNITY_CONTENT_LABEL,
};

const job = {
  id: JOB_ID,
  title: "Long-distance truck driver (Code 14)",
  description:
    "Cross-border routes between Cape Town and Windhoek. Valid PrDP required. Two weeks on, one week off.",
  role: "driver" as const,
  employmentType: "full_time" as const,
  licenceClasses: ["EC"],
  locality: "Cape Town",
  countryCode: "ZA",
  salary: {
    currency: "ZAR",
    min: "18000",
    max: "24000",
    period: "month" as const,
    label: "ZAR 18000–24000 per month (advertised)",
  },
  closesOn: "2026-12-31",
  publishedAt: "2026-11-10T08:00:00.000Z",
  employer: {
    organizationId: "0190a000-0000-7000-8000-00000000d002",
    name: "Road Fleet",
    verified: false,
  },
  scamWarning: JOB_SCAM_WARNING,
  employerNotice: UNVERIFIED_EMPLOYER_NOTICE,
};

const guidance: IncidentDto["guidance"] = {
  countryCode: null,
  number: null,
  label: "If anyone is in danger",
  text: "Call your local emergency number.",
  disclaimer: EMERGENCY_DISCLAIMER,
};

// --- Per-user state --------------------------------------------------------------------------

interface UserState {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  organizations: MyOrganization[];
  profiles: Map<string, ProviderProfileDto>;
  offerings: Map<string, OfferingDto[]>;
  requests: ServiceRequestDto[];
  incidents: IncidentDto[];
  contacts: TrustedContactDto[];
  vehicles: VehicleDto[];
  consents: {
    purpose: (typeof CONSENT_PURPOSES)[number];
    version: string;
    granted: boolean;
    recordedAt: string;
  }[];
}

const users = new Map<string, UserState>();

function userFor(req: IncomingMessage): UserState | null {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = token.split(".")[1];
  if (!payload) return null;
  const claims = z
    .object({ user_id: z.string(), email: z.string().optional() })
    .safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (!claims.success) return null;
  const existing = users.get(claims.data.user_id);
  if (existing) return existing;
  const state: UserState = {
    id: newId(),
    email: claims.data.email ?? null,
    displayName: null,
    createdAt: "2026-01-15T08:00:00.000Z",
    organizations: [],
    profiles: new Map(),
    offerings: new Map(),
    requests: [],
    incidents: [],
    contacts: [
      {
        id: newId(),
        person: { userId: CONTACT_USER, displayName: "Sam Driver" },
        role: "my_contact",
        status: "active",
        priority: "primary",
        muted: false,
        createdAt: NOW,
      },
    ],
    vehicles: [],
    // Test users have accepted the current terms, except "fresh-…" accounts (consent journey).
    consents: (claims.data.email ?? "").startsWith("fresh-")
      ? []
      : REQUIRED_CONSENTS.map((purpose) => ({
          purpose,
          version: CURRENT_CONSENT_VERSIONS[purpose],
          granted: true,
          recordedAt: NOW,
        })),
  };
  users.set(claims.data.user_id, state);
  return state;
}

function me(user: UserState) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: true,
    displayName: user.displayName,
    profileComplete: user.displayName !== null,
    timeZone: "Africa/Johannesburg",
    createdAt: user.createdAt,
  };
}

function entitlements(subject: { type: "user" | "organization"; id: string }) {
  return {
    subject,
    plan: {
      code: subject.type === "user" ? "personal-free" : "business-free",
      name: subject.type === "user" ? "Personal (free)" : "Business (free)",
      version: 1,
      source: "default" as const,
      activatedAt: null,
      endsAt: null,
    },
    timeZone: "Africa/Johannesburg",
    period: "2026-11-24",
    entitlements: [
      {
        key: "service_requests.daily" as const,
        kind: "daily" as const,
        limit: 3,
        used: 0,
        source: "plan" as const,
        graceUntil: null,
        overLimit: false,
      },
      {
        key: "articles.daily" as const,
        kind: "daily" as const,
        limit: 2,
        used: 0,
        source: "plan" as const,
        graceUntil: null,
        overLimit: false,
      },
    ],
  };
}

function profileSteps(profile: ProviderProfileDto, offerings: number) {
  const done: Record<string, boolean> = {
    basics: Boolean(profile.tradingName && profile.legalName && profile.slug),
    categories: profile.categories.length > 0,
    vehicles: profile.vehicleTypes.length > 0,
    contact: Boolean(profile.contactPhone ?? profile.contactEmail),
    branches: true,
    catalog: offerings > 0,
    hours: true,
    media: true,
  };
  const steps = Object.entries(done).map(([id, complete]) => ({
    id: id as ProviderProfileDto["steps"][number]["id"],
    complete,
    issues: complete ? [] : [{ path: id, message: `Complete the ${id} step` }],
  }));
  return { steps, canPublish: steps.every((step) => step.complete) };
}

function newIncident(user: UserState, body: Record<string, unknown>): IncidentDto {
  const parsed = z
    .object({
      category: z.enum(["breakdown", "accident", "medical", "security", "stranded", "other"]),
      note: z.string().nullable().optional(),
      location: z
        .object({ lat: z.number(), lng: z.number(), accuracyM: z.number().nullable().optional() })
        .nullable()
        .optional(),
    })
    .parse(body);
  return {
    id: newId(),
    status: "active",
    category: parsed.category,
    categoryLabel: INCIDENT_CATEGORY_LABELS[parsed.category],
    note: parsed.note ?? null,
    owner: { userId: user.id, displayName: user.displayName ?? "You", mine: true },
    location: parsed.location
      ? {
          lat: parsed.location.lat,
          lng: parsed.location.lng,
          accuracyM: parsed.location.accuracyM ?? null,
        }
      : null,
    locationUpdatedAt: parsed.location ? NOW : null,
    wave: 1,
    contacts: user.contacts
      .filter((c) => c.role === "my_contact" && c.status === "active")
      .map((c) => ({
        userId: c.person.userId,
        displayName: c.person.displayName,
        notifiedAt: NOW,
        acknowledgedAt: null,
      })),
    providerOffers: [],
    conversationId: null,
    flagged: false,
    createdAt: NOW,
    expiresAt: "2026-11-24T22:00:00.000Z",
    closedAt: null,
    guidance,
    disclaimer: EMERGENCY_DISCLAIMER,
  };
}

function newRequest(user: UserState, body: Record<string, unknown>): ServiceRequestDto {
  const parsed = z
    .object({
      category: z.enum([
        "workshop",
        "fuel_station",
        "towing",
        "tyres",
        "parts",
        "parking",
        "mobile_mechanic",
      ]),
      description: z.string(),
      urgency: z.enum(["routine", "soon", "urgent"]).optional(),
      location: z.object({ lat: z.number(), lng: z.number() }),
      vehicle: z.object({
        vehicleType: z.enum([
          "car",
          "van",
          "light_truck",
          "heavy_truck",
          "trailer",
          "bus",
          "motorcycle",
          "agricultural",
        ]),
        make: z.string().nullable().optional(),
        model: z.string().nullable().optional(),
        registration: z.string().nullable().optional(),
      }),
    })
    .parse(body);
  const requestId = newId();
  const recipientId = newId();
  return {
    id: requestId,
    category: parsed.category,
    vehicle: {
      vehicleType: parsed.vehicle.vehicleType,
      make: parsed.vehicle.make ?? null,
      model: parsed.vehicle.model ?? null,
      year: null,
      registration: parsed.vehicle.registration?.toUpperCase() ?? null,
    },
    description: parsed.description,
    urgency: parsed.urgency ?? "routine",
    neededBy: null,
    status: "open",
    expiresAt: "2026-12-08T10:00:00.000Z",
    createdAt: NOW,
    attachments: [],
    events: [],
    requester: { kind: "user", organizationId: null, createdBy: user.id, fleetBranchId: null },
    location: parsed.location,
    locationNote: null,
    vehicleId: null,
    // The provider has already answered, so the journey can accept a quote.
    recipients: [
      {
        id: recipientId,
        providerOrganizationId: ACME.org,
        providerName: "Acme Garage",
        providerSlug: "acme-garage",
        status: "quoted",
        quotes: [
          {
            id: newId(),
            recipientId,
            providerOrganizationId: ACME.org,
            price: {
              type: "fixed",
              currency: "ZAR",
              amount: "950",
              unit: "job",
              indicative: true,
              label: "ZAR 950.00 per job",
            },
            message: "We can fit you in tomorrow morning.",
            availableFrom: "2026-11-25T08:00:00.000Z",
            validUntil: "2026-12-01T10:00:00.000Z",
            status: "active",
            createdAt: NOW,
            disclaimer: PAYMENT_DISCLAIMER,
            scamWarning: QUOTE_SCAM_WARNING,
          },
        ],
      },
    ],
    acceptedQuoteId: null,
    agreement: null,
  };
}

// --- HTTP ------------------------------------------------------------------------------------

type Handler = (ctx: {
  req: IncomingMessage;
  user: UserState | null;
  params: string[];
  query: URLSearchParams;
  body: Record<string, unknown>;
}) => { status?: number; schema?: z.ZodType; body?: unknown };

const routes: { method: string; pattern: RegExp; auth: boolean; handle: Handler }[] = [];
const route = (method: string, path: string, auth: boolean, handle: Handler) => {
  const pattern = new RegExp(`^${path.replace(/:\w+/g, "([^/]+)")}$`);
  routes.push({ method, pattern, auth, handle });
};
const text = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);
const notFound = { status: 404, body: { statusCode: 404, message: "Not Found" } };
const org = (user: UserState, id: string) =>
  user.organizations.find((m) => m.organization.id === id);

// Public
route("GET", "/v1/geo/map-config", false, () => ({
  schema: mapConfigSchema,
  body: { provider: "stub", tileUrl: null, attribution: null },
}));
route("GET", "/v1/geo/geocode", false, ({ query }) => ({
  schema: z.array(geocodeResultSchema),
  body: /cape/i.test(query.get("q") ?? "")
    ? [
        { label: "Cape Town, Western Cape", location: CAPE_TOWN, countryCode: "ZA" },
        {
          label: "Cape St Francis, Eastern Cape",
          location: { lat: -34.2, lng: 24.83 },
          countryCode: "ZA",
        },
      ]
    : [],
}));
for (const full of [false, true]) {
  route("GET", `/v1/search/providers${full ? "/full" : ""}`, full, ({ query }) => {
    const category = query.get("category");
    const results = searchResults(full).filter(
      (r) => !category || r.categories.some((c) => c === category),
    );
    return {
      schema: providerSearchPageSchema,
      body: {
        results,
        nextCursor: null,
        ranking: "relevance",
        priceDisclaimer: INDICATIVE_PRICE_DISCLAIMER,
      },
    };
  });
  route("GET", `/v1/providers/:slug${full ? "/full" : ""}`, full, ({ params }) =>
    params[0] === "acme-garage"
      ? { schema: publicProviderProfileSchema, body: acmeProfile(full) }
      : notFound,
  );
}
route("GET", "/v1/articles", false, () => ({
  schema: articlePageSchema,
  body: { items: [article], nextCursor: null, label: COMMUNITY_CONTENT_LABEL },
}));
route("GET", "/v1/articles/:slug", false, ({ params }) =>
  params[0] === article.slug
    ? {
        schema: publicArticleSchema,
        body: {
          ...article,
          body: { type: "doc", content: [] },
          html: "<p>Check your tyres when they are cold, using the pressure on the door sticker.</p>",
          commentsEnabled: true,
        },
      }
    : notFound,
);
route("GET", "/v1/articles/:slug/comments", false, () => ({
  schema: commentListSchema,
  body: {
    items: [
      {
        id: newId(),
        articleId: ARTICLE_ID,
        parentId: null,
        body: "Good tip, thanks.",
        status: "visible",
        author: { displayName: "Lee" },
        createdAt: "2026-11-02T09:00:00.000Z",
        editedAt: null,
      },
    ],
    label: COMMUNITY_CONTENT_LABEL,
  },
}));
route("POST", "/v1/articles/:id/comments", true, ({ params, body }) => ({
  status: 201,
  schema: articleCommentSchema,
  body: {
    id: newId(),
    articleId: params[0],
    parentId: null,
    body: text(body["body"], ""),
    status: "visible",
    author: { displayName: "You" },
    createdAt: NOW,
    editedAt: null,
  },
}));
route("GET", "/v1/jobs", false, () => ({
  schema: publicJobListSchema,
  body: { items: [job], nextOffset: null },
}));
route("GET", "/v1/jobs/:id", false, ({ params }) =>
  params[0] === JOB_ID ? { schema: publicJobSchema, body: job } : notFound,
);
route("GET", "/v1/emergency/guidance", false, () => ({
  schema: emergencyGuidanceSchema,
  body: guidance,
}));

// Signed in: account
route("GET", "/v1/me", true, ({ user }) => ({ schema: meResponseSchema, body: user && me(user) }));
route("PATCH", "/v1/me", true, ({ user, body }) => {
  if (user && "displayName" in body)
    user.displayName = (body["displayName"] as string | null) ?? null;
  return { schema: meResponseSchema, body: user && me(user) };
});
route("GET", "/v1/orgs", true, ({ user }) => ({
  schema: z.array(myOrganizationSchema),
  body: user?.organizations ?? [],
}));
route("POST", "/v1/orgs", true, ({ user, body }) => {
  if (!user) return notFound;
  const kind = body["kind"] === "fleet" ? "fleet" : "provider";
  const created: MyOrganization = {
    organization: {
      id: newId(),
      kind,
      name: text(body["name"], "Business"),
      status: "active",
      timeZone: "Africa/Johannesburg",
      createdAt: NOW,
    },
    membershipId: newId(),
    role: "owner",
    branchId: null,
    permissions: [...PERMISSIONS],
  };
  user.organizations.push(created);
  return { status: 201, schema: myOrganizationSchema, body: created };
});
route("GET", "/v1/trust-safety/dashboard", true, () => notFound);

// --- Privacy (Prompt 27) --------------------------------------------------------------------

function consentStates(user: UserState) {
  return CONSENT_PURPOSES.map((purpose) => {
    const latest = user.consents.filter((c) => c.purpose === purpose).at(-1);
    const required = REQUIRED_CONSENTS.includes(purpose);
    const currentVersion = CURRENT_CONSENT_VERSIONS[purpose];
    return {
      purpose,
      required,
      currentVersion,
      granted: latest?.granted ?? null,
      version: latest?.version ?? null,
      recordedAt: latest?.recordedAt ?? null,
      needsAnswer: required && !(latest?.granted === true && latest.version === currentVersion),
    };
  });
}

route("GET", "/v1/me/consents", true, ({ user }) =>
  user ? { schema: z.array(consentStateSchema), body: consentStates(user) } : notFound,
);
route("POST", "/v1/me/consents", true, ({ user, body }) => {
  if (!user) return notFound;
  const purpose = CONSENT_PURPOSES.find((p) => p === body["purpose"]);
  if (!purpose) return { status: 400, body: { statusCode: 400 } };
  if (body["version"] !== CURRENT_CONSENT_VERSIONS[purpose]) {
    return { status: 409, body: { statusCode: 409, reason: "stale_consent_version" } };
  }
  if (body["granted"] !== true && REQUIRED_CONSENTS.includes(purpose)) {
    return { status: 409, body: { statusCode: 409, reason: "required_consent" } };
  }
  user.consents.push({
    purpose,
    version: CURRENT_CONSENT_VERSIONS[purpose],
    granted: body["granted"] === true,
    recordedAt: new Date().toISOString(),
  });
  return { schema: z.array(consentStateSchema), body: consentStates(user) };
});
route("GET", "/v1/me/export", true, ({ user }) => {
  if (!user) return notFound;
  return {
    schema: dataExportSchema,
    body: {
      format: "fleettrust-export-v1",
      generatedAt: new Date().toISOString(),
      userId: user.id,
      sections: {
        profile: me(user),
        consents: user.consents,
        vehicles: user.vehicles,
        serviceRequests: user.requests,
      },
    },
  };
});
route("DELETE", "/v1/me", true, ({ user, req }) => {
  if (!user) return notFound;
  if (req.headers["x-confirm-action"] !== "account.delete") {
    return { status: 428, body: { statusCode: 428, reason: "confirmation_required" } };
  }
  for (const [uid, state] of users) if (state === user) users.delete(uid);
  return { status: 204 };
});

// --- Admin console (Prompt 26) --------------------------------------------------------------
// Test staff are picked by email: "admin-…" is a super admin whose sign-in used two-step
// verification; "nomfa-…" is a super admin who hasn't set it up yet.

interface StaffGrant {
  userId: string;
  email: string;
  role: StaffRole;
  since: string;
}
const staffGrants: StaffGrant[] = [];
const featureValues = new Map<string, unknown>();
const auditLog: AuditEntryDto[] = [];

function staffRolesOf(user: UserState | null): StaffRole[] {
  if (!user?.email) return [];
  const roles = new Set<StaffRole>(
    staffGrants.filter((g) => g.userId === user.id).map((g) => g.role),
  );
  if (user.email.startsWith("admin-") || user.email.startsWith("nomfa-")) roles.add("super_admin");
  return [...roles];
}

const mfaSatisfied = (user: UserState | null) => !(user?.email ?? "").startsWith("nomfa-");
const mfaRequired = {
  status: 403,
  body: { statusCode: 403, error: "forbidden", reason: "mfa_required" },
};

/** Staff route: 404 for non-staff, 403 mfa_required without two-step sign-in. */
function staffOnly(user: UserState | null, role: StaffRole) {
  if (!staffRolesOf(user).includes(role)) return notFound;
  if (!mfaSatisfied(user)) return mfaRequired;
  return null;
}

function audit(
  user: UserState,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  auditLog.unshift({
    id: newId(),
    occurredAt: new Date().toISOString(),
    actorType: "user",
    actor: { id: user.id, email: user.email, displayName: user.displayName },
    action,
    targetType,
    targetId,
    organizationId: null,
    requestId: null,
    metadata,
  });
}

function staffList() {
  const byUser = new Map<
    string,
    {
      userId: string;
      email: string;
      displayName: null;
      roles: { role: StaffRole; since: string }[];
    }
  >();
  for (const grant of staffGrants) {
    const entry = byUser.get(grant.userId) ?? {
      userId: grant.userId,
      email: grant.email,
      displayName: null,
      roles: [],
    };
    entry.roles.push({ role: grant.role, since: grant.since });
    byUser.set(grant.userId, entry);
  }
  return [...byUser.values()];
}

function featureList() {
  return FEATURE_SETTING_KEYS.map((key) => {
    const definition = FEATURE_SETTINGS[key];
    return {
      key,
      label: definition.label,
      description: definition.description,
      value: featureValues.has(key) ? featureValues.get(key) : definition.defaultValue,
      defaultValue: definition.defaultValue,
      public: definition.public,
      updatedAt: null,
      updatedBy: null,
    };
  });
}

const confirmed = (req: IncomingMessage, action: string) =>
  req.headers["x-confirm-action"] === action;
const confirmationRequired = {
  status: 428,
  body: { statusCode: 428, error: "precondition_required", reason: "confirmation_required" },
};

route("GET", "/v1/config", false, () => ({
  schema: publicConfigSchema,
  body: { siteNotice: (featureValues.get("site.notice") as string | null | undefined) ?? null },
}));
route("GET", "/v1/taxonomy", false, () => ({
  schema: z.array(serviceCategorySchema),
  body: (
    ["workshop", "fuel_station", "towing", "tyres", "parts", "parking", "mobile_mechanic"] as const
  ).map(defaultServiceCategory),
}));
route("GET", "/v1/admin/me", true, ({ user }) => {
  const roles = staffRolesOf(user);
  if (!user || roles.length === 0) return notFound;
  return {
    schema: adminMeSchema,
    body: {
      userId: user.id,
      email: user.email,
      roles,
      mfa: { required: true, satisfied: mfaSatisfied(user) },
    },
  };
});
route(
  "GET",
  "/v1/admin/staff",
  true,
  ({ user }) =>
    staffOnly(user, "super_admin") ?? {
      schema: z.array(platformStaffMemberSchema),
      body: staffList(),
    },
);
route("POST", "/v1/admin/staff/grant", true, ({ user, body, req }) => {
  const denied = staffOnly(user, "super_admin");
  if (denied || !user) return denied ?? notFound;
  if (!confirmed(req, "staff.grant")) return confirmationRequired;
  const email = text(body["email"], "").toLowerCase();
  const role = STAFF_ROLES.find((r) => r === body["role"]);
  if (!role || !email) return { status: 400, body: { statusCode: 400 } };
  const existing = staffGrants.find((g) => g.email === email);
  const userId = existing?.userId ?? newId();
  if (!staffGrants.some((g) => g.email === email && g.role === role)) {
    staffGrants.push({ userId, email, role, since: new Date().toISOString() });
    audit(user, "staff.role_granted", "user", userId, { role, via: "console" });
  }
  return { schema: z.array(platformStaffMemberSchema), body: staffList() };
});
route("POST", "/v1/admin/staff/revoke", true, ({ user, body, req }) => {
  const denied = staffOnly(user, "super_admin");
  if (denied || !user) return denied ?? notFound;
  if (!confirmed(req, "staff.revoke")) return confirmationRequired;
  const index = staffGrants.findIndex(
    (g) => g.userId === body["userId"] && g.role === body["role"],
  );
  if (index === -1) return notFound;
  const [removed] = staffGrants.splice(index, 1);
  if (removed)
    audit(user, "staff.role_revoked", "user", removed.userId, {
      role: removed.role,
      via: "console",
    });
  return { schema: z.array(platformStaffMemberSchema), body: staffList() };
});
route(
  "GET",
  "/v1/admin/features",
  true,
  ({ user }) =>
    staffOnly(user, "super_admin") ?? {
      schema: z.array(featureSettingSchema),
      body: featureList(),
    },
);
route("PUT", "/v1/admin/features/:key", true, ({ user, params, body }) => {
  const denied = staffOnly(user, "super_admin");
  if (denied || !user) return denied ?? notFound;
  const key = FEATURE_SETTING_KEYS.find((k) => k === params[0]);
  if (!key) return notFound;
  const parsed = FEATURE_SETTINGS[key].schema.safeParse(body["value"]);
  if (!parsed.success) return { status: 400, body: { statusCode: 400 } };
  featureValues.set(key, parsed.data);
  audit(user, "feature.setting_changed", "feature_setting", key, { after: parsed.data });
  return { schema: featureSettingSchema, body: featureList().find((f) => f.key === key) };
});
route("PUT", "/v1/admin/taxonomy/:category", true, ({ user, params }) => {
  const denied = staffOnly(user, "super_admin");
  if (denied) return denied;
  const category = (
    ["workshop", "fuel_station", "towing", "tyres", "parts", "parking", "mobile_mechanic"] as const
  ).find((c) => c === params[0]);
  return category
    ? { schema: serviceCategorySchema, body: defaultServiceCategory(category) }
    : notFound;
});
route("GET", "/v1/admin/audit", true, ({ user, query }) => {
  if (staffRolesOf(user).length === 0) return notFound;
  if (!mfaSatisfied(user)) return mfaRequired;
  const action = query.get("action") ?? "";
  const items = auditLog.filter(
    (e) => !action || (action.endsWith(".") ? e.action.startsWith(action) : e.action === action),
  );
  return { schema: auditPageSchema, body: { items, nextCursor: null, scope: "all" } };
});

route("GET", "/v1/me/entitlements", true, ({ user }) => ({
  schema: entitlementsResponseSchema,
  body: entitlements({ type: "user", id: user?.id ?? newId() }),
}));
route("GET", "/v1/me/power-user", true, () => {
  const no = (detail: string) => ({ met: false, detail });
  return {
    schema: myPowerUserSchema,
    body: {
      status: "none",
      shown: false,
      since: null,
      revokedAt: null,
      revokeReason: null,
      appeal: null,
      eligibility: {
        eligible: false,
        criteria: {
          verifiedIdentity: no("Needs a current verified-driver badge (identity check)"),
          accountAge: { met: true, days: 313, detail: "Account is 313 days old (needs 180)" },
          activity: {
            ...no("Score 0/20, 0/10 active days, 0/2 kinds of activity in the last 365 days"),
            score: 0,
            activeDays: 0,
            kinds: 0,
            counts: { publishedArticles: 0, visibleComments: 0, completedRequests: 0 },
          },
          standing: {
            met: true,
            upheldActions: 0,
            detail: "No upheld moderation decisions in the last 180 days",
          },
        },
      },
      rules: POWER_USER_RULES,
      meaning: POWER_USER_MEANING,
    },
  };
});
route("GET", "/v1/me/sanctions", true, () => ({ schema: z.array(sanctionSchema), body: [] }));
route("GET", "/v1/me/appeals", true, () => ({ schema: z.array(moderationAppealSchema), body: [] }));
route("GET", "/v1/me/inbox", true, () => ({
  schema: inboxSchema,
  body: { notifications: [], unreadNotifications: 0, unreadConversations: 0 },
}));
route("GET", "/v1/conversations", true, () => ({ schema: z.array(conversationSchema), body: [] }));
route("GET", "/v1/me/articles", true, () => ({ schema: z.array(z.unknown()), body: [] }));
route("GET", "/v1/me/groups", true, () => ({ schema: z.array(groupSchema), body: [] }));
route("GET", "/v1/me/friends", true, () => ({ schema: z.array(z.unknown()), body: [] }));
route("GET", "/v1/me/friend-requests", true, () => ({ schema: z.array(z.unknown()), body: [] }));
route("GET", "/v1/people", true, () => ({
  schema: z.array(personSchema),
  body: [
    {
      userId: "0190a000-0000-7000-8000-00000000e003",
      displayName: "Lee Mechanic",
      relationship: "none",
    },
  ],
}));

// Service requests
route("GET", "/v1/me/service-requests", true, ({ user }) => ({
  schema: z.array(serviceRequestSchema),
  body: user?.requests ?? [],
}));
route("POST", "/v1/me/service-requests", true, ({ user, body }) => {
  if (!user) return notFound;
  const created = newRequest(user, body);
  user.requests.unshift(created);
  return { status: 201, schema: serviceRequestSchema, body: created };
});
route("GET", "/v1/me/service-requests/:id", true, ({ user, params }) => {
  const found = user?.requests.find((r) => r.id === params[0]);
  return found ? { schema: serviceRequestSchema, body: found } : notFound;
});
route("POST", "/v1/me/service-requests/:id/quotes/:quoteId/accept", true, ({ user, params }) => {
  const found = user?.requests.find((r) => r.id === params[0]);
  const recipient = found?.recipients.find((r) => r.quotes.some((q) => q.id === params[1]));
  const quote = recipient?.quotes.find((q) => q.id === params[1]);
  if (!found || !recipient || !quote) return notFound;
  quote.status = "accepted";
  recipient.status = "accepted";
  found.status = "accepted";
  found.acceptedQuoteId = quote.id;
  found.agreement = {
    quoteId: quote.id,
    providerOrganizationId: recipient.providerOrganizationId,
    priceLabel: quote.price.label,
    informational: true,
    disclaimer: PAYMENT_DISCLAIMER,
  };
  return { schema: serviceRequestSchema, body: found };
});

// Emergency
route("GET", "/v1/me/trusted-contacts", true, ({ user }) => ({
  schema: z.array(trustedContactSchema),
  body: user?.contacts ?? [],
}));
route("POST", "/v1/me/trusted-contacts", true, ({ user, body }) => {
  if (!user) return notFound;
  const contact: TrustedContactDto = {
    id: newId(),
    person: { userId: String(body["userId"]), displayName: "Lee Mechanic" },
    role: "my_contact",
    status: "pending",
    priority: "primary",
    muted: false,
    createdAt: NOW,
  };
  user.contacts.push(contact);
  return { status: 201, schema: trustedContactSchema, body: contact };
});
route("GET", "/v1/emergency/incidents", true, ({ user }) => ({
  schema: z.array(incidentSchema),
  body: user?.incidents ?? [],
}));
route("POST", "/v1/emergency/incidents", true, ({ user, body }) => {
  if (!user) return notFound;
  const created = newIncident(user, body);
  user.incidents.unshift(created);
  return { status: 201, schema: incidentSchema, body: created };
});
route("GET", "/v1/emergency/incidents/:id", true, ({ user, params }) => {
  const found = user?.incidents.find((i) => i.id === params[0]);
  return found ? { schema: incidentSchema, body: found } : notFound;
});
for (const action of ["cancel", "resolve"] as const) {
  route("POST", `/v1/emergency/incidents/:id/${action}`, true, ({ user, params }) => {
    const found = user?.incidents.find((i) => i.id === params[0]);
    if (!found) return notFound;
    found.status = action === "cancel" ? "cancelled" : "resolved";
    found.closedAt = NOW;
    found.location = null;
    return { schema: incidentSchema, body: found };
  });
}

// Vehicles
route("GET", "/v1/me/vehicles", true, ({ user }) => ({
  schema: z.array(vehicleSchema),
  body: user?.vehicles ?? [],
}));
route("POST", "/v1/me/vehicles", true, ({ user, body }) => {
  if (!user) return notFound;
  const vehicle: VehicleDto = {
    id: newId(),
    owner: { kind: "user", userId: user.id, organizationId: null },
    branchId: null,
    nickname: (body["nickname"] as string | null | undefined) ?? null,
    vehicleType: vehicleSchema.shape.vehicleType.parse(body["vehicleType"]),
    make: (body["make"] as string | null | undefined) ?? null,
    model: (body["model"] as string | null | undefined) ?? null,
    year: (body["year"] as number | null | undefined) ?? null,
    registration: (body["registration"] as string | null | undefined) ?? null,
    vin: null,
    odometerKm: null,
    odometerUpdatedAt: null,
    status: "active",
    access: "owner",
    driver: null,
    maintenance: { dueSoon: 0, overdue: 0 },
    createdAt: NOW,
  };
  user.vehicles.push(vehicle);
  return { status: 201, schema: vehicleSchema, body: vehicle };
});

// Organizations
route("GET", "/v1/orgs/:org/entitlements", true, ({ params }) => ({
  schema: entitlementsResponseSchema,
  body: entitlements({ type: "organization", id: params[0] ?? newId() }),
}));
route("GET", "/v1/orgs/:org/members", true, ({ user, params }) => ({
  schema: z.array(memberSchema),
  body:
    user && org(user, params[0] ?? "")
      ? [
          {
            membershipId: newId(),
            userId: user.id,
            displayName: user.displayName,
            email: user.email,
            role: "owner",
            branchId: null,
            joinedAt: NOW,
          },
        ]
      : [],
}));
route("GET", "/v1/orgs/:org/invitations", true, () => ({
  schema: z.array(invitationSchema),
  body: [],
}));
route("GET", "/v1/orgs/:org/verification/cases", true, () => ({
  schema: z.array(verificationCaseSchema),
  body: [],
}));
route("GET", "/v1/orgs/:org/branches", true, ({ params }) => ({
  schema: z.array(branchSchema),
  body: [
    {
      id: `${(params[0] ?? "").slice(0, 24)}aaaaaaaaaaaa`,
      organizationId: params[0],
      name: "Main branch",
      addressLine1: null,
      addressLine2: null,
      locality: null,
      region: null,
      postalCode: null,
      countryCode: null,
      location: null,
      serviceRadiusKm: null,
      phone: null,
      createdAt: NOW,
    },
  ],
}));
route("GET", "/v1/orgs/:org/provider-profile/branches/:branch/hours", true, ({ params }) => ({
  schema: branchHoursSchema,
  body: {
    branchId: params[1],
    timeZone: "Africa/Johannesburg",
    timeZoneSource: "organization",
    weekly: null,
    exceptions: [],
    status: {
      known: false,
      isOpen: false,
      localTime: "2026-11-24T10:00",
      closesAt: null,
      opensAt: null,
      exception: null,
    },
  },
}));
const profileFor = (user: UserState, orgId: string): ProviderProfileDto => {
  const existing = user.profiles.get(orgId);
  if (existing) return existing;
  const created: ProviderProfileDto = {
    organizationId: orgId,
    status: "draft",
    slug: null,
    legalName: null,
    tradingName: null,
    description: null,
    categories: [],
    vehicleTypes: [],
    categoryDetails: {},
    contactPhone: null,
    contactEmail: null,
    website: null,
    steps: [],
    canPublish: false,
    hasUnpublishedChanges: false,
    publishedAt: null,
    updatedAt: NOW,
  };
  user.profiles.set(orgId, created);
  return created;
};
const withSteps = (user: UserState, profile: ProviderProfileDto) => ({
  ...profile,
  ...profileSteps(profile, user.offerings.get(profile.organizationId)?.length ?? 0),
});
route("GET", "/v1/orgs/:org/provider-profile", true, ({ user, params }) =>
  user && org(user, params[0] ?? "")
    ? { schema: providerProfileSchema, body: withSteps(user, profileFor(user, params[0] ?? "")) }
    : notFound,
);
route("PATCH", "/v1/orgs/:org/provider-profile", true, ({ user, params, body }) => {
  if (!user || !org(user, params[0] ?? "")) return notFound;
  const profile = profileFor(user, params[0] ?? "");
  Object.assign(profile, body, { hasUnpublishedChanges: profile.status === "published" });
  return { schema: providerProfileSchema, body: withSteps(user, profile) };
});
route("POST", "/v1/orgs/:org/provider-profile/publish", true, ({ user, params }) => {
  if (!user || !org(user, params[0] ?? "")) return notFound;
  const profile = profileFor(user, params[0] ?? "");
  if (!withSteps(user, profile).canPublish)
    return { status: 409, body: { reason: "profile_incomplete" } };
  Object.assign(profile, { status: "published", publishedAt: NOW, hasUnpublishedChanges: false });
  return { schema: providerProfileSchema, body: withSteps(user, profile) };
});
route("GET", "/v1/orgs/:org/provider-profile/offerings", true, ({ user, params }) => ({
  schema: z.array(offeringSchema),
  body: user?.offerings.get(params[0] ?? "") ?? [],
}));
route("POST", "/v1/orgs/:org/provider-profile/offerings", true, ({ user, params, body }) => {
  if (!user) return notFound;
  const created = offeringSchema.parse({
    id: newId(),
    category: body["category"],
    name: body["name"],
    description: body["description"] ?? null,
    vehicleTypes: body["vehicleTypes"],
    serviceLocation: body["serviceLocation"] ?? "at_premises",
    branchIds: [],
    price: body["price"],
    sortOrder: 0,
    updatedAt: NOW,
  });
  const list = user.offerings.get(params[0] ?? "") ?? [];
  list.push(created);
  user.offerings.set(params[0] ?? "", list);
  return { status: 201, schema: offeringSchema, body: created };
});
route("GET", "/v1/orgs/:org/inquiries", true, () => ({ schema: z.array(z.unknown()), body: [] }));
route("GET", "/v1/orgs/:org/fleet/dashboard", true, () => ({
  schema: fleetDashboardSchema,
  body: {
    window: { days: 30, from: "2026-10-25", to: "2026-11-24" },
    branchId: null,
    vehicles: { active: 0, withDriver: 0 },
    maintenance: { overdue: 0, dueSoon: 0, ok: 0, unknown: 0, items: [] },
    documents: { expiringWithin30Days: 0, expired: 0 },
    incidents: { open: 0, inWindow: 0, byKind: [], highSeverityOpen: 0 },
    serviceRequests: { open: 0, accepted: 0 },
    spending: { lines: [], verified: false, disclaimer: SPENDING_DISCLAIMER },
  },
}));
route("GET", "/v1/orgs/:org/vehicles", true, () => ({ schema: z.array(vehicleSchema), body: [] }));
route("GET", "/v1/orgs/:org/fleet/incidents", true, () => ({
  schema: z.array(z.unknown()),
  body: [],
}));
route("GET", "/v1/orgs/:org/jobs", true, () => ({ schema: z.array(z.unknown()), body: [] }));
route("GET", "/v1/conversations/:id/messages", true, () => ({
  schema: messagePageSchema,
  body: { items: [], more: false },
}));

// --- Server ----------------------------------------------------------------------------------

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, X-Firebase-AppCheck, Accept, X-Confirm-Action",
      });
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/__mock/contract-errors") {
      send(res, 200, contractErrors);
      return;
    }
    if (url.pathname === "/health") {
      send(res, 200, { status: "ok" });
      return;
    }
    const match = routes
      .map((r) => ({ r, m: r.method === req.method ? r.pattern.exec(url.pathname) : null }))
      .find((entry) => entry.m !== null);
    if (!match?.m) {
      send(res, 404, {
        statusCode: 404,
        message: `No mock for ${req.method ?? ""} ${url.pathname}`,
      });
      return;
    }
    const user = userFor(req);
    if (match.r.auth && !user) {
      send(res, 401, { statusCode: 401, reason: "missing_token" });
      return;
    }
    try {
      const result = match.r.handle({
        req,
        user,
        params: match.m.slice(1).map(decodeURIComponent),
        query: url.searchParams,
        body: await readBody(req),
      });
      const status = result.status ?? 200;
      if (result.schema && status < 300) {
        const checked = result.schema.safeParse(result.body);
        if (!checked.success) {
          const message = `${req.method ?? ""} ${url.pathname}: ${checked.error.message}`;
          contractErrors.push(message);
          console.error(`[mock-api] contract mismatch ${message}`);
          send(res, 500, { statusCode: 500, message: "Mock response broke the contract" });
          return;
        }
      }
      send(res, status, result.body);
    } catch (error) {
      console.error("[mock-api] handler failed", error);
      send(res, 400, { statusCode: 400, message: "Bad request" });
    }
  })();
});

server.listen(PORT, "127.0.0.1", () => {
  console.warn(`[mock-api] listening on http://127.0.0.1:${String(PORT)}`);
});
