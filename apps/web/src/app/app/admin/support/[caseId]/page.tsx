"use client";

import { copy, fill } from "@fleettrust/copy";
import { errorMessage } from "@fleettrust/sdk";
import { formatDateTime, titleCase } from "@fleettrust/types";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { ConfirmAction } from "@/components/confirm-action";
import { TextArea } from "@/components/field";
import { Badge, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.admin.supportCase;

const ACTION_LABELS: Record<string, string> = {
  "support.case_opened": t.caseOpened,
  "support.sessions_revoked": t.sessionsRevoked,
  "support.sign_in_link_sent": t.linkSent,
  "support.case_closed": t.caseClosed,
};

/** One support case: account actions are only possible while it's open. */
export default function SupportCasePage(props: PageProps<"/app/admin/support/[caseId]">) {
  const { caseId } = use(props.params);
  const { api } = useSession();
  const supportCase = useLoad(() => api.supportCase(caseId), `support-case-${caseId}`);
  const [resolution, setResolution] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (supportCase.status === "loading") return <Loading />;
  if (supportCase.status === "error")
    return <ErrorNotice error={supportCase.error} onRetry={supportCase.reload} />;
  const data = supportCase.data;
  const open = data.status === "open";

  async function act(work: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage({ ok: true, text: done });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={fill(t.title, { who: data.subjectEmail ?? data.userId })}
        description={data.reason}
      />
      <p>
        <Badge tone={open ? "caution" : "neutral"}>{titleCase(data.status)}</Badge>{" "}
        <span className="small muted">
          {fill(t.opened, { time: formatDateTime(data.openedAt), by: data.openedBy ?? t.staff })}
        </span>
      </p>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {open ? (
        <Card title={t.help}>
          <p className="small">{t.linkNote}</p>
          <div className="cluster">
            <Button
              variant="secondary"
              busy={busy}
              onClick={() =>
                void act(async () => {
                  supportCase.setData(await api.supportSendSignInLink(caseId));
                }, t.linkEmailed)
              }
            >
              {t.emailLink}
            </Button>
            <ConfirmAction
              label={t.signOutEverywhere}
              phrase="SIGN OUT"
              consequence={t.signOutConsequence}
              onConfirm={async () => {
                supportCase.setData(
                  await api.supportRevokeSessions(caseId, "support.revoke_sessions"),
                );
                setMessage({ ok: true, text: t.signedOut });
              }}
            />
          </div>
        </Card>
      ) : (
        <Notice>
          <p>{fill(t.closed, { resolution: data.resolution ?? "" })}</p>
        </Notice>
      )}
      <Card title={t.whatHappened}>
        <ol>
          {data.actions.map((a) => (
            <li key={`${a.action}-${a.at}`}>
              {ACTION_LABELS[a.action] ?? a.action} · {formatDateTime(a.at)}
            </li>
          ))}
        </ol>
      </Card>
      {open ? (
        <Card title={t.closeTitle}>
          <form
            className="stack"
            onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
              event.preventDefault();
              void act(async () => {
                supportCase.setData(await api.closeSupportCase(caseId, resolution.trim()));
              }, t.closedDone);
            }}
          >
            <TextArea
              label={t.resolution}
              required
              minLength={3}
              maxLength={1000}
              value={resolution}
              onChange={(event) => {
                setResolution(event.target.value);
              }}
            />
            <div>
              <Button type="submit" disabled={resolution.trim().length < 3} busy={busy}>
                {t.close}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
