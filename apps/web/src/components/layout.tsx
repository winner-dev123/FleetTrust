import type { ReactNode } from "react";

import { usageLabel } from "@fleettrust/types";

/** Page heading. Also sets the document title (WCAG 2.4.2), hoisted into <head> by React. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="cluster cluster--between page-header" style={{ alignItems: "flex-start" }}>
      <title>{`${title} · FleetTrust`}</title>
      <div>
        <h1>{title}</h1>
        {description ? <p className="muted">{description}</p> : null}
      </div>
      {actions ? <div className="cluster">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  headingLevel = 2,
  muted,
  children,
}: {
  title?: ReactNode;
  headingLevel?: 2 | 3;
  muted?: boolean;
  children?: ReactNode;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={muted ? "card card--muted" : "card"}>
      {title ? <Heading className="card__title">{title}</Heading> : null}
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="muted small">{label}</span>
    </div>
  );
}

/**
 * Usage against a plan limit. A native <meter> carries the value for assistive technology and
 * the text label repeats it, so nothing depends on seeing the bar.
 */
export function UsageMeter({
  label,
  used,
  limit,
  note,
}: {
  label: string;
  used: number;
  limit: number | null;
  note?: ReactNode;
}) {
  const text = usageLabel(used, limit);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="cluster cluster--between">
        <span>{label}</span>
        <span className="muted small">{text}</span>
      </div>
      {limit !== null && limit > 0 ? (
        <meter
          className="meter"
          min={0}
          max={limit}
          low={limit * 0.7}
          high={limit * 0.9}
          optimum={0}
          value={Math.min(used, limit)}
          aria-label={`${label}: ${text}`}
        />
      ) : null}
      {note ? <span className="small muted">{note}</span> : null}
    </div>
  );
}
