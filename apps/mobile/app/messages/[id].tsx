import { copy, fill } from "@fleettrust/copy";
import type { ConversationDto, MessageDto } from "@fleettrust/types";
import { formatDateTime } from "@fleettrust/types";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { z } from "zod";

import { ErrorNotice, SignInPrompt } from "../../src/components/feedback";
import { useTheme } from "../../src/components/theme";
import { Body, Button, Heading, Loading, Notice, Screen, TextField } from "../../src/components/ui";
import type { QueuedMessage } from "../../src/lib/outbox";
import { RealtimeClient, type RealtimeStatus } from "../../src/lib/realtime";
import { useLoad } from "../../src/lib/use-load";
import { useOnline } from "../../src/state/network";
import { useSession } from "../../src/state/session";

const draftSchema = z.string().max(4000);

function bySeq(messages: Iterable<MessageDto>): MessageDto[] {
  return [...messages].sort((a, b) => a.seq - b.seq);
}

/**
 * A conversation with live delivery (WebSocket with replay after reconnects), a composer whose
 * text is kept as a draft, and an outbox: messages written offline wait on the phone and send
 * when the connection returns, without duplicates.
 */
function Thread({ id, uid }: { id: string; uid: string }) {
  const { api, platform, runtime, drafts, outbox } = useSession();
  const online = useOnline();
  const theme = useTheme();
  const initial = useLoad(async () => {
    const [conversation, page] = await Promise.all([
      api.conversation(id),
      api.messages(id, { limit: 50 }),
    ]);
    return { conversation, messages: page.items };
  }, `conversation-${id}`);
  // Messages that arrived after the first load (live, replayed, or sent from here).
  const [arrived, setArrived] = useState<Map<number, MessageDto>>(new Map());
  const [pending, setPending] = useState<QueuedMessage[]>([]);
  const [body, setBody] = useState<string | null>(null);
  const [live, setLive] = useState<RealtimeStatus>("idle");
  const onlineRef = useRef(online);
  useEffect(() => {
    onlineRef.current = online;
  });
  const clientRef = useRef<RealtimeClient | null>(null);

  const conversation: ConversationDto | null =
    initial.status === "ready" ? initial.data.conversation : null;
  const loaded = initial.status === "ready" ? initial.data.messages : null;
  const messages = useMemo(() => {
    const all = new Map<number, MessageDto>((loaded ?? []).map((m) => [m.seq, m]));
    for (const [seq, message] of arrived) all.set(seq, message);
    return all;
  }, [arrived, loaded]);
  const lastSeq = useMemo(() => Math.max(0, ...messages.keys()), [messages]);
  const lastSeqRef = useRef(lastSeq);
  useEffect(() => {
    lastSeqRef.current = lastSeq;
  });

  // Live delivery. Replays anything missed since `lastSeq` after every reconnect.
  const ready = conversation !== null;
  useEffect(() => {
    if (!ready) return;
    const realtime = new RealtimeClient({
      url: api.realtimeUrl(),
      token: () => platform.auth.idToken(),
      createSocket: runtime.createSocket,
      onMessage: (_conversationId, message) => {
        setArrived((current) => new Map(current).set(message.seq, message));
      },
      onMessageUpdated: (_conversationId, message) => {
        setArrived((current) => new Map(current).set(message.seq, message));
      },
      onTruncated: (_conversationId, nextAfter) => {
        void api.messages(id, { after: nextAfter, limit: 100 }).then((page) => {
          setArrived((current) => {
            const next = new Map(current);
            for (const message of page.items) next.set(message.seq, message);
            return next;
          });
        });
      },
      onStatus: setLive,
    });
    clientRef.current = realtime;
    realtime.setOnline(onlineRef.current);
    // Subscribed once; the client tracks seq from here on, across reconnects.
    const unwatch = realtime.watch(id, lastSeqRef.current);
    const subscription = AppState.addEventListener("change", (state) => {
      realtime.setForeground(state === "active");
    });
    return () => {
      subscription.remove();
      unwatch();
      realtime.close();
      clientRef.current = null;
    };
  }, [api, id, platform, ready, runtime]);

  useEffect(() => {
    clientRef.current?.setOnline(online);
  }, [online]);

  // Queued messages for this conversation.
  useEffect(() => {
    if (!outbox) return;
    const refresh = () => {
      void outbox.list(id).then(setPending);
    };
    refresh();
    return outbox.subscribe(refresh);
  }, [id, outbox]);

  // Composer draft: restore once, then save as you type.
  useEffect(() => {
    let active = true;
    void drafts.load(uid, "message", id, draftSchema).then((saved) => {
      if (active) setBody((current) => current ?? saved?.value ?? "");
    });
    return () => {
      active = false;
    };
  }, [drafts, id, uid]);
  useEffect(() => {
    if (body === null) return;
    const timer = setTimeout(() => {
      void (body.trim() === ""
        ? drafts.discard(uid, "message", id)
        : drafts.save(uid, "message", id, body));
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [body, drafts, id, uid]);

  useEffect(() => {
    if (lastSeq > 0 && online) void api.markConversationRead(id, lastSeq).catch(() => undefined);
  }, [api, id, lastSeq, online]);

  if (initial.status === "loading" || conversation === null) {
    return initial.status === "error" ? (
      <ErrorNotice error={initial.error} onRetry={initial.reload} />
    ) : (
      <Loading />
    );
  }

  async function send() {
    const text = (body ?? "").trim();
    if (text === "" || !outbox) return;
    await outbox.enqueue(id, text, platform.device.randomId());
    setBody("");
    await drafts.discard(uid, "message", id);
    if (online) {
      const result = await outbox.flush();
      if (result.sent.length > 0) {
        setArrived((current) => {
          const next = new Map(current);
          for (const message of result.sent) {
            if (message.conversationId === id) next.set(message.seq, message);
          }
          return next;
        });
      }
    }
  }

  const delivered = new Set([...messages.values()].map((m) => m.clientMessageId));
  const waiting = pending.filter((item) => !delivered.has(item.clientMessageId));

  return (
    <>
      <Heading>{conversation.title}</Heading>
      {conversation.warning ? <Notice tone="caution">{conversation.warning}</Notice> : null}
      <Body small muted>
        {live === "live"
          ? copy.conversation.live
          : online
            ? copy.conversation.connecting
            : copy.conversation.offline}
      </Body>
      <View accessibilityLabel={copy.conversation.messagesLabel} style={{ gap: theme.spacing.sm }}>
        {messages.size === 0 && waiting.length === 0 ? (
          <Body muted>{copy.conversation.empty}</Body>
        ) : null}
        {bySeq(messages.values()).map((message) => (
          <View
            key={message.id}
            accessible
            style={{
              alignSelf: message.sender.mine ? "flex-end" : "flex-start",
              maxWidth: "88%",
              backgroundColor: message.sender.mine ? theme.color.surface : theme.color.background,
              borderColor: theme.color.border,
              borderWidth: 1,
              borderRadius: theme.radii.lg,
              padding: theme.spacing.md,
              gap: 4,
            }}
          >
            <Body small muted>
              {fill(copy.conversation.meta, {
                sender: message.sender.mine ? copy.conversation.you : message.sender.name,
                time: formatDateTime(message.createdAt),
              })}
            </Body>
            <Body>{message.body ?? copy.conversation.removed}</Body>
            {message.warnings.includes("payment_request") ? (
              <Body small tone="caution">
                {copy.conversation.paymentWarning}
              </Body>
            ) : null}
          </View>
        ))}
        {waiting.map((item) => (
          <View
            key={item.clientMessageId}
            accessible
            style={{
              alignSelf: "flex-end",
              maxWidth: "88%",
              borderColor: item.state === "failed" ? theme.color.danger : theme.color.border,
              borderWidth: 1,
              borderStyle: "dashed",
              borderRadius: theme.radii.lg,
              padding: theme.spacing.md,
              gap: 4,
            }}
          >
            <Body>{item.body}</Body>
            {item.state === "failed" ? (
              <>
                <Body small tone="danger">
                  {fill(copy.conversation.notSent, {
                    reason: item.error ?? copy.conversation.refused,
                  })}
                </Body>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button
                    label={copy.conversation.retry}
                    variant="secondary"
                    onPress={() => {
                      void outbox?.retry(item.clientMessageId).then(() => outbox.flush());
                    }}
                  />
                  <Button
                    label={copy.conversation.delete}
                    variant="ghost"
                    onPress={() => {
                      void outbox?.remove(item.clientMessageId);
                    }}
                  />
                </View>
              </>
            ) : (
              <Body small muted>
                {online ? copy.conversation.sending : copy.conversation.waitingOffline}
              </Body>
            )}
          </View>
        ))}
      </View>
      {conversation.canSend ? (
        <>
          <TextField
            label={copy.conversation.messageLabel}
            multiline
            maxLength={4000}
            value={body ?? ""}
            onChangeText={setBody}
            hint={online ? undefined : copy.conversation.offlineHint}
          />
          <Button
            label={online ? copy.conversation.send : copy.conversation.sendWhenOnline}
            onPress={() => void send()}
            disabled={(body ?? "").trim() === ""}
          />
        </>
      ) : (
        <Body muted>{copy.conversation.cannotSend}</Body>
      )}
    </>
  );
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, user } = useSession();
  return (
    <Screen>
      {status === "loading" ? <Loading /> : null}
      {status === "signed-out" ? (
        <SignInPrompt
          title={copy.conversation.signInTitle}
          reason={copy.conversation.signInReason}
        />
      ) : null}
      {status === "signed-in" && user && typeof id === "string" ? (
        <Thread id={id} uid={user.uid} />
      ) : null}
    </Screen>
  );
}
