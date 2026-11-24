"use client";

import { CATEGORY_LABELS } from "@fleettrust/types";
import Link from "next/link";

import { ButtonLink } from "@/components/button";
import { Badge, EmptyState, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { formatDate, titleCase } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

export default function RequestsPage() {
  const { api } = useSession();
  const requests = useLoad(() => api.serviceRequests(), "requests");

  return (
    <>
      <PageHeader
        title="Service requests"
        description="Ask providers for quotes. Quotes are indicative; you agree the final price and pay the provider directly."
        actions={<ButtonLink href="/app/requests/new">New request</ButtonLink>}
      />
      {requests.status === "loading" ? <Loading /> : null}
      {requests.status === "error" ? (
        <ErrorNotice error={requests.error} onRetry={requests.reload} />
      ) : null}
      {requests.status === "ready" ? (
        requests.data.length === 0 ? (
          <EmptyState title="No requests yet">
            <p>Describe what you need and nearby providers can send you quotes.</p>
            <ButtonLink href="/app/requests/new">Request a quote</ButtonLink>
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
                    {String(quotes)} active {quotes === 1 ? "quote" : "quotes"} · sent{" "}
                    {formatDate(request.createdAt)}
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
