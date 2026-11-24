import { ARTICLE_CATEGORIES, type ArticleCategory } from "@fleettrust/types";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge, EmptyState, Notice } from "@/components/feedback";
import { formatDate, titleCase } from "@/lib/format";
import { publicApi } from "@/lib/public-api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Knowledge hub",
  description: "Practical articles from drivers, fleets and providers.",
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
        <h1>Knowledge hub</h1>
        <p className="muted">Practical tips from drivers, fleets and providers.</p>
      </header>
      <Notice tone="caution">
        <p>
          <strong>{page.label}.</strong> Articles share personal experience. They are not checked by
          FleetTrust and are not ratings of any provider.
        </p>
      </Notice>
      <form className="card cluster" role="search" action="/articles" method="get">
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label className="field__label" htmlFor="article-q">
            Search articles
          </label>
          <input id="article-q" name="q" className="input" defaultValue={q} maxLength={200} />
        </div>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label className="field__label" htmlFor="article-category">
            Topic
          </label>
          <select
            id="article-category"
            name="category"
            className="input"
            defaultValue={category ?? ""}
          >
            <option value="">All topics</option>
            {ARTICLE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn--primary" style={{ alignSelf: "flex-end" }}>
          Search
        </button>
      </form>

      {page.items.length === 0 ? (
        <EmptyState title="No articles found">
          <p>Try other words or another topic.</p>
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
                <Badge>{article.commentCount} comments</Badge>
              </article>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <p>
          <Link className="btn btn--secondary" href={`/articles?${next.toString()}`}>
            More articles
          </Link>
        </p>
      ) : null}
    </div>
  );
}
