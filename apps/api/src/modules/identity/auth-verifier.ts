import type { AuthErrorReason } from "@fleettrust/types";

/** What the API trusts about a caller after verifying their Firebase ID token. */
export interface VerifiedIdentity {
  /** Firebase UID. Stays inside the identity module; the rest of the system uses users.id. */
  uid: string;
  email: string | undefined;
  emailVerified: boolean;
  /** e.g. `password`/`emailLink`, `google.com`, `apple.com`. */
  signInProvider: string | undefined;
  /** When the user last actually signed in (not when the token was refreshed). */
  authTime: Date;
  /** Second factor used, if any (admin MFA, Prompt 26). */
  secondFactor: string | undefined;
}

export type AuthFailureReason = Extract<
  AuthErrorReason,
  | "missing_token"
  | "malformed_token"
  | "invalid_token"
  | "expired_token"
  | "revoked_token"
  | "user_disabled"
>;

/** Carries only a reason code; never the token or the underlying provider error. */
export class AuthenticationError extends Error {
  constructor(readonly reason: AuthFailureReason) {
    super(`Authentication failed: ${reason}`);
    this.name = "AuthenticationError";
  }
}

/** Identity-provider port (ADR-0005). Firebase today; swappable without touching authorization. */
export interface AuthVerifier {
  /** Throws AuthenticationError. `checkRevoked` adds a lookup, so use it on sensitive routes only. */
  verifyIdToken(token: string, options: { checkRevoked: boolean }): Promise<VerifiedIdentity>;
  /** Invalidates every refresh token for the user ("sign out everywhere"). */
  revokeSessions(uid: string): Promise<void>;
  /** A one-time email sign-in link for the address (support recovery, Prompt 26). */
  signInLink(email: string, continueUrl: string): Promise<string>;
}

export const AUTH_VERIFIER = Symbol("AUTH_VERIFIER");

/** Client attestation port (Firebase App Check). */
export interface AppCheckVerifier {
  /** Resolves when the token is valid; rejects otherwise. */
  verify(token: string): Promise<void>;
}

export const APP_CHECK_VERIFIER = Symbol("APP_CHECK_VERIFIER");
