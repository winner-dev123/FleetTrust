"use client";

import { copy, plural } from "@fleettrust/copy";
import { CATEGORY_LABELS } from "@fleettrust/types";
import Link from "next/link";

import { ButtonLink } from "@/components/button";
import { Badge, EmptyState, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { formatDate, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.app.requests;

export default function RequestsPage() {
  const { api } = useSession();
  const requests = useLoad(() => api.serviceRequests(), "requests");

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={<ButtonLink href="/app/requests/new">{t.newRequest}</ButtonLink>}
      />
      {requests.status === "loading" ? <Loading /> : null}
      {requests.status === "error" ? (
        <ErrorNotice error={requests.error} onRetry={requests.reload} />
      ) : null}
      {requests.status === "ready" ? (
        requests.data.length === 0 ? (
          <EmptyState title={t.emptyTitle}>
            <p>{t.emptyBody}</p>
            <ButtonLink href="/app/requests/new">{t.requestQuote}</ButtonLink>
          </EmptyState>
        ) : (
          <ul className="list-plain">
            {requests.data.map((request) => {
              const quotes = request.recipients.flatMap((r) =>
                r.quotes.filter((q) => q.status === "active"),
              ).length;
              return (
                <li key={request.id} className="card">
                  <h2 className="card__title">
                    <Link href={`/app/requests/${request.id}`}>
                      {CATEGORY_LABELS[request.category]}: {request.description.slice(0, 60)}
                      {request.description.length > 60 ? "…" : ""}
                    </Link>
                  </h2>
                  <p className="small muted" style={{ margin: 0 }}>
                    <Badge tone={request.status === "open" ? "caution" : "neutral"}>
                      {titleCase(request.status)}
                    </Badge>{" "}
                    {plural(quotes, t.summary, { date: formatDate(request.createdAt) })}
                  </p>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </>
  );
}
