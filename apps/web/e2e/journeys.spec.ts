import {
  FORBIDDEN_EMERGENCY_WORDING,
  INDICATIVE_PRICE_DISCLAIMER,
  PAYMENT_DISCLAIMER,
} from "@fleettrust/types";
import { expect, type Page, test } from "@playwright/test";

import { expectNoContractErrors, signIn, uniqueEmail } from "./support";

/** Follows a link in the signed-in navigation, opening the menu first on small screens. */
async function navigate(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Your areas" });
  const menu = nav.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) await menu.click();
  await nav.getByRole("link", { name, exact: true }).click();
}

test.afterAll(async () => {
  await expectNoContractErrors();
});

test("a visitor finds a provider, uses the map and sees what was verified", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("What do you need?").fill("brakes");
  await page.getByLabel("Where?").fill("Cape Town");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByRole("heading", { name: /Results near Cape Town/ })).toBeVisible();
  const results = page.getByRole("list", { name: "Providers" });
  await expect(results.getByRole("link", { name: "Acme Garage" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "2 results" })).toBeVisible();
  await expect(page.getByText(INDICATIVE_PRICE_DISCLAIMER)).toBeVisible();
  await expect(results.getByText("Business registration: verified")).toBeVisible();

  // The map repeats the list: numbered pins select the matching result.
  await page.getByRole("button", { name: "Show map" }).click();
  const pin = page.getByRole("button", { name: /^1\. Acme Garage/ });
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");

  await results.getByRole("link", { name: "Acme Garage" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Acme Garage" })).toBeVisible();
  await expect(page.getByText("Business registration: verified (until")).toBeVisible();
  await expect(page.getByText("Business location: not verified")).toBeVisible();
  await expect(page.getByText(/sign in\b.*to see phone/i)).toBeVisible();
  await expect(page.getByRole("cell", { name: "From ZAR 850.00 per job" })).toBeVisible();
});

test("sign-in returns you to the page that asked for it", async ({ page }) => {
  await page.goto("/app/requests/new?provider=acme-garage");
  await page.waitForURL("**/sign-in");
  await signIn(page, uniqueEmail("return"));
  await expect(page).toHaveURL(/\/app\/requests\/new\?provider=acme-garage$/);
  await expect(page.getByText("This request goes to Acme Garage only.")).toBeVisible();
});

test("a new member sets up, requests a quote and accepts it", async ({ page }) => {
  await signIn(page, uniqueEmail("driver"));
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: "Set up your account" }).click();
  await page.getByLabel("Display name").fill("Jo Driver");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Jo Driver" })).toBeVisible();

  await page.getByRole("link", { name: "Request a quote" }).first().click();
  await page
    .getByLabel("Describe the problem")
    .fill("Brakes squeal when stopping, worse in the morning.");
  await page.getByLabel("Or type a place").fill("Cape Town");
  await page.getByRole("button", { name: "Find place" }).click();
  await expect(page.getByText("Using: Cape Town, Western Cape")).toBeVisible();
  await page.getByRole("button", { name: "Send request" }).click();

  await expect(page.getByRole("heading", { name: "Workshop request" })).toBeVisible();
  await expect(page.getByText("ZAR 950.00 per job")).toBeVisible();
  await page.getByRole("button", { name: "Accept this quote" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "You accepted Acme Garage" }),
  ).toBeVisible();
  await expect(page.getByText(PAYMENT_DISCLAIMER)).toBeVisible();
});

test.describe("emergency", () => {
  test.use({ geolocation: { latitude: -33.93, longitude: 18.42 }, permissions: ["geolocation"] });

  test("raise an alert with one confirmation, see who was notified, cancel it", async ({
    page,
  }) => {
    await signIn(page, uniqueEmail("sos"));
    await page.goto("/app/emergency");
    await expect(page.getByText("Call your local emergency number.")).toBeVisible();

    await page.getByLabel("Accident").check();
    await page.getByRole("button", { name: "Use my current location" }).click();
    await expect(page.getByText("Using: Your current location")).toBeVisible();
    await page.getByRole("button", { name: "Send alert", exact: true }).click();

    const confirm = page.getByRole("alertdialog", { name: "Send this alert now?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Yes, send alert" }).click();

    await expect(page.getByRole("heading", { name: "Accident alert" })).toBeVisible();
    await expect(page.getByText("Sam Driver")).toBeVisible();
    await expect(page.getByText(/^Notified/)).toBeVisible();
    expect(FORBIDDEN_EMERGENCY_WORDING.test(await page.locator("main").innerText())).toBe(false);

    await page.getByRole("button", { name: "Cancel: sent by mistake" }).click();
    await expect(page.getByText("Alert cancelled.")).toBeVisible();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  });
});

