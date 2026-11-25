"use client";

import { copy, fill } from "@fleettrust/copy";
import { MODERATION_APPEAL_WINDOW_DAYS, type SanctionDto } from "@fleettrust/types";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { TextArea } from "@/components/field";
import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@fleettrust/sdk";
import { formatDate, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.app.appeals;

function AppealForm({ sanction, onFiled }: { sanction: SanctionDto; onFiled: () => void }) {
  const { api } = useSession();
  const [statement, setStatement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (statement.trim().length < 20) {
      setError(t.tooShort);
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
        label={t.yourAppeal}
        hint={t.yourAppealHint}
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
          {t.send}
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
        title={t.title}
        description={fill(t.description, { days: MODERATION_APPEAL_WINDOW_DAYS })}
      />
      {filed ? (
        <Notice tone="success" live="polite">
          <p>{t.sent}</p>
        </Notice>
      ) : null}
      {data.status === "loading" ? <Loading /> : null}
      {data.status === "error" ? <ErrorNotice error={data.error} onRetry={data.reload} /> : null}
      {data.status === "ready" ? (
        <>
          <section aria-labelledby="sanctions-heading" className="stack">
            <h2 id="sanctions-heading">{t.sanctions}</h2>
            {data.data.sanctions.length === 0 ? (
              <EmptyState title={t.noSanctions} />
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
                        <Badge tone="verified">{t.overturned}</Badge>
                      ) : sanction.kind === "suspension" && active ? (
                        <Badge tone="danger">{t.active}</Badge>
                      ) : (
                        <Badge>{t.ended}</Badge>
                      )}{" "}
                      {sanction.kind !== "suspension"
                        ? fill(t.from, { start: formatDate(sanction.startsAt) })
                        : sanction.endsAt
                          ? fill(t.fromUntil, {
                              start: formatDate(sanction.startsAt),
                              end: formatDate(sanction.endsAt),
                            })
                          : fill(t.fromUntilLifted, { start: formatDate(sanction.startsAt) })}
                    </p>
                    <p>{fill(t.reason, { reason: sanction.reason })}</p>
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
            <h2 id="appeals-heading">{t.yourAppeals}</h2>
            {data.data.appeals.length === 0 ? (
              <EmptyState title={t.noAppeals} />
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
                      {fill(t.appealLine, {
                        kind: titleCase(appeal.kind),
                        date: formatDate(appeal.createdAt),
                      })}
                    </p>
                    <p className="small">{appeal.statement}</p>
                    {appeal.decisionReason ? (
                      <p className="small muted">
                        {fill(t.decision, { reason: appeal.decisionReason })}
                      </p>
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
