"use client";

import { copy, fill, plural } from "@fleettrust/copy";
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

const t = copy.web.admin.verification;

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
        text: decision === "overturn" ? t.accepted : t.refused,
      });
      setAppealReason("");
      appeals.reload();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <Card title={t.cases}>
        <SelectField
          label={t.show}
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
          <EmptyState title={t.nothingHere} />
        ) : null}
        {queue.status === "ready" ? (
          <ul className="list-plain">
            {queue.data.map((c) => (
              <li key={c.id}>
                <Link href={`/app/admin/verification/${c.id}`}>
                  {fill(t.caseLink, {
                    badge: titleCase(c.badgeType),
                    type: c.subject.type,
                    id: c.subject.id.slice(0, 8),
                  })}
                </Link>{" "}
                <span className="small muted">
                  {plural(c.documents.length, t.caseMeta, { time: formatDateTime(c.submittedAt) })}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title={t.openAppeals}>
        {appeals.status === "ready" && appeals.data.length === 0 ? (
          <p className="muted">{t.noAppeals}</p>
        ) : null}
        {appeals.status === "ready" && appeals.data.length > 0 ? (
          <>
            <TextArea
              label={t.appealReason}
              hint={t.appealReasonHint}
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
                      ? fill(t.appealCase, { id: appeal.caseId.slice(0, 8) })
                      : fill(t.appealBadge, { id: appeal.badgeId?.slice(0, 8) ?? "" })}{" "}
                    · {fill(t.filed, { time: formatDateTime(appeal.createdAt) })}
                  </p>
                  <div className="cluster">
                    <Button
                      disabled={appealReason.trim().length < 3}
                      onClick={() => void decideAppeal(appeal.id, "overturn")}
                    >
                      {t.accept}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={appealReason.trim().length < 3}
                      onClick={() => void decideAppeal(appeal.id, "uphold")}
                    >
                      {t.keep}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      <Card title={t.revokeTitle}>
        <p className="small">{t.revokeIntro}</p>
        <div className="grid">
          <TextField
            label={t.badgeId}
            value={badgeId}
            onChange={(event) => {
              setBadgeId(event.target.value);
            }}
          />
          <TextArea
            label={t.reason}
            hint={t.reasonHint}
            value={revokeReason}
            onChange={(event) => {
              setRevokeReason(event.target.value);
            }}
          />
        </div>
        {badgeId.trim() && revokeReason.trim().length >= 3 ? (
          <ConfirmAction
            label={t.revoke}
            phrase="REVOKE"
            consequence={t.revokeConsequence}
            onConfirm={async () => {
              await api.revokeBadge(badgeId.trim(), revokeReason.trim(), "badge.revoke");
              setMessage({ ok: true, text: t.revoked });
              setBadgeId("");
              setRevokeReason("");
            }}
          />
        ) : null}
      </Card>

      <Card title={t.retention}>
        <p className="small">{t.retentionIntro}</p>
        <ConfirmAction
          label={t.purge}
          phrase="PURGE"
          consequence={t.purgeConsequence}
          onConfirm={async () => {
            const { purged } = await api.purgeExpiredDocuments("verification.purge");
            setMessage({ ok: true, text: plural(purged, t.purged) });
          }}
        />
      </Card>
    </>
  );
}
