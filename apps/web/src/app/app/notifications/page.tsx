"use client";

import { copy } from "@fleettrust/copy";
import Link from "next/link";

import { Button } from "@/components/button";
import { EmptyState, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { formatDateTime } from "@fleettrust/types";
import { notificationHref } from "@fleettrust/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const t = copy.web.app.notifications;

export default function NotificationsPage() {
  const { api } = useSession();
  const inbox = useLoad(() => api.inbox(), "inbox");

  return (
    <>
      <PageHeader
        title={t.title}
        actions={
          inbox.status === "ready" && inbox.data.unreadNotifications > 0 ? (
            <Button
              variant="secondary"
              onClick={() => void api.markAllNotificationsRead().then(inbox.reload, inbox.reload)}
            >
              {t.markAllRead}
            </Button>
          ) : null
        }
      />
      {inbox.status === "loading" ? <Loading /> : null}
      {inbox.status === "error" ? <ErrorNotice error={inbox.error} onRetry={inbox.reload} /> : null}
      {inbox.status === "ready" ? (
        inbox.data.notifications.length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          <ul className="list-plain">
            {inbox.data.notifications.map((notification) => {
              const href = notificationHref(notification);
              return (
                <li
                  key={notification.id}
                  className={notification.readAt ? "card" : "card card--muted"}
                >
                  <p style={{ margin: 0 }}>
                    <strong>{notification.title}</strong>
                    {notification.readAt ? null : <span className="small"> · {t.newMark}</span>}
                  </p>
                  <p style={{ margin: 0 }}>{notification.body}</p>
                  <p className="small muted cluster" style={{ margin: 0 }}>
                    <time dateTime={notification.createdAt}>
                      {formatDateTime(notification.createdAt)}
                    </time>
                    {href ? <Link href={href}>{t.open}</Link> : null}
                    {notification.readAt ? null : (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() =>
                          void api
                            .markNotificationRead(notification.id)
                            .then(inbox.reload, inbox.reload)
                        }
                      >
                        {t.markRead}
                      </button>
                    )}
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
