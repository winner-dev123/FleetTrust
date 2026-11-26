"use client";

import { copy, fill } from "@fleettrust/copy";
import { errorMessage } from "@fleettrust/sdk";
import {
  type BillingAccount,
  CAPABILITIES,
  CAPABILITY_KEYS,
  type CapabilityKey,
  formatDate,
  usageLabel,
} from "@fleettrust/types";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { ConfirmAction } from "@/components/confirm-action";
import { SelectField, TextField } from "@/components/field";
import { ErrorNotice, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.admin.billing;

type SubjectType = "user" | "organization";

const capabilityLabel = (key: string) =>
  (CAPABILITY_KEYS as readonly string[]).includes(key)
    ? CAPABILITIES[key as CapabilityKey].label
    : key;

/**
 * Billing operators (ADR-0008): plans are assigned after billing is confirmed outside
 * FleetTrust (the reference is required); the app never takes or checks payments.
 */
export default function BillingPage() {
  const { api } = useSession();
  const plans = useLoad(() => api.billingPlans(), "billing-plans");
  const [type, setType] = useState<SubjectType>("organization");
  const [id, setId] = useState("");
  const [account, setAccount] = useState<BillingAccount | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [planVersionId, setPlanVersionId] = useState("");
  const [reference, setReference] = useState("");
  const [graceDays, setGraceDays] = useState("14");
  const [overrideKey, setOverrideKey] = useState<CapabilityKey>(
    CAPABILITY_KEYS[0] ?? "service_requests.daily",
  );
  const [overrideLimit, setOverrideLimit] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const subject = { type, id: id.trim() };
  const refresh = async () => {
    setAccount(await api.billingAccount(subject));
  };
  const act = async (work: () => Promise<void>, done: string) => {
    setMessage(null);
    try {
      await work();
      await refresh();
      setMessage({ ok: true, text: done });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  };

  const versions =
    plans.status === "ready"
      ? plans.data.flatMap((plan) =>
          plan.versions
            .filter((v) => v.status === "published")
            .map((v) => ({
              value: v.id,
              label: fill(t.planOption, {
                name: plan.name,
                version: v.version,
                audience: plan.audience,
              }),
            })),
        )
      : [];

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {plans.status === "error" ? <ErrorNotice error={plans.error} onRetry={plans.reload} /> : null}
      <Card title={t.find}>
        <form
          className="cluster"
          style={{ alignItems: "flex-end" }}
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            void act(refresh, t.loaded);
          }}
        >
          <SelectField
            label={t.type}
            options={[
              { value: "organization", label: t.organization },
              { value: "user", label: t.person },
            ]}
            value={type}
            onChange={(event) => {
              setType(event.target.value === "user" ? "user" : "organization");
            }}
          />
          <div style={{ flex: "1 1 280px" }}>
            <TextField
              label={t.id}
              value={id}
              onChange={(event) => {
                setId(event.target.value);
              }}
            />
          </div>
          <Button type="submit">{t.load}</Button>
        </form>
      </Card>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {account ? (
        <>
          <Card title={fill(t.currentPlan, { name: account.entitlements.plan.name })}>
            <ul className="list-plain small">
              {account.entitlements.entitlements.map((e) => (
                <li key={e.key}>
                  {fill(t.entitlement, {
                    capability: capabilityLabel(e.key),
                    usage: usageLabel(e.used, e.limit),
                  })}
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t.assignments}>
            <ul className="list-plain">
              {account.assignments.map((a) => (
                <li key={a.id} className="cluster cluster--between">
                  <span>
                    {fill(t.assignment, {
                      plan: a.planCode,
                      version: a.planVersion,
                      date: formatDate(a.startsAt),
                      reference: a.externalReference,
                    })}
                    {a.endedAt ? ` · ${fill(t.ended, { date: formatDate(a.endedAt) })}` : ""}
                  </span>
                  {a.endedAt ? null : (
                    <ConfirmAction
                      label={t.endAssignment}
                      phrase="END"
                      consequence={t.endConsequence}
                      onConfirm={async () => {
                        await api.endPlanAssignment(a.id, null, "plan.end_assignment");
                        await refresh();
                        setMessage({ ok: true, text: t.assignmentEnded });
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
            <form
              className="stack"
              onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
                event.preventDefault();
                void act(async () => {
                  await api.assignPlan({
                    subject,
                    planVersionId,
                    externalReference: reference.trim(),
                    graceDays: Number(graceDays),
                  });
                }, t.assigned);
              }}
            >
              <h3>{t.assignTitle}</h3>
              <SelectField
                label={t.plan}
                options={[{ value: "", label: t.choosePlan }, ...versions]}
                value={planVersionId}
                onChange={(event) => {
                  setPlanVersionId(event.target.value);
                }}
              />
              <TextField
                label={t.reference}
                hint={t.referenceHint}
                value={reference}
                onChange={(event) => {
                  setReference(event.target.value);
                }}
              />
              <TextField
                label={t.graceDays}
                type="number"
                min={0}
                max={90}
                value={graceDays}
                onChange={(event) => {
                  setGraceDays(event.target.value);
                }}
              />
              <div>
                <Button type="submit" disabled={!planVersionId || reference.trim() === ""}>
                  {t.assign}
                </Button>
              </div>
            </form>
          </Card>
          <Card title={t.overrides}>
            <ul className="list-plain">
              {account.overrides
                .filter((o) => o.revokedAt === null)
                .map((o) => (
                  <li key={o.id} className="cluster cluster--between">
                    <span>
                      {fill(t.override, {
                        capability: capabilityLabel(o.key),
                        limit: o.limit ?? t.unlimited,
                        reason: o.reason,
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(async () => {
                          await api.revokeQuotaOverride(o.id);
                        }, t.overrideRemoved)
                      }
                    >
                      {t.removeOverride}
                    </Button>
                  </li>
                ))}
            </ul>
            <form
              className="stack"
              onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
                event.preventDefault();
                void act(async () => {
                  await api.setQuotaOverride({
                    subject,
                    key: overrideKey,
                    limit: overrideLimit.trim() === "" ? null : Number(overrideLimit),
                    reason: overrideReason.trim(),
                  });
                }, t.overrideSet);
              }}
            >
              <h3>{t.setOverrideTitle}</h3>
              <SelectField
                label={t.limit}
                options={CAPABILITY_KEYS.map((key) => ({
                  value: key,
                  label: CAPABILITIES[key].label,
                }))}
                value={overrideKey}
                onChange={(event) => {
                  setOverrideKey(
                    CAPABILITY_KEYS.find((k) => k === event.target.value) ?? overrideKey,
                  );
                }}
              />
              <TextField
                label={t.newLimit}
                hint={t.newLimitHint}
                type="number"
                min={0}
                value={overrideLimit}
                onChange={(event) => {
                  setOverrideLimit(event.target.value);
                }}
              />
              <TextField
                label={t.reason}
                value={overrideReason}
                onChange={(event) => {
                  setOverrideReason(event.target.value);
                }}
              />
              <div>
                <Button type="submit" disabled={overrideReason.trim().length < 3}>
                  {t.setOverride}
                </Button>
              </div>
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
