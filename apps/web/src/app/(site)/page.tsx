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
          Vehicle services you can check, and help when you&apos;re stuck
        </h1>
        <p className="muted" style={{ fontSize: "var(--font-lg)" }}>
          Find workshops, towing, tyres and parts nearby. Compare indicative prices, see what
          FleetTrust verified, and request quotes.
        </p>
        <form className="card stack" action="/search" method="get" role="search">
          <div className="grid">
            <div className="field">
              <label className="field__label" htmlFor="home-q">
                What do you need?
              </label>
              <input
                id="home-q"
                name="q"
                className="input"
                maxLength={100}
                placeholder="Brakes, tyre repair…"
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="home-where">
                Where?
              </label>
              <input
                id="home-where"
                name="where"
                className="input"
                maxLength={100}
                autoComplete="address-level2"
                placeholder="Town or area"
              />
            </div>
          </div>
          <div className="cluster">
            <button type="submit" className="btn btn--primary">
              Search
            </button>
            <ButtonLink variant="danger" href="/emergency">
              I need help now
            </ButtonLink>
          </div>
        </form>
        <nav aria-label="Browse by category">
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
        <h2 id="trust-heading">How FleetTrust works</h2>
        <div className="grid">
          <article className="card">
            <h3 className="card__title">Evidence, not stars</h3>
            <p>
              Labels show what FleetTrust checked, such as business registration or location. There
              are no star ratings, and no plan can buy a label or a higher place in search.
            </p>
          </article>
          <article className="card">
            <h3 className="card__title">Indicative prices, direct payment</h3>
            <p>
              Providers publish indicative prices. You agree the final price with them and pay them
              directly: FleetTrust never handles your money.
            </p>
          </article>
          <article className="card">
            <h3 className="card__title">Alerts to people you trust</h3>
            <p>
              Choose trusted contacts and alert them in one tap. Emergency alerts are never limited
              by your plan. They don&apos;t replace emergency services.
            </p>
          </article>
          <article className="card">
            <h3 className="card__title">For providers and fleets</h3>
            <p>
              Publish your services, answer quote requests and run your fleet&apos;s vehicles,
              incidents and jobs in one place. <Link href="/sign-in">Create a free account</Link>.
            </p>
          </article>
        </div>
      </section>

      {webEnv.appEnv !== "production" ? (
        <p className="small muted">Environment: {webEnv.appEnv}</p>
      ) : null}
    </div>
  );
}
