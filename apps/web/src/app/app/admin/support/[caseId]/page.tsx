"use client";

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

const ACTION_LABELS: Record<string, string> = {
  "support.case_opened": "Case opened",
  "support.sessions_revoked": "Signed out everywhere",
  "support.sign_in_link_sent": "Sign-in link emailed",
  "support.case_closed": "Case closed",
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
        title={`Support case: ${data.subjectEmail ?? data.userId}`}
        description={data.reason}
      />
      <p>
        <Badge tone={open ? "caution" : "neutral"}>{titleCase(data.status)}</Badge>{" "}
        <span className="small muted">
          Opened {formatDateTime(data.openedAt)} by {data.openedBy ?? "staff"}
        </span>
      </p>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {open ? (
        <Card title="Help them sign in">
          <p className="small">
            The link goes only to the account&apos;s own email address; you never see it.
          </p>
          <div className="cluster">
            <Button
              variant="secondary"
              busy={busy}
              onClick={() =>
                void act(async () => {
                  supportCase.setData(await api.supportSendSignInLink(caseId));
                }, "Sign-in link emailed.")
              }
            >
              Email a sign-in link
            </Button>
            <ConfirmAction
              label="Sign out everywhere"
              phrase="SIGN OUT"
              consequence="Every device signed in to this account is signed out. Use it for a lost or stolen phone."
              onConfirm={async () => {
                supportCase.setData(
                  await api.supportRevokeSessions(caseId, "support.revoke_sessions"),
                );
                setMessage({ ok: true, text: "Signed out of every device." });
              }}
            />
          </div>
        </Card>
      ) : (
        <Notice>
          <p>Closed: {data.resolution}</p>
        </Notice>
      )}
      <Card title="What happened">
        <ol>
          {data.actions.map((a) => (
            <li key={`${a.action}-${a.at}`}>
              {ACTION_LABELS[a.action] ?? a.action} · {formatDateTime(a.at)}
            </li>
          ))}
        </ol>
      </Card>
      {open ? (
        <Card title="Close the case">
          <form
            className="stack"
            onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
              event.preventDefault();
              void act(async () => {
                supportCase.setData(await api.closeSupportCase(caseId, resolution.trim()));
              }, "Case closed.");
            }}
          >
            <TextArea
              label="Resolution"
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
                Close case
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
