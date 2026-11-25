"use client";

import { copy, fill } from "@fleettrust/copy";
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

const t = copy.web.app.account;

function PowerUserCard() {
  const { api } = useSession();
  const status = useLoad(() => api.myPowerUser(), "power-user");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status.status === "loading") return <Loading label={t.powerUserLoading} />;
  if (status.status === "error") return <ErrorNotice error={status.error} />;
  const data = status.data;
  const criteria = [
    [t.verifiedIdentity, data.eligibility.criteria.verifiedIdentity],
    [t.accountAge, data.eligibility.criteria.accountAge],
    [t.activity, data.eligibility.criteria.activity],
    [t.goodStanding, data.eligibility.criteria.standing],
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
    <Card title={t.powerUser}>
      <p>{data.meaning}</p>
      {data.status === "active" ? (
        <p>
          <Badge tone="verified">{fill(t.powerUserSince, { date: formatDate(data.since) })}</Badge>{" "}
          {data.shown ? "" : t.notShown}
        </p>
      ) : null}
      {data.status === "revoked" ? (
        <Notice tone="caution">
          <p>
            {data.revokeReason
              ? fill(t.removedOn, { date: formatDate(data.revokedAt), reason: data.revokeReason })
              : fill(t.removedOnNoReason, { date: formatDate(data.revokedAt) })}
          </p>
          {data.appeal ? null : <Link href="/app/appeals">{t.appealDecision}</Link>}
        </Notice>
      ) : null}
      <ul className="list-plain">
        {criteria.map(([label, criterion]) => (
          <li key={label}>
            <Badge tone={criterion.met ? "verified" : "neutral"}>
              {criterion.met ? t.met : t.notYet}
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
              {t.claim}
            </Button>
          </div>
          {!data.eligibility.eligible ? (
            <p className="small muted" style={{ margin: 0 }}>
              {t.claimHint}
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
      setMessage({ ok: true, text: t.saved });
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
      <PageHeader title={t.title} description={fill(t.signedInAs, { email: me.email ?? t.you })} />
      <Card title={t.profile}>
        <form className="stack" onSubmit={(event) => void saveName(event)}>
          <TextField
            label={t.displayName}
            hint={t.displayNameHint}
            maxLength={50}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <div>
            <Button type="submit">{t.save}</Button>
          </div>
          {message ? (
            <Notice tone={message.ok ? "success" : "danger"} live="polite">
              <p>{message.text}</p>
            </Notice>
          ) : null}
        </form>
      </Card>

      <section aria-labelledby="usage-heading" className="stack">
        <h2 id="usage-heading">{t.planAndUsage}</h2>
        {usage.status === "loading" ? <Loading /> : null}
        {usage.status === "error" ? <ErrorNotice error={usage.error} /> : null}
        {usage.status === "ready" ? <UsagePanel usage={usage.data} /> : null}
      </section>

      <PowerUserCard />

      <Card title={t.moderation}>
        <p style={{ margin: 0 }}>
          {t.moderationBefore} <Link href="/app/appeals">{t.moderationLink}</Link>.
        </p>
      </Card>

      <Card title={t.sessions}>
        <div className="cluster">
          <Button variant="ghost" onClick={() => void signOut()}>
            {t.signOut}
          </Button>
          <Button variant="ghost" onClick={() => void signOutEverywhere()}>
            {t.signOutEverywhere}
          </Button>
        </div>
      </Card>

      <PrivacyPanel />
    </>
  );
}
