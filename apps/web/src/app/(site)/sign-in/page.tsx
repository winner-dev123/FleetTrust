"use client";

import { copy } from "@fleettrust/copy";
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
import { MfaChallenge } from "@/components/mfa-challenge";
import { isMfaRequiredError } from "@/lib/admin";
import { apiClient, firebaseAuth } from "@/lib/firebase";
import { afterSignInPath } from "@/lib/pending-invitation";
import { emailLinkSettings, normaliseEmail, rememberPendingEmail } from "@/lib/email-link";
import { type PendingMfa, pendingMfa } from "@/lib/mfa";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string }
  | { kind: "mfa"; pending: PendingMfa };

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
      setStatus({ kind: "error", message: copy.web.signIn.emailInvalid });
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
        message: copy.web.signIn.sendFailed,
      });
    }
  }

  async function finish() {
    await apiClient().me();
    router.replace(afterSignInPath());
  }

  async function signInWith(provider: AuthProvider) {
    try {
      await signInWithPopup(firebaseAuth(), provider);
      await finish();
    } catch (error) {
      // Staff accounts with two-step sign-in need a code from their authenticator app.
      if (isMfaRequiredError(error)) {
        setStatus({ kind: "mfa", pending: pendingMfa(error) });
        return;
      }
      setStatus({ kind: "error", message: copy.web.signIn.popupFailed });
    }
  }

  if (status.kind === "mfa") {
    return (
      <div className="container stack" style={{ maxWidth: 460 }}>
        <title>{copy.web.signIn.mfaPageTitle}</title>
        <h1>{copy.web.signIn.title}</h1>
        <MfaChallenge
          available={status.pending.available}
          resolve={async (code) => {
            await status.pending.resolve(code);
            await finish();
          }}
        />
      </div>
    );
  }

  const apple = new OAuthProvider("apple.com");
  apple.addScope("email");

  return (
    <div className="container stack" style={{ maxWidth: 460 }}>
      <title>{copy.web.signIn.pageTitle}</title>
      <h1>{copy.web.signIn.title}</h1>
      <p className="muted">{copy.web.signIn.intro}</p>

      {status.kind === "sent" ? (
        <Notice tone="success" live="polite" title={copy.web.signIn.sentTitle}>
          <p>
            {copy.web.signIn.sentBefore} <strong>{status.email}</strong>.{" "}
            {copy.web.signIn.sentAfter}
          </p>
        </Notice>
      ) : (
        <form className="stack" onSubmit={(event) => void sendLink(event)} noValidate>
          <TextField
            label={copy.web.signIn.emailLabel}
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
            {status.kind === "sending" ? copy.web.signIn.sending : copy.web.signIn.sendLink}
          </Button>
        </form>
      )}

      <div className="stack" style={{ marginTop: 16 }}>
        <Button variant="secondary" block onClick={() => void signInWith(new GoogleAuthProvider())}>
          {copy.web.signIn.google}
        </Button>
        <Button variant="secondary" block onClick={() => void signInWith(apple)}>
          {copy.web.signIn.apple}
        </Button>
      </div>
      <p className="small muted">{copy.web.signIn.responsible}</p>
    </div>
  );
}
