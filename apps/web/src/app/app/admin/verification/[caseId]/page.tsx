"use client";

import { errorMessage } from "@fleettrust/sdk";
import { formatDateTime, titleCase } from "@fleettrust/types";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { SelectField, TextArea } from "@/components/field";
import { Badge, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

type Decision = "approve" | "reject" | "request_changes";
const DECISIONS: readonly { value: Decision; label: string }[] = [
  { value: "approve", label: "Approve (grant the badge)" },
  { value: "request_changes", label: "Ask for changes" },
  { value: "reject", label: "Reject" },
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
      setMessage({ ok: true, text: "Decision recorded." });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`${titleCase(data.badgeType)} verification`}
        description={`${titleCase(data.subject.type)} ${data.subject.id} · submitted ${formatDateTime(data.submittedAt)}`}
      />
      <p>
        <Badge tone={decidable ? "caution" : "neutral"}>{titleCase(data.status)}</Badge>
      </p>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <Card title="Documents">
        <p className="small muted">
          Each view uses a five-minute, single-use link and is recorded in the audit log.
        </p>
        <ul className="list-plain">
          {data.documents.map((doc) => (
            <li key={doc.id} className="cluster cluster--between">
              <span>
                {titleCase(doc.kind)} · {titleCase(doc.status)}
                {doc.scanResult ? ` · scan: ${doc.scanResult}` : ""}
              </span>
              {doc.status === "available" ? (
                <Button variant="secondary" onClick={() => void openDocument(doc.id)}>
                  View {titleCase(doc.kind)}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      {decidable ? (
        <Card title="Decision">
          <form className="stack" onSubmit={(event) => void decide(event)}>
            <SelectField
              label="Decision"
              options={DECISIONS}
              value={decision}
              onChange={(event) => {
                setDecision(
                  DECISIONS.find((d) => d.value === event.target.value)?.value ?? "approve",
                );
              }}
            />
            <TextArea
              label={
                decision === "approve"
                  ? "Note (optional, internal)"
                  : "Reason (shown to the applicant)"
              }
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
                Record decision
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Notice>
          <p>
            Decided {formatDateTime(data.decidedAt)}
            {data.decisionReason ? `: ${data.decisionReason}` : "."}
          </p>
        </Notice>
      )}
    </>
  );
}
