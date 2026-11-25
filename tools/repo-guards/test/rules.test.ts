import { describe, expect, it } from "vitest";

import {
  checkApiRoutes,
  checkConfigKeys,
  checkDependencies,
  checkMigration,
  checkUiRoute,
} from "../src/rules.ts";

const sql = (content: string) =>
  checkMigration({ path: "packages/db/migrations/0009_x.sql", content });
const ts = (content: string) => checkApiRoutes({ path: "apps/api/src/x.controller.ts", content });

describe("migrations", () => {
  it.each([
    'CREATE TABLE "escrow_holds" (',
    'CREATE TABLE "provider_ratings" (',
    'CREATE TABLE IF NOT EXISTS "reviews" (',
    'CREATE TABLE "service_reviews" (',
    'CREATE TABLE "reward_points" (',
    'CREATE TABLE "daily_streaks" (',
  ])("flags %s", (line) => {
    expect(sql(line)).toHaveLength(1);
  });

  it("flags excluded columns", () => {
    expect(sql('  "star_rating" smallint NOT NULL,').map((v) => v.rule)).toEqual([
      "excluded-column",
    ]);
    expect(
      sql('ALTER TABLE "providers" ADD COLUMN "payout_account" text;').map((v) => v.rule),
    ).toEqual(["excluded-column"]);
  });

  it("allows legitimate names", () => {
    expect(
      sql(
        [
          'CREATE TABLE "verification_reviews" (',
          '  "reviewed_by" uuid,',
          '  "operating_hours" jsonb,',
          '  "external_payment_reference" text,',
          'CREATE TABLE "currencies" (',
          '  "generated_at" timestamp,',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("respects guard-allow with a reason", () => {
    expect(sql('CREATE TABLE "ratings" ( -- guard-allow: RFC-0003 approved migration')).toEqual([]);
    expect(sql('CREATE TABLE "ratings" ( -- guard-allow:')).toHaveLength(1);
  });
});

describe("API routes", () => {
  it.each([
    '@Controller("payments")',
    '@Post("checkout")',
    '@Get("providers/:id/reviews")',
    '@Get("providers/:id/rating")',
    '@Post("rewards/daily-check-in")',
    '@Post("escrow/:id/release")',
    '@Post("invoices/pay")',
    '@Post("parts/:partId/cart")',
    '@Post("part-reservations")',
    '@Get("referrals/:id/commission")',
  ])("flags %s", (decorator) => {
    expect(ts(`  ${decorator}`)).toHaveLength(1);
  });

  it("allows legitimate routes", () => {
    expect(
      ts(
        [
          '@Controller("health")',
          '@Get("ready")',
          '@Post("verification-cases/:id/review")',
          '@Get("plans")',
          '@Post("admin/plan-assignments")',
          '@Post(":inquiryId/answer")',
          '@Controller("v1/orgs/:orgId/received-part-inquiries")',
          '@Put(":partId/stock")',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("UI routes", () => {
  it("flags excluded route folders in web and mobile apps", () => {
    expect(checkUiRoute("apps/web/src/app/checkout/page.tsx")).toHaveLength(1);
    expect(checkUiRoute("apps/web/src/app/(account)/payments/page.tsx")).toHaveLength(1);
    expect(checkUiRoute("apps/mobile/app/rewards/index.tsx")).toHaveLength(1);
    expect(checkUiRoute("apps/web/src/app/providers/[id]/reviews/page.tsx")).toHaveLength(1);
  });

  it("ignores file names and legitimate folders", () => {
    expect(checkUiRoute("apps/web/src/app/page.tsx")).toEqual([]);
    expect(checkUiRoute("apps/web/src/app/providers/[id]/page.tsx")).toEqual([]);
    expect(checkUiRoute("apps/web/src/components/checkout.tsx")).toEqual([]);
  });
});

describe("config keys and feature flags", () => {
  it("flags excluded env keys and flags", () => {
    expect(
      checkConfigKeys({
        path: "apps/api/.env.example",
        content: "STRIPE_SECRET_KEY=\n# PAYMENTS_ENABLED=false",
      }),
    ).toHaveLength(2);
    expect(
      checkConfigKeys({
        path: "apps/web/src/flags.ts",
        content: 'export const FEATURE_REVIEWS = "on";',
      }),
    ).toHaveLength(1);
  });

  it("allows normal keys", () => {
    expect(
      checkConfigKeys({
        path: "apps/api/.env.example",
        content: "DATABASE_URL=\nLOG_LEVEL=info\nFEATURE_ROUTE_SEARCH=1",
      }),
    ).toEqual([]);
  });
});

describe("payment SDKs", () => {
  it("flags payment provider packages", () => {
    const content = JSON.stringify({
      dependencies: { stripe: "1.0.0", zod: "4" },
      devDependencies: { "@stripe/stripe-js": "1" },
    });
    expect(
      checkDependencies({ path: "apps/api/package.json", content }).map((v) => v.detail),
    ).toEqual(["dependencies: stripe", "devDependencies: @stripe/stripe-js"]);
  });
});

describe("SDKs of the other excluded modules", () => {
  it("flags AI model SDKs, i18n frameworks and telematics SDKs", () => {
    const content = JSON.stringify({
      dependencies: { openai: "4", "@anthropic-ai/sdk": "1", ai: "5", zod: "4", "next-intl": "3" },
      devDependencies: { "@langchain/core": "1", i18next: "23", "@samsarahq/api": "1" },
    });
    expect(
      checkDependencies({ path: "apps/web/package.json", content }).map(
        (v) => `${v.rule} ${v.detail}`,
      ),
    ).toEqual([
      "ai-sdk dependencies: openai",
      "ai-sdk dependencies: @anthropic-ai/sdk",
      "ai-sdk dependencies: ai",
      "i18n-framework dependencies: next-intl",
      "ai-sdk devDependencies: @langchain/core",
      "i18n-framework devDependencies: i18next",
      "telematics-sdk devDependencies: @samsarahq/api",
    ]);
  });

  it.each([
    'CREATE TABLE "telematics_readings" (',
    'CREATE TABLE "vehicle_geofences" (',
    'CREATE TABLE "article_translations" (',
    'ALTER TABLE "articles" ADD COLUMN "embedding" vector(768);',
    'CREATE TABLE "llm_prompts" (',
  ])("flags tables and columns of AI, telematics and translation modules: %s", (line) => {
    expect(sql(line)).toHaveLength(1);
  });

  it.each(['CREATE TABLE "vehicles" (', '  "odometer_km" integer,', '  "locale_note" text,'])(
    "doesn't flag today's columns: %s",
    (line) => {
      expect(sql(line)).toEqual([]);
    },
  );
});
