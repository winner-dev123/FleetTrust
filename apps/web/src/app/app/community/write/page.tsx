"use client";

import { copy, fill } from "@fleettrust/copy";
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
import { errorMessage } from "@fleettrust/sdk";
import { titleCase } from "@fleettrust/types";
import { useSession } from "@/lib/session";

const t = copy.web.app.write;

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
      setError(t.missing);
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
      <PageHeader title={t.title} description={t.description} />
      <Notice tone="caution">
        <p className="small">{fill(t.rules, { label: COMMUNITY_CONTENT_LABEL })}</p>
      </Notice>
      <Card>
        <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
          <TextField
            label={t.titleLabel}
            required
            maxLength={150}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <TextField
            label={t.summary}
            maxLength={300}
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value);
            }}
          />
          <SelectField
            label={t.topic}
            required
            value={category}
            onChange={(event) => {
              setCategory(ARTICLE_CATEGORIES.find((c) => c === event.target.value) ?? "other");
            }}
            options={ARTICLE_CATEGORIES.map((value) => ({ value, label: titleCase(value) }))}
          />
          <TextArea
            label={t.article}
            hint={t.articleHint}
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
              {busy ? t.publishing : t.publish}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
