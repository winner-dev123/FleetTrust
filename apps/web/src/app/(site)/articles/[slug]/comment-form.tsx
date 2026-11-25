"use client";

import { copy } from "@fleettrust/copy";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { TextArea } from "@/components/field";
import { Notice } from "@/components/feedback";
import { errorMessage } from "@fleettrust/sdk";
import { useSession } from "@/lib/session";

export function CommentForm({ articleId }: { articleId: string }) {
  const { api, status } = useSession();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status !== "signed-in") {
    return (
      <p>
        <Link href="/sign-in">{copy.web.article.signIn}</Link> {copy.web.article.signInToComment}
      </p>
    );
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (body.trim() === "") {
      setError(copy.web.article.writeFirst);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.addComment(articleId, { body: body.trim() });
      setBody("");
      router.refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <TextArea
        label={copy.web.article.addComment}
        hint={copy.web.article.commentHint}
        required
        maxLength={2000}
        value={body}
        error={error}
        onChange={(event) => {
          setBody(event.target.value);
        }}
      />
      <div>
        <Button type="submit" busy={busy}>
          {copy.web.article.postComment}
        </Button>
      </div>
      {error === null && busy ? <Notice live="polite">{copy.web.article.posting}</Notice> : null}
    </form>
  );
}
