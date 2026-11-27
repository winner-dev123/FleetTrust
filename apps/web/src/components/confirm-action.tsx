"use client";

import { copy, fill } from "@fleettrust/copy";
import { errorMessage } from "@fleettrust/sdk";
import { type SubmitEvent, useId, useState } from "react";

import { Button } from "./button";
import { TextField } from "./field";
import { Notice } from "./feedback";

/**
 * Sensitive staff actions (Prompt 26): the person types a phrase (usually the thing being
 * changed) before the action button works. Only then does the console send the action's
 * confirmation to the API, which refuses these actions without it.
 */
export function ConfirmAction({
  label,
  phrase,
  consequence,
  undoNote = copy.web.controls.cannotBeUndone,
  onConfirm,
}: {
  /** Button text, e.g. "Revoke badge". */
  label: string;
  /** What must be typed, e.g. "REVOKE" or an email address. */
  phrase: string;
  /** What happens, in one or two sentences. */
  consequence: string;
  /** Whether and how it can be reversed. Defaults to "This can't be undone." */
  undoNote?: string;
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
        {fill(copy.web.controls.confirmQuestion, { label })}
      </h3>
      <p style={{ margin: 0 }}>
        {consequence} <strong>{undoNote}</strong>
      </p>
      <TextField
        label={fill(copy.web.controls.typeToConfirm, { phrase })}
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
          {copy.common.cancel}
        </Button>
      </div>
    </form>
  );
}
