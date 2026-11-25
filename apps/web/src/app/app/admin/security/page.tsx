"use client";

import { multiFactor, type TotpSecret, TotpMultiFactorGenerator } from "@firebase/auth";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useAdmin } from "@/lib/admin-context";
import { firebaseAuth } from "@/lib/firebase";
import { rememberReturnPath } from "@/lib/return-path";
import { useSession } from "@/lib/session";

type Step =
  | { kind: "idle" }
  | { kind: "secret"; secret: TotpSecret; uri: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

const requiresRecentLogin = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "auth/requires-recent-login";

/**
 * Two-step sign-in for staff (Prompt 26): an authenticator app (TOTP through Identity
 * Platform, OQ-12). Every staff route needs it on the current sign-in.
 */
export default function SecurityPage() {
  const me = useAdmin();
  const router = useRouter();
  const { signOut } = useSession();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const user = typeof window === "undefined" ? null : firebaseAuth().currentUser;
  const enrolled = user
    ? multiFactor(user).enrolledFactors.filter(
        (f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID,
      )
    : [];

  async function signInAgain() {
    rememberReturnPath(window.sessionStorage, "/app/admin");
    await signOut();
    router.replace("/sign-in");
  }

  async function start() {
    if (!user) return;
    setBusy(true);
    try {
      const session = await multiFactor(user).getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      setStep({
        kind: "secret",
        secret,
        uri: secret.generateQrCodeUrl(user.email ?? "staff", "FleetTrust"),
      });
    } catch (error) {
      setStep({
        kind: "error",
        message: requiresRecentLogin(error)
          ? "For your security, sign in again, then come back here to set up the app."
          : "Two-step sign-in couldn't be started. It needs Identity Platform on the Firebase project (OQ-12).",
      });
    } finally {
      setBusy(false);
    }
  }

  async function finish(event: SubmitEvent<HTMLFormElement>, secret: TotpSecret) {
    event.preventDefault();
    if (!user || !/^\d{6}$/.test(code.trim())) {
      setStep({ kind: "error", message: "Enter the 6-digit code your app shows for FleetTrust." });
      return;
    }
    setBusy(true);
    try {
      await multiFactor(user).enroll(
        TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim()),
        "Authenticator app",
      );
      setStep({ kind: "done" });
    } catch {
      setStep({
        kind: "error",
        message: "That code didn't work. Check the time on your phone and try the current code.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Two-step sign-in"
        description="Staff tools need a code from an authenticator app every time you sign in."
      />
      {me.mfa.satisfied ? (
        <Notice tone="success" title="This sign-in used two-step verification">
          <p>You can use the staff tools your roles allow.</p>
        </Notice>
      ) : enrolled.length > 0 ? (
        <Notice tone="caution" title="Sign in again with your code">
          <p>Your authenticator app is set up, but this sign-in didn&apos;t use it.</p>
          <Button onClick={() => void signInAgain()}>Sign in again</Button>
        </Notice>
      ) : null}

      {enrolled.length === 0 ? (
        <Card title="Set up an authenticator app">
          {step.kind === "idle" ? (
            <>
              <p>
                Use an app such as Google Authenticator, Microsoft Authenticator or 1Password.
                You&apos;ll add FleetTrust to it, then type the code it shows.
              </p>
              <Button busy={busy} onClick={() => void start()}>
                Start setup
              </Button>
            </>
          ) : null}
          {step.kind === "secret" ? (
            <form className="stack" onSubmit={(event) => void finish(event, step.secret)}>
              <ol>
                <li>
                  In your app, add an account and enter this key:{" "}
                  <code>{step.secret.secretKey}</code>
                </li>
                <li>
                  On this phone? <a href={step.uri}>Open the setup link</a> instead.
                </li>
                <li>Type the 6-digit code the app shows.</li>
              </ol>
              <TextField
                label="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                }}
              />
              <div>
                <Button type="submit" busy={busy}>
                  Turn on two-step sign-in
                </Button>
              </div>
            </form>
          ) : null}
          {step.kind === "done" ? (
            <Notice tone="success" live="polite" title="Two-step sign-in is on">
              <p>Sign in again with your code to open the staff tools.</p>
              <Button onClick={() => void signInAgain()}>Sign in again</Button>
            </Notice>
          ) : null}
          {step.kind === "error" ? (
            <Notice tone="danger" live="assertive">
              <p>{step.message}</p>
              <div className="cluster">
                <Button variant="secondary" onClick={() => void signInAgain()}>
                  Sign in again
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStep({ kind: "idle" });
                  }}
                >
                  Try again
                </Button>
              </div>
            </Notice>
          ) : null}
        </Card>
      ) : (
        <Card title="Your authenticator app">
          <p>
            Set up {enrolled.map((f) => f.displayName ?? "Authenticator app").join(", ")}. Lost your
            phone? Ask another super admin; support can sign you out everywhere.
          </p>
        </Card>
      )}
    </>
  );
}
