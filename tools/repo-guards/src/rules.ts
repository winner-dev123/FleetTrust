/**
 * ADR-0011: future modules (payments/escrow, reviews/ratings, rewards/streaks) exist only as
 * RFCs. These rules catch the concrete ways such a module would sneak into the codebase:
 * tables and columns, API routes, UI routes, config/feature flags and payment SDKs.
 * A line containing `guard-allow: <reason>` is exempt (the reason is required and reviewed).
 */

export interface SourceFile {
  /** Repository-relative path with forward slashes. */
  path: string;
  content: string;
}

export interface Violation {
  path: string;
  line: number;
  rule: string;
  detail: string;
}

/** Stems that indicate an excluded module wherever they appear as an identifier. */
const EXCLUDED_STEMS = [
  "escrow",
  "payout",
  "rating",
  "reward",
  "streak",
  "checkout",
  // Parts are inquiry-only (SRS §8, ADR-0028): no cart, basket or reservation; referral fees are
  // disclosed, never processed (AB-17).
  "cart",
  "basket",
  "reservation",
  "commission",
  "wallet",
  "ledger",
  "stripe",
  "paypal",
  "testimonial",
] as const;

const STEM_PATTERN = new RegExp(`(^|[_\\-/.])(${EXCLUDED_STEMS.join("|")})s?($|[_\\-/.])`, "i");

/** A name ending in "review(s)": a reviews table, column or route segment. */
const REVIEW_PATTERN = /(^|[_\-/])reviews?$/i;
/** Verification reviews are an in-scope admin workflow (ADR-0009), not customer reviews. */
const VERIFICATION_CONTEXT = /verification/i;
const PAYMENT_ROUTE_PATTERN = /(^|\/)(payments?|charges?|refunds?|invoices?\/pay)(\/|$)/i;

const PAYMENT_SDKS = [
  /^stripe$/,
  /^@stripe\//,
  /^paypal/,
  /^@paypal\//,
  /^braintree/,
  /^@adyen\//,
  /^square$/,
  /^@square\//,
  /^razorpay$/,
  /^paystack/,
  /^flutterwave/,
  /^mollie/,
  /^@mollie\//,
];

const ALLOW = /guard-allow:\s*\S+/;

function identifierHit(name: string, context: string = name): string | undefined {
  const lower = name.toLowerCase();
  const stem = STEM_PATTERN.exec(lower)?.[2];
  if (stem) return stem;
  if (REVIEW_PATTERN.test(lower) && !VERIFICATION_CONTEXT.test(context)) return "review";
  return undefined;
}

function eachLine(file: SourceFile, visit: (line: string, index: number) => void): void {
  file.content.split(/\r?\n/).forEach((line, index) => {
    if (!ALLOW.test(line)) visit(line, index + 1);
  });
}

/** Table and column names in SQL migrations. */
export function checkMigration(file: SourceFile): Violation[] {
  const violations: Violation[] = [];
  eachLine(file, (line, lineNo) => {
    const table = /CREATE TABLE (?:IF NOT EXISTS )?"?([a-z0-9_]+)"?/i.exec(line)?.[1];
    if (table) {
      const hit = identifierHit(table);
      if (hit)
        violations.push({
          path: file.path,
          line: lineNo,
          rule: "excluded-table",
          detail: `table "${table}" (${hit})`,
        });
    }
    const column =
      /^\s*"([a-z0-9_]+)"\s+[a-z]/i.exec(line)?.[1] ??
      /ADD COLUMN (?:IF NOT EXISTS )?"?([a-z0-9_]+)"?/i.exec(line)?.[1];
    if (column) {
      const hit = identifierHit(column);
      if (hit)
        violations.push({
          path: file.path,
          line: lineNo,
          rule: "excluded-column",
          detail: `column "${column}" (${hit})`,
        });
    }
  });
  return violations;
}

/** NestJS route decorators: @Controller("…"), @Get("…"), @Post("…"), … */
export function checkApiRoutes(file: SourceFile): Violation[] {
  const violations: Violation[] = [];
  eachLine(file, (line, lineNo) => {
    for (const match of line.matchAll(
      /@(Controller|Get|Post|Put|Patch|Delete|All|Head|Options)\(\s*["'`]([^"'`]*)["'`]/g,
    )) {
      const route = match[2] ?? "";
      const segments = route.split("/").filter(Boolean);
      const hit =
        segments.map((segment) => identifierHit(segment.replace(/^:/, ""), route)).find(Boolean) ??
        (PAYMENT_ROUTE_PATTERN.test(route) ? "payment" : undefined);
      if (hit)
        violations.push({
          path: file.path,
          line: lineNo,
          rule: "excluded-route",
          detail: `@${match[1] ?? ""}("${route}") (${hit})`,
        });
    }
  });
  return violations;
}

/** File-system routes in the web (Next.js app/) and mobile (Expo Router app/) apps. */
export function checkUiRoute(path: string): Violation[] {
  const match = /^apps\/(web|mobile)\/(?:src\/)?app\/(.+)$/.exec(path);
  if (!match) return [];
  const segments = (match[2] ?? "")
    .split("/")
    .slice(0, -1)
    .map((segment) => segment.replace(/^[([]+|[)\]]+$/g, ""));
  const hit =
    segments.map((segment) => identifierHit(segment, path)).find(Boolean) ??
    (segments.some((segment) => /^(payments?|pay)$/i.test(segment)) ? "payment" : undefined);
  return hit
    ? [{ path, line: 1, rule: "excluded-ui-route", detail: `route segment (${hit})` }]
    : [];
}

/** Environment keys and feature-flag names (.env.example files, FEATURE_/FLAG_ constants). */
export function checkConfigKeys(file: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const isEnvFile = /(^|\/)\.env(\.[a-z]+)?\.example$/.test(file.path);
  eachLine(file, (line, lineNo) => {
    const keys = isEnvFile
      ? [/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line)?.[1]]
      : [...line.matchAll(/\b((?:FEATURE|FLAG|FF)_[A-Z0-9_]+)\b/g)].map((m) => m[1]);
    for (const key of keys) {
      if (!key) continue;
      const hit =
        identifierHit(key.toLowerCase()) ??
        (/(^|_)PAYMENTS?(_|$)/.test(key) ? "payment" : undefined);
      if (hit)
        violations.push({
          path: file.path,
          line: lineNo,
          rule: "excluded-config",
          detail: `${key} (${hit})`,
        });
    }
  });
  return violations;
}

/** Payment-provider SDKs in any package.json (ADR-0008: no payment processing). */
export function checkDependencies(file: SourceFile): Violation[] {
  const pkg = JSON.parse(file.content) as Record<string, Record<string, string> | undefined>;
  const violations: Violation[] = [];
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (PAYMENT_SDKS.some((pattern) => pattern.test(name))) {
        violations.push({
          path: file.path,
          line: 1,
          rule: "payment-sdk",
          detail: `${field}: ${name}`,
        });
      }
    }
  }
  return violations;
}
