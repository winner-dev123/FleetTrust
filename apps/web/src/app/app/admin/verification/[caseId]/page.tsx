"use client";

import { copy, fill } from "@fleettrust/copy";
import { errorMessage } from "@fleettrust/sdk";
import { formatDateTime, titleCase } from "@fleettrust/types";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { SelectField, TextArea } from "@/components/field";
import { Badge, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.admin.reviewCase;

type Decision = "approve" | "reject" | "request_changes";
const DECISIONS: readonly { value: Decision; label: string }[] = [
  { value: "approve", label: t.approve },
  { value: "request_changes", label: t.requestChanges },
  { value: "reject", label: t.reject },
];

/** One verification case: documents (opened through single-use, audited links) and the decision. */
export default function ReviewCasePage(props: PageProps<"/app/admin/verification/[caseId]">) {
  const { caseId } = use(props.params);
  const { api } = useSession();
  const reviewCase = useLoad(() => api.reviewCase(caseId), `review-case-${caseId}`);
  const [decision, setDecision] = useState<Decision>("approve");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (reviewCase.status === "loading") return <Loading />;
  if (reviewCase.status === "error")
    return <ErrorNotice error={reviewCase.error} onRetry={reviewCase.reload} />;
  const data = reviewCase.data;
  const decidable = data.status === "submitted";

  async function openDocument(documentId: string) {
    try {
      const { url } = await api.documentAccess(documentId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  async function decide(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const body =
        decision === "approve"
          ? { decision, ...(reason.trim() ? { note: reason.trim() } : {}) }
          : { decision, reason: reason.trim() };
      reviewCase.setData(await api.decideReviewCase(caseId, body));
      setMessage({ ok: true, text: t.recorded });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={fill(t.title, { badge: titleCase(data.badgeType) })}
        description={fill(t.description, {
          type: titleCase(data.subject.type),
          id: data.subject.id,
          time: formatDateTime(data.submittedAt),
        })}
      />
      <p>
        <Badge tone={decidable ? "caution" : "neutral"}>{titleCase(data.status)}</Badge>
      </p>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <Card title={t.documents}>
        <p className="small muted">{t.documentsNote}</p>
        <ul className="list-plain">
          {data.documents.map((doc) => (
            <li key={doc.id} className="cluster cluster--between">
              <span>
                {titleCase(doc.kind)} · {titleCase(doc.status)}
                {doc.scanResult ? ` · ${fill(t.scan, { result: doc.scanResult })}` : ""}
              </span>
              {doc.status === "available" ? (
                <Button variant="secondary" onClick={() => void openDocument(doc.id)}>
                  {fill(t.view, { kind: titleCase(doc.kind) })}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      {decidable ? (
        <Card title={t.decision}>
          <form className="stack" onSubmit={(event) => void decide(event)}>
            <SelectField
              label={t.decision}
              options={DECISIONS}
              value={decision}
              onChange={(event) => {
                setDecision(
                  DECISIONS.find((d) => d.value === event.target.value)?.value ?? "approve",
                );
              }}
            />
            <TextArea
              label={decision === "approve" ? t.note : t.reason}
              maxLength={1000}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <div>
              <Button
                type="submit"
                busy={busy}
                disabled={decision !== "approve" && reason.trim().length < 3}
              >
                {t.record}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Notice>
          <p>
            {data.decisionReason
              ? fill(t.decidedWithReason, {
                  time: formatDateTime(data.decidedAt),
                  reason: data.decisionReason,
                })
              : fill(t.decided, { time: formatDateTime(data.decidedAt) })}
          </p>
        </Notice>
      )}
    </>
  );
}
