import type { EmailLinkSettings, Platform } from "../platform/types";
import { appPath, parseUrl } from "./links";

/**
 * Email-link sign-in on the phone (ADR-0005, ADR-0032). Firebase emails a link to the web
 * origin; with universal links / app links the phone opens it in the app, which finishes the
 * sign-in. Firebase asks for the email address again unless this device started the sign-in,
 * so we keep it on the device until the link is used (and for at most a day).
 */

export const APP_IDS = { ios: "com.fleettrust.app", android: "com.fleettrust.app" } as const;
export const PENDING_SIGN_IN_KEY = "ft:signin:pending";
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

export function emailLinkSettings(webUrl: string, linkDomain: string | null): EmailLinkSettings {
  return {
    url: `${webUrl}/auth/finish`,
    handleCodeInApp: true,
    iOS: { bundleId: APP_IDS.ios },
    android: { packageName: APP_IDS.android, installApp: true },
    ...(linkDomain ? { linkDomain } : {}),
  };
}

interface Pending {
  email: string;
  returnPath: string;
  at: number;
}

export async function startEmailSignIn(
  platform: Platform,
  input: { email: string; returnPath: string | null; webUrl: string; linkDomain: string | null },
  now: () => number = Date.now,
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!isEmail(email)) throw new Error("invalid_email");
  const returnPath = (input.returnPath && safeReturnPath(input.returnPath)) ?? "/";
  await platform.auth.sendSignInLink(email, emailLinkSettings(input.webUrl, input.linkDomain));
  const pending: Pending = { email, returnPath, at: now() };
  await platform.storage.set(PENDING_SIGN_IN_KEY, JSON.stringify(pending));
}

/** Only in-app screens are valid return paths (never a URL or an unknown route). */
export function safeReturnPath(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  const [pathname = "/", query = ""] = path.split("?", 2);
  const parsed = parseUrl(`fleettrust://app${pathname}?${query}`);
  return parsed ? appPath(parsed.path, parsed.query) : null;
}

async function readPending(platform: Platform, now: () => number): Promise<Pending | null> {
  const raw = await platform.storage.get(PENDING_SIGN_IN_KEY);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<Pending>;
    if (
      typeof value.email === "string" &&
      typeof value.returnPath === "string" &&
      typeof value.at === "number" &&
      now() - value.at <= PENDING_TTL_MS
    ) {
      return { email: value.email, returnPath: value.returnPath, at: value.at };
    }
  } catch {
    // Unreadable: treated as missing.
  }
  await platform.storage.remove(PENDING_SIGN_IN_KEY);
  return null;
}

export type FinishResult =
  | { status: "signed-in"; returnPath: string }
  | { status: "need-email" }
  | { status: "invalid-link" };

/**
 * Completes sign-in from an email link. `email` is required only when this device didn't
 * start the sign-in (the link was opened on another phone, or the app was reinstalled).
 */
export async function finishEmailSignIn(
  platform: Platform,
  link: string,
  email?: string,
  now: () => number = Date.now,
): Promise<FinishResult> {
  if (!platform.auth.isSignInLink(link)) return { status: "invalid-link" };
  const pending = await readPending(platform, now);
  const address = email?.trim().toLowerCase() ?? pending?.email;
  if (!address || !isEmail(address)) return { status: "need-email" };
  await platform.auth.completeSignInLink(address, link);
  await platform.storage.remove(PENDING_SIGN_IN_KEY);
  return { status: "signed-in", returnPath: pending?.returnPath ?? "/" };
}
