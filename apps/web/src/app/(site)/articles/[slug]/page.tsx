import { copy, fill } from "@fleettrust/copy";
import { ApiError } from "@fleettrust/sdk";
import type { PublicArticle } from "@fleettrust/types";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Notice } from "@/components/feedback";
import { Icon } from "@/components/icon";
import { ReportButton } from "@/components/report-button";
import { formatDate, formatDateTime, titleCase } from "@fleettrust/types";
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
    <article className="container article-page">
      <Link className="back-link" href="/articles">
        <span aria-hidden="true">←</span> {copy.web.article.backToHub}
      </Link>
      <header className="article-page__header">
        <p className="page-hero__kicker">{titleCase(article.category)}</p>
        <h1>{article.title}</h1>
        {article.summary ? <p className="article-page__summary">{article.summary}</p> : null}
        <div className="article-page__byline">
          <span className="article-page__avatar" aria-hidden="true">
            <Icon name="user" size={22} />
          </span>
          <span>
            <strong>
              {article.author.organization
                ? fill(copy.web.article.byOrg, {
                    name: article.author.displayName,
                    organization: article.author.organization.name,
                  })
                : fill(copy.web.article.by, { name: article.author.displayName })}
            </strong>
            <small>
              {[
                formatDate(article.publishedAt),
                article.editedAt
                  ? fill(copy.web.article.edited, { date: formatDate(article.editedAt) })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </span>
        </div>
      </header>

      <div className="article-page__body stack stack--lg">
        <Notice tone="caution">
          <p className="small">
            <strong>{article.label}.</strong> {copy.web.article.disclaimer}
          </p>
        </Notice>

        {/* Rendered by the API from a validated document: every value escaped, links nofollow. */}
        <div className="prose" dangerouslySetInnerHTML={{ __html: article.html }} />

        <ReportButton
          targetType="article"
          targetId={article.id}
          what={copy.web.reportWhat.article}
        />

        <section aria-labelledby="comments-heading" className="stack">
          <h2 id="comments-heading">
            {fill(copy.web.article.commentsTitle, { count: comments.items.length })}
          </h2>
          {comments.items.length === 0 ? (
            <p className="muted">{copy.web.article.noComments}</p>
          ) : null}
          <ul className="list-plain">
            {comments.items.map((comment) => (
              <li key={comment.id} className="card">
                {comment.body === null ? (
                  <p className="muted" style={{ margin: 0 }}>
                    {copy.web.article.commentRemoved}
                  </p>
                ) : (
                  <>
                    <p className="small muted">
                      {comment.author?.displayName ?? copy.web.article.formerMember} ·{" "}
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
            <p className="muted">{copy.web.article.commentsClosed}</p>
          )}
        </section>
      </div>
    </article>
  );
}
