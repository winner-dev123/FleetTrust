"use client";

import { copy, fill } from "@fleettrust/copy";
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

const t = copy.web.admin.moderationCase;

type Decision = "approve" | "reject" | "hide" | "restore" | "dismiss-reports";
const DECISION_LABELS: Record<Decision, string> = {
  approve: t.approve,
  reject: t.reject,
  hide: t.hide,
  restore: t.restore,
  "dismiss-reports": t.dismissReports,
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
        text: kind === "warning" ? t.warningRecorded : t.suspended,
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
    <Card title={t.standing}>
      <p>
        {fill(t.standingLine, {
          status: titleCase(data.status),
          powerUser: titleCase(data.powerUser),
        })}
      </p>
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      <h3>{t.sanctions}</h3>
      {data.sanctions.length === 0 ? <p className="muted">{t.none}</p> : null}
      <ul className="list-plain">
        {data.sanctions.map((s) => (
          <li key={s.id} className="cluster cluster--between">
            <span>
              {[
                titleCase(s.kind),
                s.reason,
                s.endsAt
                  ? fill(t.fromUntil, {
                      start: formatDateTime(s.startsAt),
                      end: formatDateTime(s.endsAt),
                    })
                  : formatDateTime(s.startsAt),
                s.liftedAt ? fill(t.lifted, { time: formatDateTime(s.liftedAt) }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {s.kind === "suspension" && !s.liftedAt ? (
              <Button
                variant="ghost"
                onClick={() =>
                  void api
                    .liftSanction(s.id, t.liftReason)
                    .then(history.reload, (failure: unknown) => {
                      setMessage({ ok: false, text: errorMessage(failure) });
                    })
                }
              >
                {t.lift}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <form className="stack" onSubmit={(event) => void sanction(event)}>
        <h3>{t.newSanction}</h3>
        <SelectField
          label={t.kind}
          options={[
            { value: "warning", label: t.warning },
            { value: "suspension", label: t.suspension },
          ]}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value === "suspension" ? "suspension" : "warning");
          }}
        />
        {kind === "suspension" ? (
          <TextField
            label={t.days}
            hint={t.daysHint}
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
          label={t.reason}
          hint={t.sanctionReasonHint}
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
            {kind === "suspension" ? t.suspend : t.recordWarning}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** One reported item: what was reported, by how many, and the decision. */
export default function ModerationCasePage(props: PageProps<"/app/admin/moderation/[type]/[id]">) {
  const params = use(props.params);
  const type = REPORT_TARGET_TYPES.find((value) => value === params.type);
  const { api } = useSession();
  const moderationCase = useLoad(
    () => (type ? api.moderationCase(type, params.id) : Promise.reject(new Error("unknown type"))),
    `moderation-case-${params.type}-${params.id}`,
  );
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!type) return <EmptyState title={t.notFound} />;
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
      setMessage({ ok: true, text: fill(t.done, { decision: DECISION_LABELS[decision] }) });
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
        <Card title={t.content}>
          <p style={{ whiteSpace: "pre-line" }}>{data.text}</p>
        </Card>
      ) : null}
      <Card title={fill(t.reports, { count: data.reports.length })}>
        <ul className="list-plain small">
          {data.reports.map((r) => (
            <li key={r.id}>
              {titleCase(r.reason)} · {formatDateTime(r.createdAt)}
              {r.details ? ` · ${r.details}` : ""}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t.decision}>
        <TextArea
          label={t.reason}
          hint={t.decisionHint}
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
        <h3>{t.history}</h3>
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
