"use client";

import { errorMessage } from "@fleettrust/sdk";
import { formatDateTime, titleCase } from "@fleettrust/types";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/button";
import { ConfirmAction } from "@/components/confirm-action";
import { SelectField, TextArea, TextField } from "@/components/field";
import { EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const STATUSES = ["submitted", "changes_requested", "approved", "rejected", "withdrawn"] as const;

/** Verification reviewers: the case queue, appeals, badge revocation and the document purge. */
export default function VerificationPage() {
  const { api } = useSession();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("submitted");
  const queue = useLoad(() => api.reviewQueue(status), `review-queue-${status}`);
  const appeals = useLoad(() => api.reviewAppeals("open"), "review-appeals");
  const [badgeId, setBadgeId] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [appealReason, setAppealReason] = useState("");

  async function decideAppeal(id: string, decision: "uphold" | "overturn") {
    setMessage(null);
    try {
      await api.decideReviewAppeal(id, decision, appealReason.trim());
      setMessage({
        ok: true,
        text: decision === "overturn" ? "Appeal accepted." : "Appeal refused.",
      });
      setAppealReason("");
      appeals.reload();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  return (
    <>
      <PageHeader
        title="Verification"
        description="Decide on evidence. You can't review cases you opened yourself."
      />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <Card title="Cases">
        <SelectField
          label="Show"
          options={STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
          value={status}
          onChange={(event) => {
            setStatus(STATUSES.find((s) => s === event.target.value) ?? "submitted");
          }}
        />
        {queue.status === "loading" ? <Loading /> : null}
        {queue.status === "error" ? (
          <ErrorNotice error={queue.error} onRetry={queue.reload} />
        ) : null}
        {queue.status === "ready" && queue.data.length === 0 ? (
          <EmptyState title="Nothing here" />
        ) : null}
        {queue.status === "ready" ? (
          <ul className="list-plain">
            {queue.data.map((c) => (
              <li key={c.id}>
                <Link href={`/app/admin/verification/${c.id}`}>
                  {titleCase(c.badgeType)} badge for {c.subject.type} {c.subject.id.slice(0, 8)}
                </Link>{" "}
                <span className="small muted">
                  {c.documents.length} documents · submitted {formatDateTime(c.submittedAt)}
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
              hint="Shown to the person. Needed for either decision."
              value={appealReason}
              onChange={(event) => {
                setAppealReason(event.target.value);
              }}
            />
            <ul className="list-plain">
              {appeals.data.map((appeal) => (
                <li key={appeal.id} className="card stack" style={{ gap: 8 }}>
                  <p style={{ margin: 0 }}>{appeal.statement}</p>
                  <p className="small muted" style={{ margin: 0 }}>
                    {appeal.caseId
                      ? `Case ${appeal.caseId.slice(0, 8)}`
                      : `Badge ${appeal.badgeId?.slice(0, 8) ?? ""}`}{" "}
                    · filed {formatDateTime(appeal.createdAt)}
                  </p>
                  <div className="cluster">
                    <Button
                      disabled={appealReason.trim().length < 3}
                      onClick={() => void decideAppeal(appeal.id, "overturn")}
                    >
                      Accept appeal
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={appealReason.trim().length < 3}
                      onClick={() => void decideAppeal(appeal.id, "uphold")}
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

      <Card title="Revoke a badge">
        <p className="small">
          For a badge that should no longer stand (for example a licence reported suspended).
        </p>
        <div className="grid">
          <TextField
            label="Badge ID"
            value={badgeId}
            onChange={(event) => {
              setBadgeId(event.target.value);
            }}
          />
          <TextArea
            label="Reason"
            hint="Shown to the badge holder, who can appeal."
            value={revokeReason}
            onChange={(event) => {
              setRevokeReason(event.target.value);
            }}
          />
        </div>
        {badgeId.trim() && revokeReason.trim().length >= 3 ? (
          <ConfirmAction
            label="Revoke badge"
            phrase="REVOKE"
            consequence="The badge stops showing as verified immediately. The holder must verify again or appeal."
            onConfirm={async () => {
              await api.revokeBadge(badgeId.trim(), revokeReason.trim(), "badge.revoke");
              setMessage({ ok: true, text: "Badge revoked." });
              setBadgeId("");
              setRevokeReason("");
            }}
          />
        ) : null}
      </Card>

      <Card title="Document retention">
        <p className="small">
          Deletes stored documents whose retention period has ended (this also runs on a schedule).
        </p>
        <ConfirmAction
          label="Delete expired documents now"
          phrase="PURGE"
          consequence="Expired verification documents are permanently deleted from storage."
          onConfirm={async () => {
            const { purged } = await api.purgeExpiredDocuments("verification.purge");
            setMessage({ ok: true, text: `${String(purged)} documents deleted.` });
          }}
        />
      </Card>
    </>
  );
}
