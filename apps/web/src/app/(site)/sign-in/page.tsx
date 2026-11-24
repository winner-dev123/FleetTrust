"use client";

import {
  type AuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  sendSignInLinkToEmail,
  signInWithPopup,
} from "@firebase/auth";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { Notice } from "@/components/feedback";
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
    <div className="container stack" style={{ maxWidth: 460 }}>
      <title>Sign in · FleetTrust</title>
      <h1>Sign in to FleetTrust</h1>
      <p className="muted">No password needed. New here? Signing in creates your free account.</p>

      {status.kind === "sent" ? (
        <Notice tone="success" live="polite" title="Check your inbox">
          <p>
            We sent a sign-in link to <strong>{status.email}</strong>. Open it on this device.
          </p>
        </Notice>
      ) : (
        <form className="stack" onSubmit={(event) => void sendLink(event)} noValidate>
          <TextField
            label="Email address"
            type="email"
            autoComplete="email"
            required
            value={email}
            error={status.kind === "error" ? status.message : null}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <Button type="submit" block busy={status.kind === "sending"}>
            {status.kind === "sending" ? "Sending…" : "Email me a sign-in link"}
          </Button>
        </form>
      )}

      <div className="stack" style={{ marginTop: 16 }}>
        <Button variant="secondary" block onClick={() => void signInWith(new GoogleAuthProvider())}>
          Continue with Google
        </Button>
        <Button variant="secondary" block onClick={() => void signInWith(apple)}>
          Continue with Apple
        </Button>
      </div>
      <p className="small muted">
        By continuing you agree to use FleetTrust responsibly. We only ask for what an account
        needs: no documents, no payment details.
      </p>
    </div>
  );
}
