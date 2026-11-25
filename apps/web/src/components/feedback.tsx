import type { ReactNode } from "react";

import { errorMessage } from "@fleettrust/sdk";

export type Tone = "info" | "caution" | "danger" | "success";

/**
 * A message block. `live` makes screen readers announce it when it appears: "polite" for
 * confirmations, "assertive" for errors that block the task.
 */
export function Notice({
  tone = "info",
  title,
  live,
  children,
}: {
  tone?: Tone;
  title?: ReactNode;
  live?: "polite" | "assertive";
  children?: ReactNode;
}) {
  const role = live === "assertive" ? "alert" : live === "polite" ? "status" : undefined;
  return (
    <div className={`notice notice--${tone}`} role={role}>
      {title ? <strong className="notice__title">{title}</strong> : null}
      {children}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Notice tone="danger" live="assertive">
      <p>{errorMessage(error)}</p>
      {onRetry ? (
        <p>
          <button type="button" className="btn btn--ghost" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : null}
    </Notice>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="muted">
      {label}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card card--muted">
      <p className="card__title">{title}</p>
      {children}
    </div>
  );
}

export type BadgeTone = "verified" | "caution" | "danger" | "neutral";

/** Text-first status label: the meaning is in the words, never only in the colour (WCAG 1.4.1). */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
