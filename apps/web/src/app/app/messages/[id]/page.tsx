"use client";

import { type SubmitEvent, use, useEffect, useState } from "react";

import { Button } from "@/components/button";
import { TextArea } from "@/components/field";
import { ErrorNotice, Loading, Notice } from "@/components/feedback";
import { PageHeader } from "@/components/layout";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const REFRESH_MS = 10_000;

/**
 * A conversation. New messages are fetched every few seconds (the realtime socket is used by
 * the mobile app; the web falls back to polling, ADR-0031).
 */
export default function ConversationPage(props: PageProps<"/app/messages/[id]">) {
  const { id } = use(props.params);
  const { api } = useSession();
  const thread = useLoad(async () => {
    const [conversation, page] = await Promise.all([
      api.conversation(id),
      api.messages(id, { limit: 50 }),
    ]);
    return { conversation, messages: page.items };
  }, `conversation-${id}`);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { reload } = thread;
  const lastSeq = thread.status === "ready" ? (thread.data.messages.at(-1)?.seq ?? 0) : 0;

  useEffect(() => {
    const timer = window.setInterval(reload, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [reload]);

  useEffect(() => {
    if (lastSeq > 0) void api.markConversationRead(id, lastSeq).catch(() => undefined);
  }, [api, id, lastSeq]);

  async function send(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (body.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await api.sendMessage(id, { clientMessageId: crypto.randomUUID(), body: body.trim() });
      setBody("");
      reload();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (thread.status === "loading") return <Loading />;
  if (thread.status === "error") return <ErrorNotice error={thread.error} onRetry={reload} />;
  const { conversation, messages } = thread.data;
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);

  return (
    <>
      <PageHeader title={conversation.title} />
      {conversation.warning ? (
        <Notice tone="caution">
          <p>{conversation.warning}</p>
        </Notice>
      ) : null}
      <ol className="message-list" aria-label="Messages" aria-live="polite">
        {ordered.length === 0 ? <li className="muted">No messages yet.</li> : null}
        {ordered.map((message) => (
          <li
            key={message.id}
            className={message.sender.mine ? "message message--mine" : "message"}
          >
            <p className="small muted" style={{ margin: 0 }}>
              {message.sender.mine ? "You" : message.sender.name} ·{" "}
              <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
            </p>
            <p style={{ margin: 0, whiteSpace: "pre-line" }}>
              {message.body ?? <em className="muted">Message removed</em>}
            </p>
            {message.warnings.includes("payment_request") ? (
              <p className="small" style={{ margin: 0, color: "var(--color-caution)" }}>
                This message mentions a payment. Never pay to an account you can&apos;t verify.
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {conversation.canSend ? (
        <form className="stack" onSubmit={(event) => void send(event)}>
          <TextArea
            label="Message"
            required
            maxLength={4000}
            value={body}
            error={error}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
          <div>
            <Button type="submit" busy={busy}>
              Send
            </Button>
          </div>
        </form>
      ) : (
        <p className="muted">You can&apos;t send messages in this conversation.</p>
      )}
    </>
  );
}
