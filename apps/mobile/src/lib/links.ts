/**
 * Deep links (ADR-0032). The app opens for three kinds of URL:
 *
 * - its own scheme, `fleettrust://requests/<id>`;
 * - web URLs on the FleetTrust web origin (universal links / Android app links), which use
 *   the web's paths (`/app/requests/<id>`) and are mapped to the app's screens;
 * - Firebase email sign-in links, which go to the sign-in completion screen.
 *
 * Everything else, and any path that isn't a known screen, opens the home screen. IDs are
 * checked against a strict pattern so a link can't smuggle extra path segments or queries.
 */

export interface ParsedUrl {
  scheme: string;
  host: string;
  path: string;
  query: Record<string, string>;
}

const SEGMENT = /^[A-Za-z0-9_-]{1,100}$/;
export const APP_SCHEME = "fleettrust";

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return null;
  }
}

/** Minimal URL parser (React Native's `URL` is incomplete). Returns null for non-URLs. */
export function parseUrl(url: string): ParsedUrl | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(url.trim());
  if (!match) return null;
  const [, scheme = "", host = "", rawPath = "", rawQuery = ""] = match;
  const query: Record<string, string> = {};
  for (const pair of rawQuery.split("&")) {
    if (pair === "") continue;
    const index = pair.indexOf("=");
    const key = decode(index === -1 ? pair : pair.slice(0, index));
    const value = decode(index === -1 ? "" : pair.slice(index + 1));
    if (key !== null && value !== null && !(key in query)) query[key] = value;
  }
  return { scheme: scheme.toLowerCase(), host: host.toLowerCase(), path: rawPath, query };
}

const slug = (value: string | undefined) =>
  value !== undefined && SEGMENT.test(value) ? value : undefined;

function segments(path: string): string[] | null {
  const parts = path.split("/").filter((part) => part !== "");
  for (const part of parts) {
    if (!SEGMENT.test(part)) return null;
  }
  return parts;
}

/** Only short, plain query values pass through (search text, a category, a provider slug). */
const withQuery = (path: string, query: Record<string, string | undefined>) => {
  const pairs = Object.entries(query).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[1] !== "" && entry[1].length <= 100,
  );
  if (pairs.length === 0) return path;
  return `${path}?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
};

/** Validates an in-app path (from the app scheme, a notification or a stored return path). */
export function appPath(path: string, query: Record<string, string> = {}): string | null {
  const parts = segments(path);
  if (parts === null) return null;
  const [first, second, third] = parts;
  if (parts.length === 0) return withQuery("/", { q: query["q"], category: query["category"] });
  if (third !== undefined) return null;
  switch (first) {
    case "requests":
      if (second === undefined) return "/requests";
      if (second === "new")
        return withQuery("/requests/new", { provider: slug(query["provider"]) });
      return `/requests/${second}`;
    case "messages":
    case "providers":
    case "articles":
      if (second === undefined) return first === "messages" ? "/messages" : null;
      return `/${first}/${second}`;
    case "emergency":
      return second === undefined ? "/emergency" : `/emergency/${second}`;
    case "community":
    case "account":
    case "notifications":
    case "sign-in":
      return second === undefined ? `/${first}` : null;
    default:
      return null;
  }
}

/** Maps a web path (and its query) to the app screen showing the same thing, or null. */
export function webPathToAppPath(path: string, query: Record<string, string> = {}): string | null {
  const parts = segments(path);
  if (parts === null) return null;
  const [first, second, third, fourth] = parts;
  if (fourth !== undefined) return null;
  if (first === undefined) return "/";
  if (first === "search" && second === undefined) {
    return withQuery("/", { q: query["q"], category: query["category"] });
  }
  if ((first === "providers" || first === "articles") && second !== undefined && !third) {
    return `/${first}/${second}`;
  }
  if (first === "articles" && second === undefined) return "/community";
  if (first === "emergency" && second === undefined) return "/emergency";
  if (first === "sign-in" && second === undefined) return "/sign-in";
  if (first !== "app") return null;
  if (second === undefined) return "/";
  switch (second) {
    case "requests":
      if (third === "new") return withQuery("/requests/new", { provider: slug(query["provider"]) });
      return third === undefined ? "/requests" : `/requests/${third}`;
    case "messages":
      return third === undefined ? "/messages" : `/messages/${third}`;
    case "emergency":
      return third === undefined ? "/emergency" : `/emergency/${third}`;
    case "notifications":
      return third === undefined ? "/notifications" : null;
    case "account":
    case "appeals":
      return third === undefined ? "/account" : null;
    case "community":
      return third === undefined ? "/community" : null;
    default:
      return null;
  }
}

export interface LinkContext {
  /** The web origin, e.g. https://app.fleettrust.example (universal links). */
  webUrl: string;
  /** The Firebase Hosting domain email links use, if configured. */
  linkDomain: string | null;
}

/** True for a Firebase email sign-in link (checked again by Firebase before use). */
export function looksLikeEmailSignInLink(parsed: ParsedUrl): boolean {
  if (parsed.query["mode"] === "signIn" && parsed.query["oobCode"]) return true;
  // Hosting link wrapper: the real action link is in `link`.
  const inner = parsed.query["link"] ? parseUrl(parsed.query["link"]) : null;
  return inner !== null && inner.query["mode"] === "signIn" && Boolean(inner.query["oobCode"]);
}

function isTrustedHost(parsed: ParsedUrl, context: LinkContext): boolean {
  const web = parseUrl(context.webUrl);
  return (
    (web !== null && parsed.host === web.host && parsed.scheme === web.scheme) ||
    (context.linkDomain !== null &&
      parsed.scheme === "https" &&
      parsed.host === context.linkDomain.toLowerCase())
  );
}

/** The sign-in completion screen, only for a real email link from a trusted host. */
function finishPath(link: string | undefined, context: LinkContext): string | null {
  const inner = link ? parseUrl(link) : null;
  if (!link || !inner || !isTrustedHost(inner, context) || !looksLikeEmailSignInLink(inner))
    return null;
  return `/auth/finish?link=${encodeURIComponent(link)}`;
}

/**
 * Where an incoming system URL should go. Always returns an in-app path; unknown or foreign
 * links open the home screen rather than failing. Expo Router also passes the app's own
 * paths through here (for example `/auth/finish?link=…`), so those are accepted too.
 */
export function resolveIncomingUrl(url: string, context: LinkContext): string {
  let parsed: ParsedUrl | null;
  let inApp = false;
  if (url.startsWith("/")) {
    const [path = "/", rawQuery = ""] = url.split("?", 2);
    parsed = parseUrl(`${APP_SCHEME}://app${path}?${rawQuery}`);
    inApp = true;
  } else {
    parsed = parseUrl(url);
    // fleettrust://requests/123 → host "requests", path "/123".
    if (parsed?.scheme === APP_SCHEME) {
      parsed = { ...parsed, path: `/${parsed.host}${parsed.path}` };
      inApp = true;
    }
  }
  if (!parsed) return "/";
  if (inApp) {
    if (parsed.path.replace(/\/+$/, "") === "/auth/finish") {
      return finishPath(parsed.query["link"], context) ?? "/";
    }
    return appPath(parsed.path, parsed.query) ?? "/";
  }
  if (parsed.scheme !== "https" && parsed.scheme !== "http") return "/";
  if (!isTrustedHost(parsed, context)) return "/";
  if (looksLikeEmailSignInLink(parsed)) return `/auth/finish?link=${encodeURIComponent(url)}`;
  return webPathToAppPath(parsed.path, parsed.query) ?? "/";
}
