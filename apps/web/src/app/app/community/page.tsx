"use client";

import { copy, fill, plural } from "@fleettrust/copy";
import Link from "next/link";
import { useState } from "react";

import { Button, ButtonLink } from "@/components/button";
import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@fleettrust/sdk";
import { titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.app.community;

/** Community: your articles, groups, friends and friend requests. */
export default function CommunityPage() {
  const { api } = useSession();
  const data = useLoad(async () => {
    const [articles, groups, friends, requests] = await Promise.all([
      api.myArticles(),
      api.myGroups(),
      api.friends(),
      api.friendRequests("incoming"),
    ]);
    return { articles, groups, friends, requests };
  }, "community");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const respond = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      setMessage({ ok: true, text: done });
      data.reload();
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    }
  };

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={<ButtonLink href="/app/community/write">{t.write}</ButtonLink>}
      />
      {message ? (
        <Notice tone={message.ok ? "success" : "danger"} live="polite">
          <p>{message.text}</p>
        </Notice>
      ) : null}
      {data.status === "loading" ? <Loading /> : null}
      {data.status === "error" ? <ErrorNotice error={data.error} onRetry={data.reload} /> : null}
      {data.status === "ready" ? (
        <>
          {data.data.requests.length > 0 ? (
            <Card title={t.friendRequests}>
              <ul className="list-plain">
                {data.data.requests.map((request) => (
                  <li key={request.id} className="cluster cluster--between">
                    <span>{request.person.displayName}</span>
                    <span className="cluster">
                      <Button
                        onClick={() =>
                          void respond(
                            () => api.acceptFriendRequest(request.id),
                            fill(t.nowFriends, { name: request.person.displayName }),
                          )
                        }
                      >
                        {t.accept}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void respond(() => api.declineFriendRequest(request.id), t.declined)
                        }
                      >
                        {t.decline}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <div className="grid">
            <Card title={t.yourArticles}>
              {data.data.articles.length === 0 ? (
                <p className="muted">{t.noArticles}</p>
              ) : (
                <ul className="list-plain">
                  {data.data.articles.map((article) => (
                    <li key={article.id}>
                      {article.status === "published" ? (
                        <Link href={`/articles/${article.slug}`}>{article.title}</Link>
                      ) : (
                        <span>{article.title}</span>
                      )}{" "}
                      <Badge tone={article.status === "published" ? "verified" : "neutral"}>
                        {titleCase(article.status)}
                      </Badge>
                      {article.moderationNote ? (
                        <span className="small muted" style={{ display: "block" }}>
                          {article.moderationNote}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title={t.yourGroups}>
              {data.data.groups.length === 0 ? (
                <p className="muted">{t.noGroups}</p>
              ) : (
                <ul className="list-plain">
                  {data.data.groups.map((group) => (
                    <li key={group.id}>
                      <strong>{group.name}</strong>{" "}
                      <span className="small muted">
                        {plural(group.memberCount, t.members)}
                        {group.membership?.status === "pending" ? ` · ${t.waitingApproval}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title={t.friends}>
              {data.data.friends.length === 0 ? (
                <EmptyState title={t.noFriends} />
              ) : (
                <ul className="list-plain">
                  {data.data.friends.map((friend) => (
                    <li key={friend.userId}>{friend.displayName}</li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}
