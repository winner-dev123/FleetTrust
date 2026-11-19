/**
 * The plan catalog, as code (ADR-0008). **Sample limits and prices**: the real catalog is an
 * owner decision (OQ-09). Prices are display-only and never charged through the platform
 * (OQ-18). Editing a plan here and re-running `pnpm db:seed` publishes a new version;
 * existing assignments keep the version they were given.
 *
 * Capability keys must exist in CAPABILITIES (@fleettrust/types); an API test enforces it.
 * A key absent from a plan means "not included" (limit 0); null means unlimited.
 */
export interface PlanDefinition {
  code: string;
  audience: "user" | "provider" | "fleet";
  name: string;
  isDefault: boolean;
  price: { amountMinor: number; currency: string; period: "month" | "year" } | null;
  limits: Readonly<Record<string, number | null>>;
}

export const PLAN_CATALOG: readonly PlanDefinition[] = [
  {
    code: "personal-free",
    audience: "user",
    name: "Personal",
    isDefault: true,
    price: null,
    limits: {
      "friend_requests.daily": 20,
      "service_requests.daily": 3,
      "articles.daily": 2,
      "groups.daily": 1,
    },
  },
  {
    code: "personal-plus",
    audience: "user",
    name: "Personal Plus",
    isDefault: false,
    price: { amountMinor: 499, currency: "USD", period: "month" },
    limits: {
      "friend_requests.daily": 100,
      "service_requests.daily": 10,
      "articles.daily": 10,
      "groups.daily": 5,
    },
  },
  {
    code: "provider-free",
    audience: "provider",
    name: "Provider Starter",
    isDefault: true,
    price: null,
    limits: {
      "staff.seats": 5,
      "branches.max": 3,
      "articles.daily": 2,
      "groups.daily": 1,
    },
  },
  {
    code: "provider-pro",
    audience: "provider",
    name: "Provider Pro",
    isDefault: false,
    price: { amountMinor: 4900, currency: "USD", period: "month" },
    limits: {
      "staff.seats": 50,
      "branches.max": 20,
      "articles.daily": 20,
      "groups.daily": 5,
    },
  },
  {
    code: "fleet-free",
    audience: "fleet",
    name: "Fleet Starter",
    isDefault: true,
    price: null,
    limits: {
      "staff.seats": 10,
      "branches.max": 3,
      "service_requests.daily": 10,
      "articles.daily": 2,
      "groups.daily": 1,
    },
  },
  {
    code: "fleet-pro",
    audience: "fleet",
    name: "Fleet Pro",
    isDefault: false,
    price: { amountMinor: 9900, currency: "USD", period: "month" },
    limits: {
      "staff.seats": 200,
      "branches.max": 50,
      "service_requests.daily": 200,
      "articles.daily": 20,
      "groups.daily": 5,
    },
  },
];
