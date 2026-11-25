"use client";

import { copy } from "@fleettrust/copy";
import { type SubmitEvent, useState } from "react";

import { Button } from "./button";
import { TextField } from "./field";
import { Notice } from "./feedback";

/**
 * The second step of signing in for accounts with two-step sign-in (FleetTrust staff): a
 * six-digit code from an authenticator app. `resolve` finishes the Firebase sign-in.
 */
export function MfaChallenge({
  available,
  resolve,
}: {
  /** False when the account's second factor isn't an authenticator app. */
  available: boolean;
  resolve: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!available) {
    return (
      <Notice tone="danger" live="assertive" title={copy.web.mfa.title}>
        <p>{copy.web.mfa.unavailable}</p>
      </Notice>
    );
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError(copy.web.mfa.codeInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resolve(code.trim());
    } catch {
      setError(copy.web.mfa.codeRejected);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
      <h2>{copy.web.mfa.title}</h2>
      <p>{copy.web.mfa.intro}</p>
      <TextField
        label={copy.web.mfa.codeLabel}
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        error={error}
        onChange={(event) => {
          setCode(event.target.value);
        }}
      />
      <div>
        <Button type="submit" busy={busy}>
          {copy.web.mfa.verify}
        </Button>
      </div>
    </form>
  );
}
