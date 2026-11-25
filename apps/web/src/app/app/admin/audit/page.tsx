"use client";

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
      setScope(page.scope === "all" ? "everything" : page.scope.join(", "));
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
      <PageHeader
        title="Audit log"
        description="Who did what, and when. Searches are recorded too."
      />
      <Card title="Search">
        <form
          className="stack"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            void run();
          }}
        >
          <div className="grid">
            {field("action", "Action", {
              hint: 'Exact, or a family ending in "." such as verification.',
            })}
            {field("actorEmail", "Done by (email)", { type: "email" })}
            {field("targetType", "Target type", { hint: "For example user, support_case" })}
            {field("targetId", "Target ID")}
            {field("from", "From", { type: "date" })}
            {field("to", "To", { type: "date" })}
          </div>
          <div className="cluster">
            <Button type="submit" busy={busy && items === null}>
              Search
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setFilters(EMPTY);
              }}
            >
              Clear
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
          <p className="small muted">Your roles can search: {scope}.</p>
          {items.length === 0 ? (
            <EmptyState title="No matching entries" />
          ) : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Audit entries">
              <table className="table">
                <caption className="visually-hidden">Audit entries, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Action</th>
                    <th scope="col">By</th>
                    <th scope="col">Target</th>
                    <th scope="col">Details</th>
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
              Load older entries
            </Button>
          ) : null}
        </>
      ) : null}
    </>
  );
}
