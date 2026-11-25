"use client";

import { isSignInWithEmailLink, signInWithEmailLink } from "@firebase/auth";
import { useRouter } from "next/navigation";
import { type SubmitEvent, Suspense, use, useEffect, useState } from "react";
import { browser } from "react-dom";

import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { Loading, Notice } from "@/components/feedback";
import { MfaChallenge } from "@/components/mfa-challenge";
import { isMfaRequiredError } from "@/lib/admin";
import { clearPendingEmail, normaliseEmail, readPendingEmail } from "@/lib/email-link";
import { apiClient, firebaseAuth } from "@/lib/firebase";
import { type PendingMfa, pendingMfa } from "@/lib/mfa";
import { afterSignInPath } from "@/lib/pending-invitation";

type State =
  | { kind: "signing-in"; email: string }
  | { kind: "need-email" }
  | { kind: "invalid" }
  | { kind: "failed" }
  | { kind: "mfa"; pending: PendingMfa };

/** Decides the first state from the link in the address bar and the email remembered on this device. */
function initialState(): State {
  if (!isSignInWithEmailLink(firebaseAuth(), window.location.href)) return { kind: "invalid" };
  const remembered = readPendingEmail(window.localStorage);
  return remembered ? { kind: "signing-in", email: remembered } : { kind: "need-email" };
}

/** Browser-only: it reads the one-time link from the URL and the email from localStorage. */
function FinishSignIn() {
  use(browser("The sign-in link and the remembered email exist only in the browser."));
  const router = useRouter();
  const [state, setState] = useState<State>(initialState);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (state.kind !== "signing-in") return;
    let cancelled = false;
    const run = async () => {
      try {
        try {
          await signInWithEmailLink(firebaseAuth(), state.email, window.location.href);
        } catch (error) {
          // Staff accounts with two-step sign-in finish with a code from their app.
          if (!isMfaRequiredError(error)) throw error;
          clearPendingEmail(window.localStorage);
          window.history.replaceState(null, "", "/auth/finish");
          if (!cancelled) setState({ kind: "mfa", pending: pendingMfa(error) });
          return;
        }
        clearPendingEmail(window.localStorage);
        // Remove the one-time code from the address bar and history.
        window.history.replaceState(null, "", "/auth/finish");
        await apiClient().me(); // creates the account on first sign-in
        if (!cancelled) router.replace(afterSignInPath());
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [state, router]);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = normaliseEmail(email);
    if (address) setState({ kind: "signing-in", email: address });
  }

  switch (state.kind) {
    case "mfa":
      return (
        <MfaChallenge
          available={state.pending.available}
          resolve={async (code) => {
            await state.pending.resolve(code);
            await apiClient().me();
            router.replace(afterSignInPath());
          }}
        />
      );
    case "signing-in":
      return <Loading label="Signing you in…" />;
    case "need-email":
      return (
        <form className="stack" onSubmit={submit}>
          <p>For your security, confirm the email address this link was sent to.</p>
          <TextField
            label="Email address"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <div>
            <Button type="submit">Continue</Button>
          </div>
        </form>
      );
    case "invalid":
      return (
        <Notice tone="danger" live="assertive">
          <p>
            This sign-in link is invalid or has already been used.{" "}
            <a href="/sign-in">Request a new one</a>.
          </p>
        </Notice>
      );
    case "failed":
      return (
        <Notice tone="danger" live="assertive">
          <p>
            We couldn&apos;t sign you in with this link. It may have expired.{" "}
            <a href="/sign-in">Try again</a>.
          </p>
        </Notice>
      );
  }
}

/** Landing page for the emailed sign-in link. */
export default function FinishSignInPage() {
  return (
    <div className="container stack" style={{ maxWidth: 460 }}>
      <title>Signing in · FleetTrust</title>
      <h1>Signing you in</h1>
      <Suspense fallback={<Loading label="One moment…" />}>
        <FinishSignIn />
      </Suspense>
    </div>
  );
}
