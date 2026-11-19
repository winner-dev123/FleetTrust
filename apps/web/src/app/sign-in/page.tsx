"use client";

import { spacing, typography } from "@fleettrust/ui";
import {
  type AuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  sendSignInLinkToEmail,
  signInWithPopup,
} from "@firebase/auth";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";

import { apiClient, firebaseAuth } from "@/lib/firebase";
import { afterSignInPath } from "@/lib/pending-invitation";
import { emailLinkSettings, normaliseEmail, rememberPendingEmail } from "@/lib/email-link";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

/**
 * Minimal signup and sign-in (SRS FR-01): an email address or a Google/Apple account. No
 * password, no documents. The account is created on the first API call after sign-in.
 */
export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function sendLink(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = normaliseEmail(email);
    if (!address) {
      setStatus({ kind: "error", message: "Enter a valid email address." });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      await sendSignInLinkToEmail(
        firebaseAuth(),
        address,
        emailLinkSettings(window.location.origin),
      );
      rememberPendingEmail(window.localStorage, address);
      setStatus({ kind: "sent", email: address });
    } catch {
      setStatus({
        kind: "error",
        message: "We couldn't send the link. Please try again in a moment.",
      });
    }
  }

  async function signInWith(provider: AuthProvider) {
    try {
      await signInWithPopup(firebaseAuth(), provider);
      await apiClient().me();
      router.replace(afterSignInPath());
    } catch {
      setStatus({ kind: "error", message: "Sign-in was cancelled or failed. Please try again." });
    }
  }

  const apple = new OAuthProvider("apple.com");
  apple.addScope("email");

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: `${spacing.xxl}px ${spacing.lg}px` }}>
      <h1 style={{ fontSize: typography.fontSize.xl }}>Sign in to FleetTrust</h1>
      <p style={{ color: "var(--color-text-muted)" }}>
        No password needed. New here? Signing in creates your account.
      </p>

      {status.kind === "sent" ? (
        <p role="status">
          Check your inbox: we sent a sign-in link to <strong>{status.email}</strong>. Open it on
          this device.
        </p>
      ) : (
        <form onSubmit={(event) => void sendLink(event)} noValidate>
          <label htmlFor="email" style={{ display: "block", marginBottom: spacing.xs }}>
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            style={{ width: "100%", padding: spacing.sm, fontSize: typography.fontSize.md }}
          />
          <button
            type="submit"
            disabled={status.kind === "sending"}
            style={{ marginTop: spacing.md, width: "100%", padding: spacing.sm }}
          >
            {status.kind === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}

      <div style={{ display: "grid", gap: spacing.sm, marginTop: spacing.xl }}>
        <button
          type="button"
          onClick={() => void signInWith(new GoogleAuthProvider())}
          style={{ padding: spacing.sm }}
        >
          Continue with Google
        </button>
        <button
          type="button"
          onClick={() => void signInWith(apple)}
          style={{ padding: spacing.sm }}
        >
          Continue with Apple
        </button>
      </div>

      {status.kind === "error" && (
        <p role="alert" style={{ color: "var(--color-danger)" }}>
          {status.message}
        </p>
      )}
    </main>
  );
}
