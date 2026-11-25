"use client";

import { copy, fill } from "@fleettrust/copy";
import Link from "next/link";

import { Badge, EmptyState, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { formatDateTime, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.app.messages;

export default function MessagesPage() {
  const { api } = useSession();
  const conversations = useLoad(() => api.conversations(), "conversations");

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {conversations.status === "loading" ? <Loading /> : null}
      {conversations.status === "error" ? (
        <ErrorNotice error={conversations.error} onRetry={conversations.reload} />
      ) : null}
      {conversations.status === "ready" ? (
        conversations.data.length === 0 ? (
          <EmptyState title={t.emptyTitle}>
            <p>{t.emptyBody}</p>
          </EmptyState>
        ) : (
          <ul className="list-plain">
            {conversations.data.map((conversation) => (
              <li key={conversation.id} className="card">
                <h2 className="card__title" style={{ fontSize: "var(--font-md)" }}>
                  <Link href={`/app/messages/${conversation.id}`}>{conversation.title}</Link>
                </h2>
                <p className="small muted" style={{ margin: 0 }}>
                  {titleCase(conversation.kind)}
                  {conversation.lastMessageAt
                    ? ` · ${formatDateTime(conversation.lastMessageAt)}`
                    : ""}
                  {conversation.unread > 0 ? (
                    <>
                      {" "}
                      <Badge tone="caution">{fill(t.unread, { count: conversation.unread })}</Badge>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
