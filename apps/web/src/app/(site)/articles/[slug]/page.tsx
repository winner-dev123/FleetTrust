import { ApiError } from "@fleettrust/sdk";
import type { PublicArticle } from "@fleettrust/types";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Notice } from "@/components/feedback";
import { ReportButton } from "@/components/report-button";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";
import { publicApi } from "@/lib/public-api";

import { CommentForm } from "./comment-form";

export const dynamic = "force-dynamic";

const loadArticle = cache(async (slug: string): Promise<PublicArticle> => {
  try {
    return await publicApi().article(slug);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
});

export async function generateMetadata(props: PageProps<"/articles/[slug]">): Promise<Metadata> {
  const article = await loadArticle((await props.params).slug);
  return { title: article.title, description: article.summary ?? article.excerpt.slice(0, 160) };
}

export default async function ArticlePage(props: PageProps<"/articles/[slug]">) {
  const { slug } = await props.params;
  const article = await loadArticle(slug);
  const comments = await publicApi().articleComments(slug);

  return (
    <article className="container container--readable stack stack--lg">
      <header className="stack" style={{ gap: 8 }}>
        <p className="small">
          <Link href="/articles">Knowledge hub</Link> · {titleCase(article.category)}
        </p>
        <h1>{article.title}</h1>
        <p className="muted">
          By {article.author.displayName}
          {article.author.organization ? ` (${article.author.organization.name})` : ""} ·{" "}
          {formatDate(article.publishedAt)}
          {article.editedAt ? ` · edited ${formatDate(article.editedAt)}` : ""}
        </p>
        <Notice tone="caution">
          <p className="small">
            <strong>{article.label}.</strong> This is the author&apos;s experience, not advice
            checked by FleetTrust and not a rating of any provider.
          </p>
        </Notice>
      </header>

      {/* Rendered by the API from a validated document: every value escaped, links nofollow. */}
      <div className="article-body" dangerouslySetInnerHTML={{ __html: article.html }} />

      <ReportButton targetType="article" targetId={article.id} what="article" />

      <section aria-labelledby="comments-heading" className="stack">
        <h2 id="comments-heading">Comments ({comments.items.length})</h2>
        {comments.items.length === 0 ? <p className="muted">No comments yet.</p> : null}
        <ul className="list-plain">
          {comments.items.map((comment) => (
            <li key={comment.id} className="card">
              {comment.body === null ? (
                <p className="muted" style={{ margin: 0 }}>
                  This comment was removed.
                </p>
              ) : (
                <>
                  <p className="small muted">
                    {comment.author?.displayName ?? "Former member"} ·{" "}
                    <time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
                  </p>
                  <p style={{ whiteSpace: "pre-line" }}>{comment.body}</p>
                </>
              )}
            </li>
          ))}
        </ul>
        {article.commentsEnabled ? (
          <CommentForm articleId={article.id} />
        ) : (
          <p className="muted">Comments are closed.</p>
        )}
      </section>
    </article>
  );
}
