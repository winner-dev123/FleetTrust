"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, ButtonLink } from "@/components/button";
import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { errorMessage } from "@fleettrust/sdk";
import { titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

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
        title="Community"
        description="Share experience with other drivers, fleets and providers. Posts are opinions, not verified reviews."
        actions={<ButtonLink href="/app/community/write">Write an article</ButtonLink>}
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
            <Card title="Friend requests">
              <ul className="list-plain">
                {data.data.requests.map((request) => (
                  <li key={request.id} className="cluster cluster--between">
                    <span>{request.person.displayName}</span>
                    <span className="cluster">
                      <Button
                        onClick={() =>
                          void respond(
                            () => api.acceptFriendRequest(request.id),
                            `You and ${request.person.displayName} are now friends.`,
                          )
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void respond(() => api.declineFriendRequest(request.id), "Declined.")
                        }
                      >
                        Decline
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <div className="grid">
            <Card title="Your articles">
              {data.data.articles.length === 0 ? (
                <p className="muted">You haven&apos;t written anything yet.</p>
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
            <Card title="Your groups">
              {data.data.groups.length === 0 ? (
                <p className="muted">You&apos;re not in any groups yet.</p>
              ) : (
                <ul className="list-plain">
                  {data.data.groups.map((group) => (
                    <li key={group.id}>
                      <strong>{group.name}</strong>{" "}
                      <span className="small muted">
                        {String(group.memberCount)} members
                        {group.membership?.status === "pending" ? " · waiting for approval" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Friends">
              {data.data.friends.length === 0 ? (
                <EmptyState title="No friends yet" />
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
