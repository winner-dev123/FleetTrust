"use client";

import { errorMessage } from "@fleettrust/sdk";
import {
  formatDateTime,
  REPORT_TARGET_TYPES,
  type ReportTargetType,
  titleCase,
} from "@fleettrust/types";
import { type SubmitEvent, use, useState } from "react";

import { Button } from "@/components/button";
import { SelectField, TextArea, TextField } from "@/components/field";
import { EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

type Decision = "approve" | "reject" | "hide" | "restore" | "dismiss-reports";
const DECISION_LABELS: Record<Decision, string> = {
  approve: "Approve",
  reject: "Reject",
  hide: "Hide",
  restore: "Restore",
  "dismiss-reports": "Dismiss reports",
};

/** A member's standing: sanctions, appeals and decisions about their content. */
function MemberPanel({ userId }: { userId: string }) {
  const { api } = useSession();
  const history = useLoad(() => api.memberHistory(userId), `member-history-${userId}`);
  const [kind, setKind] = useState<"warning" | "suspension">("warning");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function sanction(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      await api.sanctionMember(
        userId,
        kind === "warning"
          ? { kind, reason: reason.trim() }
          : { kind, reason: reason.trim(), days: days.trim() === "" ? null : Number(days) },
      );
      setMessage({
        ok: true,
        text: kind === "warning" ? "Warning recorded." : "Member suspended.",
      });
      setReason("");
      history.reload();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  if (history.status === "loading") return <Loading />;
  if (history.status === "error")
    return <ErrorNotice error={history.error} onRetry={history.reload} />;
  const data = history.data;
  return (
    <Card title="Member standing">
      <p>
        {titleCase(data.status)} · Power User: {titleCase(data.powerUser)}
      </p>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <h3>Sanctions</h3>
      {data.sanctions.length === 0 ? <p className="muted">None.</p> : null}
      <ul className="list-plain">
        {data.sanctions.map((s) => (
          <li key={s.id} className="cluster cluster--between">
            <span>
              {titleCase(s.kind)} · {s.reason} · {formatDateTime(s.startsAt)}
              {s.endsAt ? ` until ${formatDateTime(s.endsAt)}` : ""}
              {s.liftedAt ? ` · lifted ${formatDateTime(s.liftedAt)}` : ""}
            </span>
            {s.kind === "suspension" && !s.liftedAt ? (
              <Button
                variant="ghost"
                onClick={() =>
                  void api
                    .liftSanction(s.id, "Lifted by a moderator")
                    .then(history.reload, (failure: unknown) => {
                      setMessage({ ok: false, text: errorMessage(failure) });
                    })
                }
              >
                Lift suspension
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <form className="stack" onSubmit={(event) => void sanction(event)}>
        <h3>New sanction</h3>
        <SelectField
          label="Kind"
          options={[
            { value: "warning", label: "Warning" },
            { value: "suspension", label: "Suspension" },
          ]}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value === "suspension" ? "suspension" : "warning");
          }}
        />
        {kind === "suspension" ? (
          <TextField
            label="Days"
            hint="Leave empty to suspend until lifted."
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(event) => {
              setDays(event.target.value);
            }}
          />
        ) : null}
        <TextArea
          label="Reason"
          hint="Shown to the member, who can appeal."
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <div>
          <Button
            type="submit"
            variant={kind === "suspension" ? "danger" : "primary"}
            disabled={reason.trim().length < 3}
          >
            {kind === "suspension" ? "Suspend member" : "Record warning"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** One reported item: what was reported, by how many, and the decision. */
export default function ModerationCasePage(props: PageProps<"/app/admin/moderation/[type]/[id]">) {
  const params = use(props.params);
  const type = REPORT_TARGET_TYPES.find((t) => t === params.type);
  const { api } = useSession();
  const moderationCase = useLoad(
    () => (type ? api.moderationCase(type, params.id) : Promise.reject(new Error("unknown type"))),
    `moderation-case-${params.type}-${params.id}`,
  );
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!type) return <EmptyState title="Page not found" />;
  if (moderationCase.status === "loading") return <Loading />;
  if (moderationCase.status === "error")
    return <ErrorNotice error={moderationCase.error} onRetry={moderationCase.reload} />;
  const data = moderationCase.data;
  const decisions: Decision[] =
    type === "user"
      ? ["dismiss-reports"]
      : ["approve", "reject", "hide", "restore", "dismiss-reports"];

  async function decide(decision: Decision, target: ReportTargetType) {
    setMessage(null);
    try {
      moderationCase.setData(
        await api.moderate(target, params.id, decision, reason.trim() || null),
      );
      setMessage({ ok: true, text: `${DECISION_LABELS[decision]}: done.` });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  }

  return (
    <>
      <PageHeader
        title={data.title}
        description={`${titleCase(type)} · ${titleCase(data.status)}`}
      />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {data.text ? (
        <Card title="Content">
          <p style={{ whiteSpace: "pre-line" }}>{data.text}</p>
        </Card>
      ) : null}
      <Card title={`Reports (${String(data.reports.length)})`}>
        <ul className="list-plain small">
          {data.reports.map((r) => (
            <li key={r.id}>
              {titleCase(r.reason)} · {formatDateTime(r.createdAt)}
              {r.details ? ` · ${r.details}` : ""}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Decision">
        <TextArea
          label="Reason"
          hint="Recorded with the decision; shown to the author when content is rejected or hidden."
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <div className="cluster">
          {decisions.map((d) => (
            <Button
              key={d}
              variant={d === "hide" || d === "reject" ? "danger" : "secondary"}
              onClick={() => void decide(d, type)}
            >
              {DECISION_LABELS[d]}
            </Button>
          ))}
        </div>
        <h3>History</h3>
        <ul className="list-plain small">
          {data.actions.map((a) => (
            <li key={a.id}>
              {titleCase(a.action)} · {formatDateTime(a.createdAt)}
              {a.reason ? ` · ${a.reason}` : ""}
            </li>
          ))}
        </ul>
      </Card>
      <MemberPanel userId={data.authorUserId} />
    </>
  );
}
