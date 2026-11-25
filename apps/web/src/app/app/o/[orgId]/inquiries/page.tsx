"use client";

import { copy, fill } from "@fleettrust/copy";
import { CATEGORY_LABELS } from "@fleettrust/types";
import Link from "next/link";
import { use } from "react";

import { Badge, EmptyState, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { formatDateTime, formatDistance, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.org.inquiries;

/** Quote requests sent to this provider (branch-scoped staff see their branch only). */
export default function InquiriesPage(props: PageProps<"/app/o/[orgId]/inquiries">) {
  const { orgId } = use(props.params);
  const { api } = useSession();
  const inquiries = useLoad(() => api.inquiries(orgId), `inquiries-${orgId}`);

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {inquiries.status === "loading" ? <Loading /> : null}
      {inquiries.status === "error" ? (
        <ErrorNotice error={inquiries.error} onRetry={inquiries.reload} />
      ) : null}
      {inquiries.status === "ready" ? (
        inquiries.data.length === 0 ? (
          <EmptyState title={t.emptyTitle}>
            <p>{t.emptyBody}</p>
          </EmptyState>
        ) : (
          <ul className="list-plain">
            {inquiries.data.map((inquiry) => (
              <li key={inquiry.recipientId} className="card">
                <h2 className="card__title" style={{ fontSize: "var(--font-md)" }}>
                  <Link href={`/app/o/${orgId}/inquiries/${inquiry.recipientId}`}>
                    {CATEGORY_LABELS[inquiry.category]}: {inquiry.description.slice(0, 70)}
                    {inquiry.description.length > 70 ? "…" : ""}
                  </Link>
                </h2>
                <p className="small muted" style={{ margin: 0 }}>
                  <Badge tone={inquiry.recipientStatus === "pending" ? "caution" : "neutral"}>
                    {titleCase(inquiry.recipientStatus)}
                  </Badge>{" "}
                  {titleCase(inquiry.urgency)} · {formatDateTime(inquiry.createdAt)}
                  {inquiry.distanceKm !== null
                    ? ` · ${fill(
                        inquiry.location.approximate ? t.distanceApproximate : t.distance,
                        {
                          distance: formatDistance(inquiry.distanceKm * 1000),
                        },
                      )}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
