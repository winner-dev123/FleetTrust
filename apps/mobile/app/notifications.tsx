import { copy, fill } from "@fleettrust/copy";
import { formatDateTime } from "@fleettrust/types";
import { useRouter } from "expo-router";

import { ErrorNotice, SignInPrompt } from "../src/components/feedback";
import { Body, Button, EmptyState, Heading, ListRow, Loading, Screen } from "../src/components/ui";
import { useLoad } from "../src/lib/use-load";
import { pushTarget } from "../src/state/push-listener";
import { useSession } from "../src/state/session";

function Inbox() {
  const { api } = useSession();
  const router = useRouter();
  const inbox = useLoad(() => api.inbox(), "inbox");
  if (inbox.status === "loading") return <Loading />;
  if (inbox.status === "error") return <ErrorNotice error={inbox.error} onRetry={inbox.reload} />;
  const { notifications } = inbox.data;
  return (
    <>
      {notifications.length === 0 ? <EmptyState title={copy.notificationsScreen.empty} /> : null}
      {notifications.some((n) => n.readAt === null) ? (
        <Button
          label={copy.notificationsScreen.markAllRead}
          variant="ghost"
          onPress={() => {
            void api.markAllNotificationsRead().then(inbox.reload, () => undefined);
          }}
        />
      ) : null}
      {notifications.map((notification) => (
        <ListRow
          key={notification.id}
          title={
            notification.readAt === null
              ? fill(copy.notificationsScreen.unreadTitle, { title: notification.title })
              : notification.title
          }
          subtitle={formatDateTime(notification.createdAt)}
          detail={<Body small>{notification.body}</Body>}
          onPress={() => {
            void api.markNotificationRead(notification.id).catch(() => undefined);
            const target = pushTarget(notification.data);
            if (target !== "/notifications") router.push(target);
          }}
        />
      ))}
    </>
  );
}

/** The inbox: everything is recorded here, whether or not push notifications are on. */
export default function NotificationsScreen() {
  const { status } = useSession();
  return (
    <Screen>
      <Heading>{copy.notificationsScreen.title}</Heading>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt
          title={copy.notificationsScreen.signInTitle}
          reason={copy.notificationsScreen.signInReason}
        />
      ) : null}
      {status === "signed-in" ? <Inbox /> : null}
    </Screen>
  );
}
