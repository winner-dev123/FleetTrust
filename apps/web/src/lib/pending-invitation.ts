/**
 * Carries an invitation token across sign-in. Invitation links put the token in the URL
 * fragment (`/invitations/accept#token=…`), which never reaches a server or a Referer header.
 * If the visitor must sign in first, the token waits in localStorage (it survives the email-
 * link round trip, which can open a new tab) and is cleared once used. A leaked token alone is
 * useless: accepting also needs the invited, verified email.
 */
import { takeReturnPath } from "./return-path";

const KEY = "fleettrust.pendingInvitation";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token !== null && TOKEN.test(token) ? token : null;
}

export function savePendingInvitation(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // Storage blocked: the user can open the invitation link again after signing in.
  }
}

export function pendingInvitation(): string | null {
  try {
    const token = localStorage.getItem(KEY);
    return token !== null && TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function clearPendingInvitation(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/**
 * Where to go after signing in: a pending invitation first, then the page that asked the person
 * to sign in (same-site paths only), else the dashboard.
 */
export function afterSignInPath(): string {
  if (pendingInvitation() !== null) return "/invitations/accept";
  try {
    return takeReturnPath(localStorage) ?? "/app";
  } catch {
    return "/app";
  }
}
