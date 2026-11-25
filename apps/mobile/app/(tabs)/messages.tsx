import { copy, fill } from "@fleettrust/copy";
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
      <EmptyState title={copy.messagesTab.emptyTitle}>{copy.messagesTab.emptyBody}</EmptyState>
    );
  }
  return (
    <>
      {list.data.map((conversation) => (
        <ListRow
          key={conversation.id}
          title={conversation.title}
          subtitle={[
            conversation.unread > 0
              ? fill(copy.messagesTab.unread, { count: conversation.unread })
              : null,
            conversation.lastMessageAt
              ? formatDateTime(conversation.lastMessageAt)
              : copy.messagesTab.noMessagesYet,
            conversation.muted ? copy.messagesTab.muted : null,
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
      <Heading>{copy.messagesTab.title}</Heading>
      <Body small muted>
        {copy.messagesTab.safetyNote}
      </Body>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt title={copy.messagesTab.signInTitle} reason={copy.messagesTab.signInReason} />
      ) : null}
      {status === "signed-in" && user ? <Conversations uid={user.uid} /> : null}
    </Screen>
  );
}
