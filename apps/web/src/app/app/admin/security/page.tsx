"use client";

import { copy, fill } from "@fleettrust/copy";
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

const t = copy.web.admin.security;

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
        message: requiresRecentLogin(error) ? t.recentLogin : t.startFailed,
      });
    } finally {
      setBusy(false);
    }
  }

  async function finish(event: SubmitEvent<HTMLFormElement>, secret: TotpSecret) {
    event.preventDefault();
    if (!user || !/^\d{6}$/.test(code.trim())) {
      setStep({ kind: "error", message: t.codeInvalid });
      return;
    }
    setBusy(true);
    try {
      await multiFactor(user).enroll(
        TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim()),
        t.appName,
      );
      setStep({ kind: "done" });
    } catch {
      setStep({
        kind: "error",
        message: t.codeRejected,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {me.mfa.satisfied ? (
        <Notice tone="success" title={t.satisfiedTitle}>
          <p>{t.satisfiedBody}</p>
        </Notice>
      ) : enrolled.length > 0 ? (
        <Notice tone="caution" title={t.againTitle}>
          <p>{t.againBody}</p>
          <Button onClick={() => void signInAgain()}>{t.signInAgain}</Button>
        </Notice>
      ) : null}

      {enrolled.length === 0 ? (
        <Card title={t.setUpTitle}>
          {step.kind === "idle" ? (
            <>
              <p>{t.setUpBody}</p>
              <Button busy={busy} onClick={() => void start()}>
                {t.start}
              </Button>
            </>
          ) : null}
          {step.kind === "secret" ? (
            <form className="stack" onSubmit={(event) => void finish(event, step.secret)}>
              <ol>
                <li>
                  {t.stepKey} <code>{step.secret.secretKey}</code>
                </li>
                <li>
                  {t.stepLinkBefore} <a href={step.uri}>{t.stepLink}</a> {t.stepLinkAfter}
                </li>
                <li>{t.stepCode}</li>
              </ol>
              <TextField
                label={t.code}
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
                  {t.turnOn}
                </Button>
              </div>
            </form>
          ) : null}
          {step.kind === "done" ? (
            <Notice tone="success" live="polite" title={t.onTitle}>
              <p>{t.onBody}</p>
              <Button onClick={() => void signInAgain()}>{t.signInAgain}</Button>
            </Notice>
          ) : null}
          {step.kind === "error" ? (
            <Notice tone="danger" live="assertive">
              <p>{step.message}</p>
              <div className="cluster">
                <Button variant="secondary" onClick={() => void signInAgain()}>
                  {t.signInAgain}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStep({ kind: "idle" });
                  }}
                >
                  {t.tryAgain}
                </Button>
              </div>
            </Notice>
          ) : null}
        </Card>
      ) : (
        <Card title={t.yourApp}>
          <p>
            {fill(t.enrolled, {
              apps: enrolled.map((f) => f.displayName ?? t.appName).join(", "),
            })}
          </p>
        </Card>
      )}
    </>
  );
}
