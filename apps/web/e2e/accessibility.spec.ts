import { expect, test } from "@playwright/test";

import {
  expectAccessible,
  expectNoContractErrors,
  expectNoHorizontalScroll,
  signIn,
  uniqueEmail,
} from "./support";

/**
 * Every page, on a desktop and a 320-pixel phone (two Playwright projects): axe WCAG 2.2 A/AA
 * checks, contrast included, and no sideways scrolling.
 */
// Axe checks the settled page: with reduced motion the entrance animations finish at once, so
// contrast is never measured on half-faded text. The journeys run with motion on.
test.use({ reducedMotion: "reduce" });

const PUBLIC_PAGES = [
  "/",
  "/search?q=brakes&where=Cape+Town&lat=-33.92490&lng=18.42410",
  "/search?where=Cape+Town&lat=-33.92490&lng=18.42410&view=map",
  "/providers/acme-garage",
  "/articles",
  "/articles/checking-tyre-pressure",
  "/jobs",
  "/jobs/0190a000-0000-7000-8000-00000000d001",
  "/emergency",
  "/how-it-works",
  "/for-providers",
  "/accessibility",
  "/sign-in",
  "/providers/no-such-provider",
];

const SIGNED_IN_PAGES = [
  "/app",
  "/app/onboarding",
  "/app/requests",
  "/app/requests/new",
  "/app/emergency",
  "/app/vehicles",
  "/app/messages",
  "/app/notifications",
  "/app/community",
  "/app/community/write",
  "/app/account",
  "/app/appeals",
];

const ORG_PAGES = {
  provider: ["", "/profile", "/branches", "/services", "/inquiries", "/members", "/usage"],
  fleet: ["", "/vehicles", "/incidents", "/jobs", "/members", "/usage"],
};

test.afterAll(async () => {
  await expectNoContractErrors();
});

test("public pages are accessible and fit the screen", async ({ page }) => {
  for (const path of PUBLIC_PAGES) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByText(/^(Loading|Searching|Finding)/)).toHaveCount(0);
    await expectAccessible(page, path);
    await expectNoHorizontalScroll(page, path);
  }
});

test("public pages keep AA contrast in the dark theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  for (const path of PUBLIC_PAGES) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByText(/^(Loading|Searching|Finding)/)).toHaveCount(0);
    await expectAccessible(page, `${path} (dark)`);
  }
});

test("signed-in pages are accessible and fit the screen", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("a11y"));
  for (const path of SIGNED_IN_PAGES) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.getByText(/^Loading/)).toHaveCount(0);
    await expectAccessible(page, path);
    await expectNoHorizontalScroll(page, path);
  }

  for (const kind of ["provider", "fleet"] as const) {
    await page.goto("/app/onboarding");
    await page.getByLabel("Display name").fill("Alex");
    await page
      .getByLabel(kind === "provider" ? /I run a vehicle service business/ : /I manage a fleet/)
      .check();
    await page
      .getByLabel(kind === "provider" ? "Business name" : "Fleet name")
      .fill(`A11y ${kind}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/app\/o\/[0-9a-f-]+$/);
    const base = new URL(page.url()).pathname;
    for (const suffix of ORG_PAGES[kind]) {
      const path = `${base}${suffix}`;
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expect(page.getByText(/^Loading/)).toHaveCount(0);
      await expectAccessible(page, `${kind}${suffix || " overview"}`);
      await expectNoHorizontalScroll(page, `${kind}${suffix || " overview"}`);
    }
  }
});

const ADMIN_PAGES = [
  "/app/admin",
  "/app/admin/staff",
  "/app/admin/features",
  "/app/admin/taxonomy",
  "/app/admin/audit",
  "/app/admin/security",
];

test("admin console pages are accessible and fit the screen", async ({ page }) => {
  test.setTimeout(120_000);
  // "admin-…" accounts are super admins in the mock API, signed in with two-step verification.
  await signIn(page, uniqueEmail("admin"));
  for (const path of ADMIN_PAGES) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.getByText(/^Loading/)).toHaveCount(0);
    await expectAccessible(page, path);
    await expectNoHorizontalScroll(page, path);
  }
});

test("legal pages are accessible", async ({ page }) => {
  for (const path of ["/legal/privacy", "/legal/terms"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    await expectAccessible(page, path);
    await expectNoHorizontalScroll(page, path);
  }
});
