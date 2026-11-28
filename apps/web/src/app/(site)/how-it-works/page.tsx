import { copy } from "@fleettrust/copy";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icon";

import mechanicImage from "../../../../public/images/fleettrust-mechanic.webp";
import roadsideImage from "../../../../public/images/fleettrust-roadside.webp";

const t = copy.web.howItWorks;

export const metadata: Metadata = { title: t.title, description: t.description };

/** How FleetTrust works (Figma Make "How it works" page). Static: no API calls. */
export default function HowItWorksPage() {
  const steps = [
    [t.step1Title, t.step1Body],
    [t.step2Title, t.step2Body],
    [t.step3Title, t.step3Body],
  ] as const;

  return (
    <>
      <section className="feature-hero feature-hero--route-light" aria-labelledby="how-title">
        <div className="feature-hero__grid">
          <div>
            <p className="page-hero__kicker">{t.kicker}</p>
            <h1 id="how-title">{t.heroTitle}</h1>
            <p className="feature-hero__intro">{t.heroIntro}</p>
            <ButtonLink large href="/search">
              {t.findService} <Icon name="arrow" size={18} />
            </ButtonLink>
          </div>
          <Image
            className="feature-hero__image"
            src={mechanicImage}
            alt={copy.web.home.mechanicImageAlt}
            sizes="(max-width: 760px) 100vw, 45vw"
            priority
          />
        </div>
      </section>

      <section className="feature-section" aria-labelledby="steps-title">
        <div className="feature-section__intro">
          <p className="page-hero__kicker">{t.stepsKicker}</p>
          <h2 id="steps-title">{t.stepsTitle}</h2>
        </div>
        <ol className="feature-grid feature-grid--tinted list-plain">
          {steps.map(([title, body], index) => (
            <li key={title} className="feature-card">
              <span className="feature-card__number" aria-hidden="true">
                {`0${String(index + 1)}`}
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="evidence-band" aria-labelledby="evidence-title">
        <div className="evidence-band__grid">
          <div>
            <p className="page-hero__kicker">{t.evidenceKicker}</p>
            <h2 id="evidence-title">{t.evidenceTitle}</h2>
            <p className="evidence-band__body">{copy.web.provider.verificationNote}</p>
          </div>
          <div className="evidence-card">
            <span className="evidence-card__icon" aria-hidden="true">
              <Icon name="shield" size={28} />
            </span>
            <div>
              <h3>{t.evidenceCardTitle}</h3>
              <ul className="list-plain check-list">
                <li>
                  <Icon name="check" size={16} /> {t.evidenceBusiness}
                </li>
                <li>
                  <Icon name="check" size={16} /> {t.evidenceLocation}
                </li>
                <li>
                  <Icon name="check" size={16} /> {t.evidenceRanking}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="split-section" aria-labelledby="direct-title">
        <Image
          className="split-section__image"
          src={roadsideImage}
          alt={copy.web.home.roadsideImageAlt}
          sizes="(max-width: 760px) 100vw, 45vw"
        />
        <div>
          <p className="page-hero__kicker">{t.directKicker}</p>
          <h2 id="direct-title">{t.directTitle}</h2>
          <p className="split-section__body">{t.directBody}</p>
          <Link className="text-link" href="/search">
            {t.browseProviders} <Icon name="arrow" size={17} />
          </Link>
        </div>
      </section>
    </>
  );
}
