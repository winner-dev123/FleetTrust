"use client";

import { errorMessage } from "@fleettrust/sdk";
import { type SubmitEvent, useId, useState } from "react";

import { Button } from "./button";
import { TextField } from "./field";
import { Notice } from "./feedback";

/**
 * Irreversible staff actions (Prompt 26): the person types a phrase (usually the thing being
 * changed) before the action button works. Only then does the console send the action's
 * confirmation to the API, which refuses irreversible actions without it.
 */
export function ConfirmAction({
  label,
  phrase,
  consequence,
  onConfirm,
}: {
  /** Button text, e.g. "Revoke badge". */
  label: string;
  /** What must be typed, e.g. "REVOKE" or an email address. */
  phrase: string;
  /** What happens, in one or two sentences. */
  consequence: string;
  onConfirm: () => Promise<void>;
}) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button
        variant="danger"
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}…
      </Button>
    );
  }

  async function confirm(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typed.trim() !== phrase) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
      setTyped("");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="card stack"
      role="alertdialog"
      aria-labelledby={headingId}
      onSubmit={(event) => void confirm(event)}
    >
      <h3 id={headingId} className="card__title">
        {label}?
      </h3>
      <p style={{ margin: 0 }}>
        {consequence} <strong>This can&apos;t be undone.</strong>
      </p>
      <TextField
        label={`Type ${phrase} to confirm`}
        required
        autoComplete="off"
        value={typed}
        autoFocus
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      {error ? (
        <Notice tone="danger" live="assertive">
          <p>{error}</p>
        </Notice>
      ) : null}
      <div className="cluster">
        <Button type="submit" variant="danger" busy={busy} disabled={typed.trim() !== phrase}>
          {label}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
