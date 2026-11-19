import { type App, getApps, initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { type Auth, getAuth } from "firebase-admin/auth";

import {
  type AppCheckVerifier,
  AuthenticationError,
  type AuthFailureReason,
  type AuthVerifier,
  type VerifiedIdentity,
} from "./auth-verifier.js";

/**
 * One Firebase Admin app per process. Credentials come from Application Default Credentials
 * (the Cloud Run service account); with FIREBASE_AUTH_EMULATOR_HOST set (local/CI only, enforced
 * by env validation) the SDK talks to the emulator and needs no credentials.
 */
export function firebaseAdminApp(projectId: string): App {
  const name = `fleettrust-${projectId}`;
  return getApps().find((app) => app.name === name) ?? initializeApp({ projectId }, name);
}

/** Firebase Admin error codes → our reason codes. Unknown failures are "invalid_token". */
const REASONS: Readonly<Record<string, AuthFailureReason>> = {
  "auth/id-token-expired": "expired_token",
  "auth/id-token-revoked": "revoked_token",
  "auth/user-disabled": "user_disabled",
  "auth/user-not-found": "invalid_token",
  "auth/argument-error": "invalid_token",
  "auth/invalid-id-token": "invalid_token",
};

export function toAuthenticationError(error: unknown): AuthenticationError {
  const code = (error as { code?: unknown }).code;
  return new AuthenticationError(
    typeof code === "string" ? (REASONS[code] ?? "invalid_token") : "invalid_token",
  );
}

export class FirebaseAuthVerifier implements AuthVerifier {
  constructor(private readonly auth: Pick<Auth, "verifyIdToken" | "revokeRefreshTokens">) {}

  static forProject(projectId: string): FirebaseAuthVerifier {
    return new FirebaseAuthVerifier(getAuth(firebaseAdminApp(projectId)));
  }

  async verifyIdToken(
    token: string,
    options: { checkRevoked: boolean },
  ): Promise<VerifiedIdentity> {
    let decoded;
    try {
      decoded = await this.auth.verifyIdToken(token, options.checkRevoked);
    } catch (error) {
      throw toAuthenticationError(error);
    }
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified === true,
      signInProvider: decoded.firebase.sign_in_provider,
      authTime: new Date(decoded.auth_time * 1000),
      secondFactor: decoded.firebase.sign_in_second_factor,
    };
  }

  async revokeSessions(uid: string): Promise<void> {
    await this.auth.revokeRefreshTokens(uid);
  }
}

export class FirebaseAppCheckVerifier implements AppCheckVerifier {
  constructor(private readonly projectId: string) {}

  async verify(token: string): Promise<void> {
    await getAppCheck(firebaseAdminApp(this.projectId)).verifyToken(token);
  }
}
