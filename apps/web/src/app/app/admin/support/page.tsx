"use client";

import { errorMessage } from "@fleettrust/sdk";
import { formatDate, formatDateTime, type SupportAccountDto, titleCase } from "@fleettrust/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { TextArea, TextField } from "@/components/field";
import { EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/**
 * Support (support agents): look up account metadata and open a case. Account actions
 * (sign out everywhere, send a sign-in link) happen inside a case, so the audit log shows why.
 * No documents, messages or request contents are shown here (SRS §2.3).
 */
export default function SupportPage() {
  const { api } = useSession();
  const router = useRouter();
  const cases = useLoad(() => api.supportCases("open"), "support-cases");
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState<SupportAccountDto | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setAccount(null);
    try {
      setAccount(await api.supportLookup({ email: email.trim().toLowerCase() }));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function openCase(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setError(null);
    try {
      const created = await api.openSupportCase({ userId: account.userId, reason: reason.trim() });
      router.push(`/app/admin/support/${created.id}`);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return (
    <>
      <PageHeader
        title="Support"
        description="Account metadata and sign-in help, through audited cases."
      />
      <Card title="Find an account">
        <form
          className="cluster"
          style={{ alignItems: "flex-end" }}
          onSubmit={(event) => void lookup(event)}
        >
          <div style={{ flex: "1 1 260px" }}>
            <TextField
              label="Email address"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </div>
          <Button type="submit" busy={busy}>
            Look up
          </Button>
        </form>
      </Card>
      {error ? (
        <Notice tone="danger" live="assertive">
          <p>{error}</p>
        </Notice>
      ) : null}
      {account ? (
        <Card title={account.displayName ?? account.email ?? "Account"}>
          <dl className="small">
            <dt>Email</dt>
            <dd>
              {account.email ?? "none"} ({account.emailVerified ? "verified" : "not verified"})
            </dd>
            <dt>Status</dt>
            <dd>
              {titleCase(account.status)}
              {account.activeSanctions > 0
                ? ` · ${String(account.activeSanctions)} active suspension`
                : ""}
            </dd>
            <dt>Joined</dt>
            <dd>{formatDate(account.createdAt)}</dd>
            <dt>Last seen</dt>
            <dd>
              {formatDateTime(account.lastSeenAt)} via {account.lastSignInProvider ?? "unknown"}
            </dd>
            <dt>Organizations</dt>
            <dd>
              {account.organizations.length === 0
                ? "None"
                : account.organizations.map((o) => `${o.name} (${o.kind}, ${o.role})`).join("; ")}
            </dd>
          </dl>
          <form className="stack" onSubmit={(event) => void openCase(event)}>
            <TextArea
              label="Why are you opening a case?"
              hint="Recorded in the audit log. For example: lost phone, can't receive the sign-in email."
              required
              minLength={5}
              maxLength={1000}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <div>
              <Button type="submit" disabled={reason.trim().length < 5}>
                Open a case
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title="Open cases">
        {cases.status === "loading" ? <Loading /> : null}
        {cases.status === "error" ? (
          <ErrorNotice error={cases.error} onRetry={cases.reload} />
        ) : null}
        {cases.status === "ready" && cases.data.length === 0 ? (
          <EmptyState title="No open cases" />
        ) : null}
        {cases.status === "ready" ? (
          <ul className="list-plain">
            {cases.data.map((c) => (
              <li key={c.id}>
                <Link href={`/app/admin/support/${c.id}`}>{c.subjectEmail ?? c.userId}</Link>{" "}
                <span className="small muted">
                  {c.reason.slice(0, 80)} · opened {formatDateTime(c.openedAt)} by{" "}
                  {c.openedBy ?? "staff"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </>
  );
}
