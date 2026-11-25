"use client";

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
      <Notice tone="danger" live="assertive" title="Two-step sign-in">
        <p>
          This account uses a second step this site can&apos;t ask for. Contact a FleetTrust super
          admin.
        </p>
      </Notice>
    );
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resolve(code.trim());
    } catch {
      setError("That code didn't work. Codes change every 30 seconds; try the current one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
      <h2>Two-step sign-in</h2>
      <p>Open your authenticator app and enter the code for FleetTrust.</p>
      <TextField
        label="6-digit code"
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
          Verify
        </Button>
      </div>
    </form>
  );
}
