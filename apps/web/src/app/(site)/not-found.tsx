import { copy } from "@fleettrust/copy";

import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icon";

/** Public 404 (Figma Make "wrong turn" page). */
export default function NotFound() {
  const t = copy.web.errors;
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <span className="not-found__icon" aria-hidden="true">
        <Icon name="car" size={62} />
      </span>
      <p className="page-hero__kicker">{t.notFoundKicker}</p>
      <h1 id="not-found-title">{t.notFoundTitle}</h1>
      <p className="not-found__body">{t.pageGone}</p>
      <div className="cluster not-found__actions">
        <ButtonLink large href="/">
          {t.returnHome} <Icon name="arrow" size={18} />
        </ButtonLink>
        <ButtonLink large variant="secondary" href="/search">
          {t.findServices}
        </ButtonLink>
      </div>
    </section>
  );
}
