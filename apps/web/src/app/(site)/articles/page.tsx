import { copy, plural } from "@fleettrust/copy";
import { ARTICLE_CATEGORIES, type ArticleCategory } from "@fleettrust/types";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge, EmptyState, Notice } from "@/components/feedback";
import { formatDate, titleCase } from "@fleettrust/types";
import { publicApi } from "@/lib/public-api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: copy.web.articles.title,
  description: copy.web.articles.description,
};

const isCategory = (value: unknown): value is ArticleCategory =>
  typeof value === "string" && (ARTICLE_CATEGORIES as readonly string[]).includes(value);

/** Community articles. The search form is a plain GET form, so it works without JavaScript. */
export default async function ArticlesPage(props: PageProps<"/articles">) {
  const params = await props.searchParams;
  const q = typeof params["q"] === "string" ? params["q"].trim().slice(0, 200) : "";
  const category = isCategory(params["category"]) ? params["category"] : undefined;
  const cursor = typeof params["cursor"] === "string" ? params["cursor"].slice(0, 200) : undefined;
  const page = await publicApi().searchArticles({
    ...(q ? { q } : {}),
    ...(category ? { category } : {}),
    ...(cursor ? { cursor } : {}),
  });

  const next = new URLSearchParams();
  if (q) next.set("q", q);
  if (category) next.set("category", category);
  if (page.nextCursor) next.set("cursor", page.nextCursor);

  return (
    <div className="container stack stack--lg">
      <header>
        <h1>{copy.web.articles.title}</h1>
        <p className="muted">{copy.web.articles.intro}</p>
      </header>
      <Notice tone="caution">
        <p>
          <strong>{page.label}.</strong> {copy.web.articles.disclaimer}
        </p>
      </Notice>
      <form className="card cluster" role="search" action="/articles" method="get">
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label className="field__label" htmlFor="article-q">
            {copy.web.articles.searchLabel}
          </label>
          <input id="article-q" name="q" className="input" defaultValue={q} maxLength={200} />
        </div>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label className="field__label" htmlFor="article-category">
            {copy.web.articles.topic}
          </label>
          <select
            id="article-category"
            name="category"
            className="input"
            defaultValue={category ?? ""}
          >
            <option value="">{copy.web.articles.allTopics}</option>
            {ARTICLE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn--primary" style={{ alignSelf: "flex-end" }}>
          {copy.web.articles.search}
        </button>
      </form>

      {page.items.length === 0 ? (
        <EmptyState title={copy.web.articles.emptyTitle}>
          <p>{copy.web.articles.emptyBody}</p>
        </EmptyState>
      ) : (
        <ul className="list-plain">
          {page.items.map((article) => (
            <li key={article.id}>
              <article className="card">
                <h2 className="card__title">
                  <Link href={`/articles/${article.slug}`}>{article.title}</Link>
                </h2>
                <p className="small muted">
                  {article.author.displayName}
                  {article.author.organization
                    ? ` · ${article.author.organization.name}`
                    : ""} · {formatDate(article.publishedAt)} · {titleCase(article.category)}
                </p>
                <p>{article.summary ?? article.excerpt}</p>
                <Badge>{plural(article.commentCount, copy.web.articles.comments)}</Badge>
              </article>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <p>
          <Link className="btn btn--secondary" href={`/articles?${next.toString()}`}>
            {copy.web.articles.more}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
