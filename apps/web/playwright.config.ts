import { defineConfig, devices } from "@playwright/test";

/**
 * Web end-to-end tests (ADR-0031): real browser, production build, Firebase Auth emulator for
 * sign-in, and a contract-checked mock API (e2e/mock-api.ts). Run: `pnpm --filter
 * @fleettrust/web e2e`. Needs Java (Auth emulator). Locally, PLAYWRIGHT_CHANNEL=chrome uses the
 * installed Chrome instead of downloading Playwright's browser.
 */
const CI = Boolean(process.env["CI"]);
const WEB_PORT = 3100;
const API_PORT = 8787;

const AUTH_EMULATOR = "http://127.0.0.1:9099";
const MOCK_API = `http://127.0.0.1:${String(API_PORT)}`;

export default defineConfig({
  testDir: "e2e",
  // The mock keeps per-user state in memory; one worker keeps runs deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: `http://localhost:${String(WEB_PORT)}`,
    trace: "retain-on-failure",
    ...(process.env["PLAYWRIGHT_CHANNEL"] ? { channel: process.env["PLAYWRIGHT_CHANNEL"] } : {}),
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    // WCAG 1.4.10 Reflow: every page must work at 320 CSS pixels without sideways scrolling.
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 320, height: 780 } } },
  ],
  webServer: [
    {
      command: "node e2e/mock-api.ts",
      url: `${MOCK_API}/health`,
      reuseExistingServer: !CI,
      env: { MOCK_API_PORT: String(API_PORT) },
    },
    {
      command: "pnpm exec firebase emulators:start --only auth --project demo-fleettrust",
      cwd: "../..",
      url: AUTH_EMULATOR,
      timeout: 120_000,
      reuseExistingServer: !CI,
    },
    {
      // NEXT_PUBLIC_* values are inlined at build time, so the e2e build has its own settings.
      command: `pnpm exec next build && pnpm exec next start --port ${String(WEB_PORT)}`,
      url: `http://localhost:${String(WEB_PORT)}`,
      timeout: 300_000,
      reuseExistingServer: !CI,
      env: {
        NEXT_PUBLIC_APP_ENV: "test",
        NEXT_PUBLIC_API_URL: MOCK_API,
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-fleettrust",
        NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      },
    },
  ],
});
