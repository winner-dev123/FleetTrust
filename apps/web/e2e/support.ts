import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const AUTH_EMULATOR = "http://127.0.0.1:9099";
const MOCK_API = "http://127.0.0.1:8787";
const PROJECT = "demo-fleettrust";

/** WCAG 2.0, 2.1 and 2.2 level A and AA rules, contrast included. */
export async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const problems = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? "?"}): ${violation.help} → ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
  expect(problems, `accessibility problems on ${label}`).toEqual([]);
}

/** Content fits the viewport width: no sideways scrolling (WCAG 1.4.10 Reflow). */
export async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow on ${label}`).toBeLessThanOrEqual(1);
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}@example.test`;
}

interface OobCode {
  email: string;
  oobCode: string;
  requestType: string;
}

/**
 * The real email-link sign-in, end to end against the Firebase Auth emulator: request the
 * link in the UI, read it from the emulator's mailbox API, open it, land signed in.
 */
export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();

  let code: string | undefined;
  await expect
    .poll(async () => {
      const response = await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/oobCodes`);
      const body = (await response.json()) as { oobCodes: OobCode[] };
      code = body.oobCodes.findLast(
        (entry) => entry.email === email && entry.requestType === "EMAIL_SIGNIN",
      )?.oobCode;
      return code;
    })
    .toBeTruthy();

  const params = new URLSearchParams({
    mode: "signIn",
    oobCode: code ?? "",
    apiKey: "demo-api-key",
    lang: "en",
  });
  await page.goto(`/auth/finish?${params.toString()}`);
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
}

/** Every mock response so far matched the shared API schemas. */
export async function expectNoContractErrors() {
  const response = await fetch(`${MOCK_API}/__mock/contract-errors`);
  expect(await response.json()).toEqual([]);
}
