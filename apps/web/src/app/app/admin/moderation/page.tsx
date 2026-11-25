"use client";

import { errorMessage } from "@fleettrust/sdk";
import { formatDateTime, titleCase } from "@fleettrust/types";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/button";
import { TextArea } from "@/components/field";
import { EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/** Trust and safety moderators: reported content, members and appeals. */
export default function ModerationPage() {
  const { api } = useSession();
  const queue = useLoad(() => api.moderationQueue(), "moderation-queue");
  const appeals = useLoad(() => api.moderationAppeals({ status: "open" }), "moderation-appeals");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function decide(appealId: string, outcome: "upheld" | "overturned") {
    setMessage(null);
    try {
      await api.decideAppeal(appealId, { outcome, reason: reason.trim() });
      setMessage({
        ok: true,
        text: outcome === "overturned" ? "Appeal accepted." : "Appeal refused.",
      });
      setReason("");
      appeals.reload();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  return (
    <>
      <PageHeader title="Moderation" description="Reported content waits here, oldest first." />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <Card title="Queue">
        {queue.status === "loading" ? <Loading /> : null}
        {queue.status === "error" ? (
          <ErrorNotice error={queue.error} onRetry={queue.reload} />
        ) : null}
        {queue.status === "ready" && queue.data.length === 0 ? (
          <EmptyState title="Nothing waiting" />
        ) : null}
        {queue.status === "ready" ? (
          <ul className="list-plain">
            {queue.data.map((item) => (
              <li key={`${item.targetType}-${item.targetId}`}>
                <Link href={`/app/admin/moderation/${item.targetType}/${item.targetId}`}>
                  {item.title}
                </Link>{" "}
                <span className="small muted">
                  {titleCase(item.targetType)} · {String(item.openReports)} open reports ·{" "}
                  {item.reasons.map(titleCase).join(", ")} · since{" "}
                  {formatDateTime(item.waitingSince)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card title="Open appeals">
        {appeals.status === "ready" && appeals.data.length === 0 ? (
          <p className="muted">No open appeals.</p>
        ) : null}
        {appeals.status === "ready" && appeals.data.length > 0 ? (
          <>
            <TextArea
              label="Reason for your decision"
              hint="Shown to the member."
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <ul className="list-plain">
              {appeals.data.map((appeal) => (
                <li key={appeal.id} className="card stack" style={{ gap: 8 }}>
                  <p style={{ margin: 0 }}>{appeal.statement}</p>
                  <p className="small muted" style={{ margin: 0 }}>
                    {titleCase(appeal.kind)} appeal ·{" "}
                    <Link href={`/app/admin/moderation/user/${appeal.userId}`}>member history</Link>{" "}
                    · filed {formatDateTime(appeal.createdAt)}
                  </p>
                  <div className="cluster">
                    <Button
                      disabled={reason.trim().length < 3}
                      onClick={() => void decide(appeal.id, "overturned")}
                    >
                      Accept appeal
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={reason.trim().length < 3}
                      onClick={() => void decide(appeal.id, "upheld")}
                    >
                      Keep the decision
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
    </>
  );
}
