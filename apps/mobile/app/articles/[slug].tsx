import { copy, fill } from "@fleettrust/copy";
import { errorMessage, isOffline } from "@fleettrust/sdk";
import { formatDate, formatDateTime } from "@fleettrust/types";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { ArticleBody } from "../../src/components/article-body";
import { ErrorNotice, SignInPrompt } from "../../src/components/feedback";
import {
  Body,
  Button,
  Card,
  Heading,
  Loading,
  Notice,
  Screen,
  TextField,
} from "../../src/components/ui";
import { useLoad } from "../../src/lib/use-load";
import { useOnline } from "../../src/state/network";
import { useSession } from "../../src/state/session";

const draftSchema = z.string().max(2000);

/** Comment box whose text is kept on the phone until it's posted. */
function CommentForm({
  articleId,
  uid,
  onPosted,
}: {
  articleId: string;
  uid: string;
  onPosted: () => void;
}) {
  const { api, drafts } = useSession();
  const online = useOnline();
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void drafts.load(uid, "comment", articleId, draftSchema).then((saved) => {
      if (active) setBody((current) => current ?? saved?.value ?? "");
    });
    return () => {
      active = false;
    };
  }, [articleId, drafts, uid]);

  useEffect(() => {
    if (body === null) return;
    const timer = setTimeout(() => {
      void (body.trim() === ""
        ? drafts.discard(uid, "comment", articleId)
        : drafts.save(uid, "comment", articleId, body));
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [articleId, body, drafts, uid]);

  async function post() {
    const text = (body ?? "").trim();
    if (text === "") return;
    setBusy(true);
    setError(null);
    try {
      await api.addComment(articleId, { body: text });
      setBody("");
      await drafts.discard(uid, "comment", articleId);
      onPosted();
    } catch (failure) {
      setError(isOffline(failure) ? copy.article.commentOfflineSaved : errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TextField
        label={copy.article.addComment}
        multiline
        maxLength={2000}
        value={body ?? ""}
        onChangeText={setBody}
        error={error}
      />
      <Button
        label={copy.article.postComment}
        busy={busy}
        disabled={!online || (body ?? "").trim() === ""}
        onPress={() => void post()}
      />
      {!online ? (
        <Body small muted>
          {copy.article.offlineSavedOnPhone}
        </Body>
      ) : null}
    </>
  );
}

export default function ArticleScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { api, status, user } = useSession();
  const article = useLoad(async () => {
    const [content, comments] = await Promise.all([api.article(slug), api.articleComments(slug)]);
    return { content, comments };
  }, `article-${slug}`);

  return (
    <Screen>
      {article.status === "loading" ? <Loading /> : null}
      {article.status === "error" ? (
        <ErrorNotice error={article.error} onRetry={article.reload} />
      ) : null}
      {article.status === "ready" ? (
        <>
          <Heading>{article.data.content.title}</Heading>
          <Body small muted>
            {article.data.content.author.displayName} ·{" "}
            {formatDate(article.data.content.publishedAt)}
          </Body>
          <Notice>
            <Body small>{article.data.content.label}</Body>
          </Notice>
          <ArticleBody document={article.data.content.body} />
          <Card
            title={fill(copy.article.commentsTitle, {
              count: article.data.comments.items.length,
            })}
          >
            {article.data.comments.items.map((comment) => (
              <Body key={comment.id}>
                {comment.author?.displayName ?? copy.article.removedAuthor} ·{" "}
                {formatDateTime(comment.createdAt)}
                {"\n"}
                {comment.body ?? copy.article.removedComment}
              </Body>
            ))}
            {!article.data.content.commentsEnabled ? (
              <Body muted>{copy.article.commentsClosed}</Body>
            ) : null}
            {article.data.content.commentsEnabled && status === "signed-in" && user ? (
              <CommentForm
                articleId={article.data.content.id}
                uid={user.uid}
                onPosted={article.reload}
              />
            ) : null}
            {article.data.content.commentsEnabled && status === "signed-out" ? (
              <SignInPrompt title={copy.article.signInTitle} reason={copy.article.signInReason} />
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
