/**
 * Pure helpers for Firebase email-link sign-in, kept free of Firebase and the DOM so they
 * can be unit-tested.
 *
 * The email address is remembered on the device that requested the link. If the link is
 * opened on another device, the user re-enters it; this stops someone who intercepts the
 * link from signing in without also knowing the address.
 */

export const PENDING_EMAIL_KEY = "fleettrust.emailForSignIn";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Firebase ActionCodeSettings for a link that returns to /auth/finish on this site. */
export function emailLinkSettings(origin: string): { url: string; handleCodeInApp: true } {
  const url = new URL("/auth/finish", origin);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Email sign-in links must use HTTPS outside local development");
  }
  return { url: url.toString(), handleCodeInApp: true };
}

/** Basic shape check only; Firebase does the real validation. */
export function normaliseEmail(input: string): string | undefined {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : undefined;
}

export function rememberPendingEmail(storage: KeyValueStorage, email: string): void {
  try {
    storage.setItem(PENDING_EMAIL_KEY, email);
  } catch {
    // Private browsing or storage disabled: the user re-enters the address on return.
  }
}

/** Reads the remembered address without clearing it (safe in render-time initialisers). */
export function readPendingEmail(storage: KeyValueStorage): string | undefined {
  try {
    return storage.getItem(PENDING_EMAIL_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Forgets the remembered address once the link has been used. */
export function clearPendingEmail(storage: KeyValueStorage): void {
  try {
    storage.removeItem(PENDING_EMAIL_KEY);
  } catch {
    // nothing to clear
  }
}

/** Reads and clears the remembered address (one use per link). */
export function takePendingEmail(storage: KeyValueStorage): string | undefined {
  const email = readPendingEmail(storage);
  clearPendingEmail(storage);
  return email;
}
