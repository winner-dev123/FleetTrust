"use client";

import Link from "next/link";

import { Button } from "@/components/button";
import { EmptyState, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { formatDateTime } from "@/lib/format";
import { notificationHref } from "@/lib/notifications";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

export default function NotificationsPage() {
  const { api } = useSession();
  const inbox = useLoad(() => api.inbox(), "inbox");

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          inbox.status === "ready" && inbox.data.unreadNotifications > 0 ? (
            <Button
              variant="secondary"
              onClick={() => void api.markAllNotificationsRead().then(inbox.reload, inbox.reload)}
            >
              Mark all as read
            </Button>
          ) : null
        }
      />
      {inbox.status === "loading" ? <Loading /> : null}
      {inbox.status === "error" ? <ErrorNotice error={inbox.error} onRetry={inbox.reload} /> : null}
      {inbox.status === "ready" ? (
        inbox.data.notifications.length === 0 ? (
          <EmptyState title="Nothing new" />
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
                    {notification.readAt ? null : <span className="small"> · New</span>}
                  </p>
                  <p style={{ margin: 0 }}>{notification.body}</p>
                  <p className="small muted cluster" style={{ margin: 0 }}>
                    <time dateTime={notification.createdAt}>
                      {formatDateTime(notification.createdAt)}
                    </time>
                    {href ? <Link href={href}>Open</Link> : null}
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
                        Mark as read
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