test("a provider completes the checklist and publishes", async ({ page }) => {
  await signIn(page, uniqueEmail("provider"));
  await page.goto("/app/onboarding");
  await page.getByLabel("Display name").fill("Pat Owner");
  await page.getByLabel(/I run a vehicle service business/).check();
  await page.getByLabel("Business name").fill("Pat's Tyres");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Pat's Tyres" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish profile" })).toBeDisabled();

  await navigate(page, "Business profile");
  await page.getByLabel("Trading name").fill("Pat's Tyres");
  await page.getByLabel("Registered (legal) name").fill("Pat's Tyres CC");
  await page.getByLabel("Profile web address").fill("pats-tyres");
  await page.getByLabel("Tyres", { exact: true }).check();
  await page.getByLabel("Car", { exact: true }).check();
  await page.getByLabel("Phone").fill("+27 21 555 0199");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Saved as a draft/)).toBeVisible();

  await navigate(page, "Services and prices");
  await page.getByLabel("Service name").fill("Puncture repair");
  await page.getByLabel("Amount").fill("150");
  await page.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByRole("cell", { name: "Puncture repair Workshop" })).toBeVisible();

  await navigate(page, "Profile setup");
  await page.getByRole("button", { name: "Publish profile" }).click();
  await expect(page.getByText("Your profile is published and appears in search.")).toBeVisible();
});

test("keyboard users can skip to the content", async ({ page }) => {
  await page.goto("/jobs");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test.describe("admin console", () => {
  test("a super admin grants a role only after typing a confirmation, and finds it in the audit log", async ({
    page,
  }) => {
    await signIn(page, uniqueEmail("admin"));
    await page.goto("/app/admin/staff");
    await expect(page.getByRole("heading", { name: "Staff roles", level: 1 })).toBeVisible();
    const target = uniqueEmail("helper").toLowerCase();
    await page.getByLabel("Email address").fill(target);
    await page.getByLabel("Role").selectOption("support_agent");
    await page.getByRole("button", { name: "Grant Support agent…" }).click();

    const dialog = page.getByRole("alertdialog", { name: "Grant Support agent?" });
    await expect(dialog).toContainText("can't be undone");
    const confirm = dialog.getByRole("button", { name: "Grant Support agent" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(`Type ${target} to confirm`).fill("someone-else@example.test");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(`Type ${target} to confirm`).fill(target);
    await confirm.click();
    await expect(page.getByText(`Granted Support agent to ${target}.`)).toBeVisible();
    await expect(page.getByRole("region", { name: "Current staff" })).toContainText(target);

    await page.goto("/app/admin/audit");
    await page.getByLabel("Action").fill("staff.");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("region", { name: "Audit entries" })).toContainText(
      "staff.role_granted",
    );
  });

  test("staff without two-step sign-in can only open the setup page", async ({ page }) => {
    await signIn(page, uniqueEmail("nomfa"));
    await page.goto("/app/admin/staff");
    await expect(
      page.getByRole("heading", { name: "Two-step sign-in needed", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Current staff" })).toHaveCount(0);
    await page.getByRole("link", { name: "Set it up or sign in with your code" }).click();
    await expect(page.getByRole("heading", { name: "Two-step sign-in", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start setup" })).toBeVisible();
  });

  test("everyone else sees no console", async ({ page }) => {
    await signIn(page, uniqueEmail("member"));
    await page.goto("/app/admin");
    await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
    await page.goto("/app");
    await expect(page.getByRole("link", { name: "Admin console" })).toHaveCount(0);
  });
});
