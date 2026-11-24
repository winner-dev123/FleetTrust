"use client";

import {
  ARTICLE_CATEGORIES,
  type ArticleCategory,
  COMMUNITY_CONTENT_LABEL,
} from "@fleettrust/types";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/button";
import { SelectField, TextArea, TextField } from "@/components/field";
import { Notice } from "@/components/feedback";
import { Card, PageHeader } from "@/components/layout";
import { textToDocument } from "@/lib/article-text";
import { errorMessage } from "@/lib/errors";
import { titleCase } from "@/lib/format";
import { useSession } from "@/lib/session";

/** Write an article: saved as a draft, then published (new accounts go to moderation first). */
export default function WriteArticlePage() {
  const { api } = useSession();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<ArticleCategory>("maintenance");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim() === "" || body.trim() === "") {
      setError("Add a title and some text.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = await api.createArticle({
        title: title.trim(),
        summary: summary.trim() || null,
        category,
        body: textToDocument(body),
      });
      const published = await api.publishArticle(draft.id);
      router.push(
        published.status === "published" ? `/articles/${published.slug}` : "/app/community",
      );
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Write an article"
        description="Share practical experience: maintenance tips, routes, safety, regulations."
      />
      <Notice tone="caution">
        <p className="small">
          Articles are labelled “{COMMUNITY_CONTENT_LABEL}”. Don&apos;t rate or score providers:
          articles that do are refused. New accounts&apos; articles are checked by a moderator
          before they appear.
        </p>
      </Notice>
      <Card>
        <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
          <TextField
            label="Title"
            required
            maxLength={150}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <TextField
            label="Summary"
            maxLength={300}
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value);
            }}
          />
          <SelectField
            label="Topic"
            required
            value={category}
            onChange={(event) => {
              setCategory(ARTICLE_CATEGORIES.find((c) => c === event.target.value) ?? "other");
            }}
            options={ARTICLE_CATEGORIES.map((value) => ({ value, label: titleCase(value) }))}
          />
          <TextArea
            label="Article"
            hint="Leave a blank line between paragraphs."
            required
            rows={12}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
          {error ? (
            <Notice tone="danger" live="assertive">
              <p>{error}</p>
            </Notice>
          ) : null}
          <div>
            <Button type="submit" busy={busy}>
              {busy ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
