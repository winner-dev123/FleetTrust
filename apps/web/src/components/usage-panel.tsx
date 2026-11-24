import { CAPABILITIES, type EntitlementsResponse } from "@fleettrust/types";

import { formatDate } from "@/lib/format";

import { Notice } from "./feedback";
import { UsageMeter } from "./layout";

/**
 * Subscription usage: the plan (activated by staff after external billing, never "paid",
 * ADR-0008) and each limit with what's used. Emergency alerts never appear here: no plan
 * limits them (ADR-0010).
 */
export function UsagePanel({ usage }: { usage: EntitlementsResponse }) {
  const daily = usage.entitlements.filter((entry) => entry.kind === "daily");
  const capacity = usage.entitlements.filter((entry) => entry.kind === "capacity");
  const overLimit = usage.entitlements.filter((entry) => entry.overLimit);

  return (
    <div className="stack stack--lg">
      <section className="card stack" aria-labelledby="plan-heading">
        <h2 id="plan-heading" className="card__title">
          Plan: {usage.plan.name}
        </h2>
        <p style={{ margin: 0 }}>
          {usage.plan.source === "default"
            ? "You're on the free plan."
            : usage.plan.activatedAt
              ? `Activated by FleetTrust staff on ${formatDate(usage.plan.activatedAt)}.`
              : "Assigned by FleetTrust staff."}
          {usage.plan.endsAt ? ` Ends ${formatDate(usage.plan.endsAt)}.` : ""}
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          Plans change limits only. They never buy verification, Power User status or a higher place
          in search, and emergency alerts are never limited. To change your plan, contact
          FleetTrust: billing happens outside the app.
        </p>
      </section>

      {overLimit.length > 0 ? (
        <Notice tone="caution" title="Over a limit after a plan change">
          <p>
            Your existing data is kept, but you can&apos;t add more of:{" "}
            {overLimit.map((entry) => CAPABILITIES[entry.key].label.toLowerCase()).join(", ")}.
          </p>
        </Notice>
      ) : null}

      {daily.length > 0 ? (
        <section className="card stack" aria-labelledby="daily-heading">
          <h2 id="daily-heading" className="card__title">
            Today ({usage.period})
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            Daily limits reset at midnight, {usage.timeZone} time.
          </p>
          {daily.map((entry) => (
            <UsageMeter
              key={entry.key}
              label={CAPABILITIES[entry.key].label}
              used={entry.used}
              limit={entry.limit}
              note={
                entry.source === "override"
                  ? "Limit set by FleetTrust staff"
                  : entry.source === "grace" && entry.graceUntil
                    ? `Previous limit until ${formatDate(entry.graceUntil)}`
                    : undefined
              }
            />
          ))}
        </section>
      ) : null}

      {capacity.length > 0 ? (
        <section className="card stack" aria-labelledby="capacity-heading">
          <h2 id="capacity-heading" className="card__title">
            Totals
          </h2>
          {capacity.map((entry) => (
            <UsageMeter
              key={entry.key}
              label={CAPABILITIES[entry.key].label}
              used={entry.used}
              limit={entry.limit}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
