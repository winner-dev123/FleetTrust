"use client";

import Link from "next/link";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { Badge, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { PrivacyPanel } from "@/components/privacy-panel";
import { UsagePanel } from "@/components/usage-panel";
import { useAccount } from "@/lib/account";
import { errorMessage } from "@fleettrust/sdk";
import { formatDate } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

function PowerUserCard() {
  const { api } = useSession();
  const status = useLoad(() => api.myPowerUser(), "power-user");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status.status === "loading") return <Loading label="Loading Power User status…" />;
  if (status.status === "error") return <ErrorNotice error={status.error} />;
  const data = status.data;
  const criteria = [
    ["Verified identity", data.eligibility.criteria.verifiedIdentity],
    ["Account age", data.eligibility.criteria.accountAge],
    ["Activity", data.eligibility.criteria.activity],
    ["Good standing", data.eligibility.criteria.standing],
  ] as const;

  async function claim() {
    setBusy(true);
    setMessage(null);
    try {
      status.setData(await api.claimPowerUser());
    } catch (failure) {
      setMessage(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Power User">
      <p>{data.meaning}</p>
      {data.status === "active" ? (
        <p>
          <Badge tone="verified">Power User since {formatDate(data.since)}</Badge>{" "}
          {data.shown ? "" : "(not shown publicly right now: your identity badge isn't current)"}
        </p>
      ) : null}
      {data.status === "revoked" ? (
        <Notice tone="caution">
          <p>
            Removed on {formatDate(data.revokedAt)}: {data.revokeReason}
          </p>
          {data.appeal ? null : <Link href="/app/appeals">Appeal this decision</Link>}
        </Notice>
      ) : null}
      <ul className="list-plain">
        {criteria.map(([label, criterion]) => (
          <li key={label}>
            <Badge tone={criterion.met ? "verified" : "neutral"}>
              {criterion.met ? "Met" : "Not yet"}
            </Badge>{" "}
            <strong>{label}</strong>
            <span className="small muted" style={{ display: "block" }}>
              {criterion.detail}
            </span>
          </li>
        ))}
      </ul>
      {data.status !== "active" ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <div>
            <Button onClick={() => void claim()} disabled={!data.eligibility.eligible} busy={busy}>
              Claim Power User
            </Button>
          </div>
          {!data.eligibility.eligible ? (
            <p className="small muted" style={{ margin: 0 }}>
              You can claim it once every rule is met.
            </p>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <Notice tone="danger" live="assertive">
          <p>{message}</p>
        </Notice>
      ) : null}
    </Card>
  );
}

/** Profile, sign-out, plan usage and Power User status. */
export default function AccountPage() {
  const { api, signOut } = useSession();
  const { me, refresh } = useAccount();
  const [name, setName] = useState(me.displayName ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const usage = useLoad(() => api.myEntitlements(), "my-usage");

  async function saveName(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api.updateMe({ displayName: name.trim() === "" ? null : name.trim() });
      await refresh();
      setMessage({ ok: true, text: "Saved." });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  async function signOutEverywhere() {
    try {
      await api.revokeAllSessions();
    } finally {
      await signOut();
    }
  }

  return (
    <>
      <PageHeader title="Account and usage" description={`Signed in as ${me.email ?? "you"}`} />
      <Card title="Profile">
        <form className="stack" onSubmit={(event) => void saveName(event)}>
          <TextField
            label="Display name"
            hint="Shown when you post, comment or join groups."
            maxLength={50}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <div>
            <Button type="submit">Save</Button>
          </div>
          {message ? (
            <Notice tone={message.ok ? "success" : "danger"} live="polite">
              <p>{message.text}</p>
            </Notice>
          ) : null}
        </form>
      </Card>

      <section aria-labelledby="usage-heading" className="stack">
        <h2 id="usage-heading">Plan and usage</h2>
        {usage.status === "loading" ? <Loading /> : null}
        {usage.status === "error" ? <ErrorNotice error={usage.error} /> : null}
        {usage.status === "ready" ? <UsagePanel usage={usage.data} /> : null}
      </section>

      <PowerUserCard />

      <Card title="Moderation">
        <p style={{ margin: 0 }}>
          See warnings or suspensions and appeal decisions on{" "}
          <Link href="/app/appeals">sanctions and appeals</Link>.
        </p>
      </Card>

      <Card title="Sessions">
        <div className="cluster">
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
          <Button variant="ghost" onClick={() => void signOutEverywhere()}>
            Sign out on all devices
          </Button>
        </div>
      </Card>

      <PrivacyPanel />
    </>
  );
}
