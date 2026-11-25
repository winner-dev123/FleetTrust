import { copy, fill } from "@fleettrust/copy";
import { CAPABILITIES, type EntitlementsResponse } from "@fleettrust/types";

import { formatDate } from "@fleettrust/types";

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
          {fill(copy.web.usage.plan, { name: usage.plan.name })}
        </h2>
        <p style={{ margin: 0 }}>
          {usage.plan.source === "default"
            ? copy.web.usage.free
            : usage.plan.activatedAt
              ? fill(copy.web.usage.activatedOn, { date: formatDate(usage.plan.activatedAt) })
              : copy.web.usage.assigned}
          {usage.plan.endsAt
            ? ` ${fill(copy.web.usage.endsOn, { date: formatDate(usage.plan.endsAt) })}`
            : ""}
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          {copy.web.usage.plansNote}
        </p>
      </section>

      {overLimit.length > 0 ? (
        <Notice tone="caution" title={copy.web.usage.overLimitTitle}>
          <p>
            {fill(copy.web.usage.overLimitBody, {
              items: overLimit
                .map((entry) => CAPABILITIES[entry.key].label.toLowerCase())
                .join(", "),
            })}
          </p>
        </Notice>
      ) : null}

      {daily.length > 0 ? (
        <section className="card stack" aria-labelledby="daily-heading">
          <h2 id="daily-heading" className="card__title">
            {fill(copy.web.usage.today, { period: usage.period })}
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            {fill(copy.web.usage.resets, { timeZone: usage.timeZone })}
          </p>
          {daily.map((entry) => (
            <UsageMeter
              key={entry.key}
              label={CAPABILITIES[entry.key].label}
              used={entry.used}
              limit={entry.limit}
              note={
                entry.source === "override"
                  ? copy.web.usage.setByStaff
                  : entry.source === "grace" && entry.graceUntil
                    ? fill(copy.web.usage.previousUntil, { date: formatDate(entry.graceUntil) })
                    : undefined
              }
            />
          ))}
        </section>
      ) : null}

      {capacity.length > 0 ? (
        <section className="card stack" aria-labelledby="capacity-heading">
          <h2 id="capacity-heading" className="card__title">
            {copy.web.usage.totals}
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
