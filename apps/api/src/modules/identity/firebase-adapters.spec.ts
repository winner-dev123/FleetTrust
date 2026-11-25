import type { DecodedIdToken } from "firebase-admin/auth";
import { describe, expect, it, vi } from "vitest";

import { AuthenticationError } from "./auth-verifier.js";
import { FirebaseAuthVerifier } from "./firebase-adapters.js";

function firebaseError(code: string): Error {
  return Object.assign(new Error(`firebase says ${code}`), { code });
}

describe("FirebaseAuthVerifier", () => {
  it("maps decoded Firebase claims to a VerifiedIdentity", async () => {
    const decoded = {
      uid: "abc123",
      email: "Driver@Example.test",
      email_verified: true,
      auth_time: 1_763_000_000,
      firebase: { sign_in_provider: "apple.com", identities: {}, sign_in_second_factor: "totp" },
    } as unknown as DecodedIdToken;
    const auth = {
      verifyIdToken: vi.fn().mockResolvedValue(decoded),
      revokeRefreshTokens: vi.fn(),
      generateSignInWithEmailLink: vi.fn(),
      deleteUser: vi.fn(),
    };

    const identity = await new FirebaseAuthVerifier(auth).verifyIdToken("tok", {
      checkRevoked: true,
    });

    expect(auth.verifyIdToken).toHaveBeenCalledWith("tok", true);
    expect(identity).toEqual({
      uid: "abc123",
      email: "Driver@Example.test",
      emailVerified: true,
      signInProvider: "apple.com",
      authTime: new Date(1_763_000_000_000),
      secondFactor: "totp",
    });
  });

  it.each([
    ["auth/id-token-expired", "expired_token"],
    ["auth/id-token-revoked", "revoked_token"],
    ["auth/user-disabled", "user_disabled"],
    ["auth/argument-error", "invalid_token"],
    ["auth/something-new", "invalid_token"],
  ])("maps %s to %s without leaking the provider message", async (code, expected) => {
    const auth = {
      verifyIdToken: vi.fn().mockRejectedValue(firebaseError(code)),
      revokeRefreshTokens: vi.fn(),
      generateSignInWithEmailLink: vi.fn(),
      deleteUser: vi.fn(),
    };
    const error = await new FirebaseAuthVerifier(auth)
      .verifyIdToken("tok", { checkRevoked: false })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).reason).toBe(expected);
    expect((error as Error).message).not.toContain("firebase says");
  });

  it("revokes refresh tokens for the UID", async () => {
    const auth = {
      verifyIdToken: vi.fn(),
      revokeRefreshTokens: vi.fn().mockResolvedValue(undefined),
      generateSignInWithEmailLink: vi.fn().mockResolvedValue("https://link.example/x"),
      deleteUser: vi.fn(),
    };
    await new FirebaseAuthVerifier(auth).revokeSessions("abc123");
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith("abc123");
  });
});

describe("FirebaseAuthVerifier.signInLink", () => {
  it("asks Firebase for an in-app email sign-in link to the given address", async () => {
    const auth = {
      verifyIdToken: vi.fn(),
      revokeRefreshTokens: vi.fn(),
      generateSignInWithEmailLink: vi.fn().mockResolvedValue("https://link.example/abc"),
      deleteUser: vi.fn(),
    };
    const link = await new FirebaseAuthVerifier(auth).signInLink(
      "driver@example.com",
      "https://app.example.com/auth/finish",
    );
    expect(link).toBe("https://link.example/abc");
    expect(auth.generateSignInWithEmailLink).toHaveBeenCalledWith("driver@example.com", {
      url: "https://app.example.com/auth/finish",
      handleCodeInApp: true,
    });
  });
});

describe("FirebaseAuthVerifier.deleteAccount", () => {
  it("deletes the Firebase user and ignores one that is already gone", async () => {
    const gone = Object.assign(new Error("gone"), { code: "auth/user-not-found" });
    const auth = {
      verifyIdToken: vi.fn(),
      revokeRefreshTokens: vi.fn(),
      generateSignInWithEmailLink: vi.fn(),
      deleteUser: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(gone),
    };
    const verifier = new FirebaseAuthVerifier(auth);
    await verifier.deleteAccount("abc");
    await verifier.deleteAccount("abc");
    expect(auth.deleteUser).toHaveBeenCalledTimes(2);
  });
});
