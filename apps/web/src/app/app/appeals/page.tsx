"use client";

import { MODERATION_APPEAL_WINDOW_DAYS, type SanctionDto } from "@fleettrust/types";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { TextArea } from "@/components/field";
import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@/lib/errors";
import { formatDate, titleCase } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

function AppealForm({ sanction, onFiled }: { sanction: SanctionDto; onFiled: () => void }) {
  const { api } = useSession();
  const [statement, setStatement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (statement.trim().length < 20) {
      setError("Explain in at least 20 characters why the decision should change.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.fileAppeal({
        kind: "sanction",
        sanctionId: sanction.id,
        statement: statement.trim(),
      });
      onFiled();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
      <TextArea
        label="Your appeal"
        hint="A different moderator will review it."
        required
        maxLength={2000}
        value={statement}
        error={error}
        onChange={(event) => {
          setStatement(event.target.value);
        }}
      />
      <div>
        <Button type="submit" busy={busy}>
          Send appeal
        </Button>
      </div>
    </form>
  );
}

/**
 * Sanctions and appeals. Works while suspended: these are the only API routes a suspended
 * member can use (@AllowSuspended).
 */
export default function AppealsPage() {
  const { api } = useSession();
  const data = useLoad(async () => {
    const [sanctions, appeals] = await Promise.all([api.mySanctions(), api.myAppeals()]);
    return { sanctions, appeals };
  }, "appeals");
  const [filed, setFiled] = useState(false);

  return (
    <>
      <PageHeader
        title="Sanctions and appeals"
        description={`You can appeal a decision within ${String(MODERATION_APPEAL_WINDOW_DAYS)} days. Each decision can be appealed once.`}
      />
      {filed ? (
        <Notice tone="success" live="polite">
          <p>Your appeal was sent. You&apos;ll get a notification when it&apos;s decided.</p>
        </Notice>
      ) : null}
      {data.status === "loading" ? <Loading /> : null}
      {data.status === "error" ? <ErrorNotice error={data.error} onRetry={data.reload} /> : null}
      {data.status === "ready" ? (
        <>
          <section aria-labelledby="sanctions-heading" className="stack">
            <h2 id="sanctions-heading">Sanctions</h2>
            {data.data.sanctions.length === 0 ? (
              <EmptyState title="No warnings or suspensions" />
            ) : (
              data.data.sanctions.map((sanction) => {
                const appealed = data.data.appeals.some((a) => a.sanctionId === sanction.id);
                const active =
                  sanction.liftedAt === null &&
                  (sanction.endsAt === null || new Date(sanction.endsAt) > new Date());
                return (
                  <Card key={sanction.id} title={titleCase(sanction.kind)} headingLevel={3}>
                    <p>
                      {sanction.overturned ? (
                        <Badge tone="verified">Overturned</Badge>
                      ) : sanction.kind === "suspension" && active ? (
                        <Badge tone="danger">Active</Badge>
                      ) : (
                        <Badge>Ended</Badge>
                      )}{" "}
                      From {formatDate(sanction.startsAt)}
                      {sanction.kind === "suspension"
                        ? sanction.endsAt
                          ? ` until ${formatDate(sanction.endsAt)}`
                          : " until lifted"
                        : ""}
                    </p>
                    <p>Reason: {sanction.reason}</p>
                    {!appealed && !sanction.overturned ? (
                      <AppealForm
                        sanction={sanction}
                        onFiled={() => {
                          setFiled(true);
                          data.reload();
                        }}
                      />
                    ) : null}
                  </Card>
                );
              })
            )}
          </section>
          <section aria-labelledby="appeals-heading" className="stack">
            <h2 id="appeals-heading">Your appeals</h2>
            {data.data.appeals.length === 0 ? (
              <EmptyState title="No appeals yet" />
            ) : (
              <ul className="list-plain">
                {data.data.appeals.map((appeal) => (
                  <li key={appeal.id} className="card">
                    <p>
                      <Badge
                        tone={
                          appeal.status === "overturned"
                            ? "verified"
                            : appeal.status === "upheld"
                              ? "caution"
                              : "neutral"
                        }
                      >
                        {titleCase(appeal.status)}
                      </Badge>{" "}
                      {titleCase(appeal.kind)} appeal · {formatDate(appeal.createdAt)}
                    </p>
                    <p className="small">{appeal.statement}</p>
                    {appeal.decisionReason ? (
                      <p className="small muted">Decision: {appeal.decisionReason}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
