"use client";

import Link from "next/link";

import { Badge, EmptyState, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { formatDateTime, titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

export default function MessagesPage() {
  const { api } = useSession();
  const conversations = useLoad(() => api.conversations(), "conversations");

  return (
    <>
      <PageHeader
        title="Messages"
        description="Conversations with friends, groups and providers about your requests."
      />
      {conversations.status === "loading" ? <Loading /> : null}
      {conversations.status === "error" ? (
        <ErrorNotice error={conversations.error} onRetry={conversations.reload} />
      ) : null}
      {conversations.status === "ready" ? (
        conversations.data.length === 0 ? (
          <EmptyState title="No conversations yet">
            <p>Message a provider from one of your requests, or a friend from Community.</p>
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
                      <Badge tone="caution">{conversation.unread} unread</Badge>
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
