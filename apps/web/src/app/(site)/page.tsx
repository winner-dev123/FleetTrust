import { copy, fill } from "@fleettrust/copy";
import { CATEGORY_LABELS, PROVIDER_CATEGORIES } from "@fleettrust/types";
import Link from "next/link";

import { ButtonLink } from "@/components/button";
import { webEnv } from "@/env";

/** Home page: search first, emergency always one tap away, and what FleetTrust does (and doesn't). */
export default function HomePage() {
  return (
    <div className="container stack stack--lg">
      <section className="hero stack" aria-labelledby="hero-heading">
        <h1 id="hero-heading" className="hero__title">
          {copy.web.home.title}
        </h1>
        <p className="muted" style={{ fontSize: "var(--font-lg)" }}>
          {copy.web.home.intro}
        </p>
        <form className="card stack" action="/search" method="get" role="search">
          <div className="grid">
            <div className="field">
              <label className="field__label" htmlFor="home-q">
                {copy.web.home.whatLabel}
              </label>
              <input
                id="home-q"
                name="q"
                className="input"
                maxLength={100}
                placeholder={copy.web.home.whatPlaceholder}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="home-where">
                {copy.web.home.whereLabel}
              </label>
              <input
                id="home-where"
                name="where"
                className="input"
                maxLength={100}
                autoComplete="address-level2"
                placeholder={copy.web.home.wherePlaceholder}
              />
            </div>
          </div>
          <div className="cluster">
            <button type="submit" className="btn btn--primary">
              {copy.web.home.search}
            </button>
            <ButtonLink variant="danger" href="/emergency">
              {copy.web.home.helpNow}
            </ButtonLink>
          </div>
        </form>
        <nav aria-label={copy.web.home.browse}>
          <ul className="cluster list-plain">
            {PROVIDER_CATEGORIES.map((category) => (
              <li key={category} style={{ marginTop: 0 }}>
                <Link className="nav__link" href={`/search?category=${category}`}>
                  {CATEGORY_LABELS[category]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      <section aria-labelledby="trust-heading" className="stack">
        <h2 id="trust-heading">{copy.web.home.howTitle}</h2>
        <div className="grid">
          <article className="card">
            <h3 className="card__title">{copy.web.home.evidenceTitle}</h3>
            <p>{copy.web.home.evidenceBody}</p>
          </article>
          <article className="card">
            <h3 className="card__title">{copy.web.home.pricesTitle}</h3>
            <p>{copy.web.home.pricesBody}</p>
          </article>
          <article className="card">
            <h3 className="card__title">{copy.web.home.alertsTitle}</h3>
            <p>{copy.web.home.alertsBody}</p>
          </article>
          <article className="card">
            <h3 className="card__title">{copy.web.home.businessTitle}</h3>
            <p>
              {copy.web.home.businessBody}{" "}
              <Link href="/sign-in">{copy.web.home.createAccount}</Link>.
            </p>
          </article>
        </div>
      </section>

      {webEnv.appEnv !== "production" ? (
        <p className="small muted">{fill(copy.web.home.environment, { name: webEnv.appEnv })}</p>
      ) : null}
    </div>
  );
}
