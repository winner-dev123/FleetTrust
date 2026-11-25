import { randomBytes } from "node:crypto";

import {
  type AppCheckVerifier,
  AuthenticationError,
  type AuthVerifier,
  type VerifiedIdentity,
} from "../../src/modules/identity/auth-verifier.js";

interface IssuedToken {
  identity: VerifiedIdentity;
  issuedAt: number;
  expired: boolean;
}

/**
 * In-memory stand-in for Firebase Auth with the same observable behaviour: opaque bearer
 * tokens, expiry, and revocation that only shows up when `checkRevoked` is requested.
 * The real adapter is exercised against the Auth emulator in test/integration.
 */
export class FakeAuthVerifier implements AuthVerifier {
  private readonly tokens = new Map<string, IssuedToken>();
  private readonly revokedAt = new Map<string, number>();
  private readonly disabled = new Set<string>();
  readonly revokeCalls: string[] = [];

  issue(
    uid: string,
    overrides: Partial<Omit<VerifiedIdentity, "uid">> & { expired?: boolean } = {},
  ): string {
    const token = `fake.${uid}.${randomBytes(12).toString("hex")}`;
    this.tokens.set(token, {
      identity: {
        uid,
        email: "email" in overrides ? overrides.email : `${uid}@example.test`,
        emailVerified: overrides.emailVerified ?? true,
        signInProvider: overrides.signInProvider ?? "emailLink",
        authTime: overrides.authTime ?? new Date(),
        secondFactor: overrides.secondFactor,
      },
      issuedAt: Date.now(),
      expired: overrides.expired ?? false,
    });
    return token;
  }

  disable(uid: string): void {
    this.disabled.add(uid);
  }

  verifyIdToken(token: string, options: { checkRevoked: boolean }): Promise<VerifiedIdentity> {
    const issued = this.tokens.get(token);
    if (!issued) return Promise.reject(new AuthenticationError("invalid_token"));
    if (issued.expired) return Promise.reject(new AuthenticationError("expired_token"));
    if (this.disabled.has(issued.identity.uid)) {
      return Promise.reject(new AuthenticationError("user_disabled"));
    }
    const revokedAt = this.revokedAt.get(issued.identity.uid);
    if (options.checkRevoked && revokedAt !== undefined && issued.issuedAt <= revokedAt) {
      return Promise.reject(new AuthenticationError("revoked_token"));
    }
    return Promise.resolve(issued.identity);
  }

  revokeSessions(uid: string): Promise<void> {
    this.revokeCalls.push(uid);
    this.revokedAt.set(uid, Date.now());
    return Promise.resolve();
  }

  readonly deletedAccounts: string[] = [];

  deleteAccount(uid: string): Promise<void> {
    this.deletedAccounts.push(uid);
    this.disabled.add(uid);
    return Promise.resolve();
  }

  readonly signInLinks: { email: string; continueUrl: string }[] = [];

  signInLink(email: string, continueUrl: string): Promise<string> {
    this.signInLinks.push({ email, continueUrl });
    return Promise.resolve(
      `${continueUrl}?mode=signIn&oobCode=fake-${String(this.signInLinks.length)}`,
    );
  }
}

export class FakeAppCheckVerifier implements AppCheckVerifier {
  constructor(private readonly validTokens = new Set(["valid-app-check-token"])) {}

  verify(token: string): Promise<void> {
    return this.validTokens.has(token)
      ? Promise.resolve()
      : Promise.reject(new Error("invalid App Check token"));
  }
}
