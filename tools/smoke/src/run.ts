import { appendFileSync } from "node:fs";

import { runChecks } from "./checks.ts";

/**
 * Smoke test one environment. Exits non-zero when any check fails.
 *
 *   API_URL=https://api.staging.example.com WEB_URL=https://staging.example.com \
 *   EXPECT_VERSION=<git sha> ALLOWED_ORIGIN=https://staging.example.com node src/run.ts
 *
 * Optional: SMOKE_ID_TOKEN (a smoke-test account's Firebase ID token) for a signed-in call.
 * Writes a Markdown table to GITHUB_STEP_SUMMARY when set.
 */

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/+$/, "");
};
/** Unset and empty both mean "not configured" (GitHub passes unset variables as ""). */
const optional = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
};

/** Opens a socket, sends one frame, and reports how the server closed it. */
function socketCloseCode(url: string, frame: string): Promise<number | "open"> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      resolve("open");
    }, 10_000);
    socket.addEventListener("open", () => {
      socket.send(frame);
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      resolve(event.code);
    });
  });
}

const apiUrl = required("API_URL");
const webUrl = optional("WEB_URL")?.replace(/\/+$/, "");
const expectVersion = optional("EXPECT_VERSION");
const allowedOrigin = optional("ALLOWED_ORIGIN");
const idToken = optional("SMOKE_ID_TOKEN");
const results = await runChecks({
  apiUrl,
  expectHttps: apiUrl.startsWith("https://"),
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
  socketCloseCode,
  ...(webUrl ? { webUrl } : {}),
  ...(expectVersion ? { expectVersion } : {}),
  ...(allowedOrigin ? { allowedOrigin } : {}),
  ...(idToken ? { idToken } : {}),
});

const icon = { pass: "PASS", fail: "FAIL", skip: "skip" } as const;
const lines = [
  `### Smoke test: ${apiUrl}${expectVersion ? ` (release ${expectVersion.slice(0, 12)})` : ""}`,
  "",
  "| Result | Check | ms | Detail |",
  "| --- | --- | --- | --- |",
  ...results.map(
    (r) => `| ${icon[r.status]} | ${r.name} | ${String(r.ms)} | ${r.detail.replace(/\|/g, "/")} |`,
  ),
  "",
];
console.log(lines.join("\n"));
if (process.env["GITHUB_STEP_SUMMARY"])
  appendFileSync(process.env["GITHUB_STEP_SUMMARY"], lines.join("\n"));
const failed = results.filter((r) => r.status === "fail");
if (failed.length > 0) {
  console.error(`${String(failed.length)} smoke check(s) failed`);
  process.exit(1);
}
