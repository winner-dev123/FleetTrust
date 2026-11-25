import { formatDateTime } from "@fleettrust/types";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";

import { ErrorNotice, SignInPrompt } from "../../src/components/feedback";
import { Body, EmptyState, Heading, ListRow, Loading, Screen } from "../../src/components/ui";
import { useLoad } from "../../src/lib/use-load";
import { useSession } from "../../src/state/session";

function Conversations({ uid }: { uid: string }) {
  const { api } = useSession();
  const router = useRouter();
  const list = useLoad(() => api.conversations(), `conversations-${uid}`);
  const { reload } = list;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (list.status === "loading") return <Loading />;
  if (list.status === "error") return <ErrorNotice error={list.error} onRetry={reload} />;
  if (list.data.length === 0) {
    return (
      <EmptyState title="No conversations yet">
        Conversations start from a service request, a friend or a group.
      </EmptyState>
    );
  }
  return (
    <>
      {list.data.map((conversation) => (
        <ListRow
          key={conversation.id}
          title={conversation.title}
          subtitle={[
            conversation.unread > 0 ? `${String(conversation.unread)} unread` : null,
            conversation.lastMessageAt
              ? formatDateTime(conversation.lastMessageAt)
              : "No messages yet",
            conversation.muted ? "muted" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          onPress={() => {
            router.push(`/messages/${conversation.id}`);
          }}
        />
      ))}
    </>
  );
}

export default function MessagesScreen() {
  const { status, user } = useSession();
  return (
    <Screen>
      <Heading>Messages</Heading>
      <Body small muted>
        Never pay to an account you can&apos;t verify. Report anyone who asks.
      </Body>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt
          title="Sign in to see your messages"
          reason="Messages are private to your account."
        />
      ) : null}
      {status === "signed-in" && user ? <Conversations uid={user.uid} /> : null}
    </Screen>
  );
}
