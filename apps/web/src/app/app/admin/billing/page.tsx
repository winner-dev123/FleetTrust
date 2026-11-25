"use client";

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
              label: `${plan.name} (v${String(v.version)}, ${plan.audience})`,
            })),
        )
      : [];

  return (
    <>
      <PageHeader
        title="Plans and quotas"
        description="Assign plans only after billing is confirmed outside FleetTrust. Every change is audited."
      />
      {plans.status === "error" ? <ErrorNotice error={plans.error} onRetry={plans.reload} /> : null}
      <Card title="Find an account">
        <form
          className="cluster"
          style={{ alignItems: "flex-end" }}
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            void act(refresh, "Account loaded.");
          }}
        >
          <SelectField
            label="Type"
            options={[
              { value: "organization", label: "Organization" },
              { value: "user", label: "Person" },
            ]}
            value={type}
            onChange={(event) => {
              setType(event.target.value === "user" ? "user" : "organization");
            }}
          />
          <div style={{ flex: "1 1 280px" }}>
            <TextField
              label="ID"
              value={id}
              onChange={(event) => {
                setId(event.target.value);
              }}
            />
          </div>
          <Button type="submit">Load</Button>
        </form>
      </Card>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {account ? (
        <>
          <Card title={`Current plan: ${account.entitlements.plan.name}`}>
            <ul className="list-plain small">
              {account.entitlements.entitlements.map((e) => (
                <li key={e.key}>
                  {capabilityLabel(e.key)}: {usageLabel(e.used, e.limit)}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Assignments">
            <ul className="list-plain">
              {account.assignments.map((a) => (
                <li key={a.id} className="cluster cluster--between">
                  <span>
                    {a.planCode} v{a.planVersion} · from {formatDate(a.startsAt)} · ref{" "}
                    {a.externalReference}
                    {a.endedAt ? ` · ended ${formatDate(a.endedAt)}` : ""}
                  </span>
                  {a.endedAt ? null : (
                    <ConfirmAction
                      label="End assignment"
                      phrase="END"
                      consequence="The account moves to its default plan after the grace period."
                      onConfirm={async () => {
                        await api.endPlanAssignment(a.id, null, "plan.end_assignment");
                        await refresh();
                        setMessage({ ok: true, text: "Assignment ended." });
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
                }, "Plan assigned.");
              }}
            >
              <h3>Assign a plan</h3>
              <SelectField
                label="Plan"
                options={[{ value: "", label: "Choose a plan" }, ...versions]}
                value={planVersionId}
                onChange={(event) => {
                  setPlanVersionId(event.target.value);
                }}
              />
              <TextField
                label="External billing reference"
                hint="Contract or invoice reference from the billing system."
                value={reference}
                onChange={(event) => {
                  setReference(event.target.value);
                }}
              />
              <TextField
                label="Grace days after it ends"
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
                  Assign plan
                </Button>
              </div>
            </form>
          </Card>
          <Card title="Quota overrides">
            <ul className="list-plain">
              {account.overrides
                .filter((o) => o.revokedAt === null)
                .map((o) => (
                  <li key={o.id} className="cluster cluster--between">
                    <span>
                      {capabilityLabel(o.key)}: {o.limit === null ? "unlimited" : String(o.limit)} ·{" "}
                      {o.reason}
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(async () => {
                          await api.revokeQuotaOverride(o.id);
                        }, "Override removed.")
                      }
                    >
                      Remove override
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
                }, "Override set.");
              }}
            >
              <h3>Set an override</h3>
              <SelectField
                label="Limit"
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
                label="New limit"
                hint="Leave empty for no limit."
                type="number"
                min={0}
                value={overrideLimit}
                onChange={(event) => {
                  setOverrideLimit(event.target.value);
                }}
              />
              <TextField
                label="Reason"
                value={overrideReason}
                onChange={(event) => {
                  setOverrideReason(event.target.value);
                }}
              />
              <div>
                <Button type="submit" disabled={overrideReason.trim().length < 3}>
                  Set override
                </Button>
              </div>
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
