"use client";

import { copy, fill } from "@fleettrust/copy";
import { errorMessage } from "@fleettrust/sdk";
import { type AuditEntryDto, formatDateTime } from "@fleettrust/types";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { EmptyState, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import {
  type AuditFilters as Filters,
  auditQueryFrom,
  EMPTY_AUDIT_FILTERS as EMPTY,
} from "@/lib/admin";
import { useSession } from "@/lib/session";

const t = copy.web.admin.audit;

/**
 * Audit search. Each staff role sees only its own area (super admins see everything), and
 * every search is itself recorded.
 */
export default function AuditPage() {
  const { api } = useSession();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [items, setItems] = useState<AuditEntryDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [scope, setScope] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(next?: string) {
    setBusy(true);
    setError(null);
    try {
      const page = await api.auditSearch(auditQueryFrom(filters, next));
      setItems((current) => (next && current ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setScope(page.scope === "all" ? t.everything : page.scope.join(", "));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof Filters, label: string, extra: object = {}) => (
    <TextField
      label={label}
      value={filters[key]}
      onChange={(event) => {
        setFilters({ ...filters, [key]: event.target.value });
      }}
      {...extra}
    />
  );

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <Card title={t.search}>
        <form
          className="stack"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            void run();
          }}
        >
          <div className="grid">
            {field("action", t.action, { hint: t.actionHint })}
            {field("actorEmail", t.doneBy, { type: "email" })}
            {field("targetType", t.targetType, { hint: t.targetTypeHint })}
            {field("targetId", t.targetId)}
            {field("from", t.from, { type: "date" })}
            {field("to", t.to, { type: "date" })}
          </div>
          <div className="cluster">
            <Button type="submit" busy={busy && items === null}>
              {t.submit}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setFilters(EMPTY);
              }}
            >
              {t.clear}
            </Button>
          </div>
        </form>
      </Card>
      {error ? (
        <Notice tone="danger" live="assertive">
          <p>{error}</p>
        </Notice>
      ) : null}
      {items !== null ? (
        <>
          <p className="small muted">{fill(t.scope, { scope })}</p>
          {items.length === 0 ? (
            <EmptyState title={t.empty} />
          ) : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t.entries}>
              <table className="table">
                <caption className="visually-hidden">{t.caption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t.when}</th>
                    <th scope="col">{t.action}</th>
                    <th scope="col">{t.by}</th>
                    <th scope="col">{t.target}</th>
                    <th scope="col">{t.details}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDateTime(entry.occurredAt)}</td>
                      <td>
                        <code>{entry.action}</code>
                      </td>
                      <td>{entry.actor?.email ?? entry.actorType}</td>
                      <td>
                        {entry.targetType}
                        {entry.targetId ? (
                          <span className="small muted" style={{ display: "block" }}>
                            {entry.targetId}
                          </span>
                        ) : null}
                      </td>
                      <td className="small">
                        <code>{JSON.stringify(entry.metadata)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cursor ? (
            <Button variant="secondary" busy={busy} onClick={() => void run(cursor)}>
              {t.older}
            </Button>
          ) : null}
        </>
      ) : null}
    </>
  );
}
