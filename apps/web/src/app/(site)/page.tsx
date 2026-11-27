import { copy, fill } from "@fleettrust/copy";
import { CATEGORY_LABELS, type ProviderCategory } from "@fleettrust/types";
import Image from "next/image";
import Link from "next/link";

import { Icon, type IconName } from "@/components/icon";
import { webEnv } from "@/env";

import heroImage from "../../../public/images/fleettrust-hero.webp";
import mechanicImage from "../../../public/images/fleettrust-mechanic.webp";
import roadsideImage from "../../../public/images/fleettrust-roadside.webp";
import styles from "./home.module.css";

const t = copy.web.home;

/** Class name from home.module.css (empty if it doesn't exist). */
const cls = (name: string): string => styles[name] ?? "";

/** Service shortcuts (Figma Make design), each opening a real category search. */
const SERVICES: readonly { note: string; icon: IconName; category: ProviderCategory }[] = [
  { note: t.serviceWorkshop, icon: "tools", category: "workshop" },
  { note: t.serviceTowing, icon: "tow", category: "towing" },
  { note: t.serviceTyres, icon: "tyre", category: "tyres" },
  { note: t.serviceFuel, icon: "fuel", category: "fuel_station" },
  { note: t.serviceMobile, icon: "wrench", category: "mobile_mechanic" },
];

const READS: readonly { title: string; icon: IconName; art: string; query: string }[] = [
  { title: t.readTyres, icon: "tyre", art: "", query: "tyre" },
  { title: t.readKit, icon: "car", art: "carArt", query: "kit" },
  { title: t.readQuotes, icon: "tools", art: "toolsArt", query: "quote" },
];

/**
 * Home page, built from the FleetTrust Figma Make design: search first, emergency one tap away,
 * and what FleetTrust does (and doesn't). Claims are limited to what the product really does.
 */
export default function HomePage() {
  return (
    <div className={cls("home")}>
      <section className={cls("hero")} aria-labelledby="hero-heading">
        <div className={cls("heroGlow")} />
        <div className={`${cls("container")} ${cls("heroGrid")}`}>
          <div className={cls("heroCopy")}>
            <p className={cls("eyebrow")}>
              <span>
                <Icon name="shield" size={14} />
              </span>
              {t.eyebrow}
            </p>
            <h1 id="hero-heading">
              {t.titleLead}
              <br />
              {t.titleRest} <em>{t.titleEm}</em>
            </h1>
            <p className={cls("lead")}>{t.intro}</p>
            <form className={cls("searchPanel")} action="/search" method="get" role="search">
              <div className={cls("searchField")}>
                <label htmlFor="home-q">{t.whatLabel}</label>
                <div className={cls("inputWrap")}>
                  <Icon name="search" size={21} />
                  <input id="home-q" name="q" maxLength={100} placeholder={t.whatPlaceholder} />
                </div>
              </div>
              <div className={cls("divider")} />
              <div className={`${cls("searchField")} ${cls("location")}`}>
                <label htmlFor="home-where">{t.whereLabel}</label>
                <div className={cls("inputWrap")}>
                  <Icon name="pin" size={21} />
                  <input
                    id="home-where"
                    name="where"
                    maxLength={100}
                    autoComplete="address-level2"
                    placeholder={t.wherePlaceholder}
                  />
                </div>
              </div>
              <button className={cls("searchButton")} type="submit">
                {t.search} <Icon name="arrow" size={19} />
              </button>
            </form>
            <div className={cls("trustRow")}>
              <span className={cls("badges")} aria-hidden="true">
                <span>
                  <Icon name="shield" size={15} />
                </span>
                <span>
                  <Icon name="check" size={15} />
                </span>
                <span>
                  <Icon name="search" size={15} />
                </span>
              </span>
              <span>
                <strong>{t.trustTitle}</strong>
                <small>{t.trustBody}</small>
              </span>
            </div>
          </div>
          <div className={cls("heroVisual")}>
            <div className={cls("heroShape")} />
            <Image
              className={cls("heroImage")}
              src={heroImage}
              alt={t.heroImageAlt}
              priority
              sizes="(max-width: 760px) 96vw, 50vw"
            />
            <div className={`${cls("floatingCard")} ${cls("verifiedCard")}`}>
              <span className={cls("floatingIcon")}>
                <Icon name="shield" size={22} />
              </span>
              <span>
                <strong>{t.verifiedTitle}</strong>
                <small>{t.verifiedBody}</small>
              </span>
            </div>
            <div className={`${cls("floatingCard")} ${cls("alertsCard")}`}>
              <span className={cls("statusDot")} />
              <span>
                <small>{t.alertsCardLabel}</small>
                <strong>{t.alertsCardValue}</strong>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        className={`${cls("services")} ${cls("container")}`}
        aria-labelledby="services-heading"
      >
        <div className={cls("sectionHeading")}>
          <div>
            <span className={cls("kicker")}>{t.servicesKicker}</span>
            <h2 id="services-heading">{t.servicesTitle}</h2>
          </div>
          <Link href="/search">
            {t.viewAllServices} <Icon name="arrow" size={18} />
          </Link>
        </div>
        <ul className={cls("serviceGrid")}>
          {SERVICES.map((item) => (
            <li key={item.category} data-reveal>
              <Link className={cls("serviceCard")} href={`/search?category=${item.category}`}>
                <span className={cls("serviceIcon")}>
                  <Icon name={item.icon} size={26} />
                </span>
                <span>
                  <strong>{CATEGORY_LABELS[item.category]}</strong>
                  <small>{item.note}</small>
                </span>
                <span className={cls("roundArrow")}>
                  <Icon name="arrow" size={17} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={cls("howSection")} id="how" aria-labelledby="how-heading">
        <div className={`${cls("container")} ${cls("howGrid")}`}>
          <div className={cls("photoStack")} data-reveal>
            <Image
              className={cls("mechanicPhoto")}
              src={mechanicImage}
              alt={t.mechanicImageAlt}
              sizes="(max-width: 760px) 100vw, 45vw"
            />
            <div className={cls("experienceCard")}>
              <strong>{t.evidenceCardTitle}</strong>
              <span>
                <Icon name="check" size={17} /> {t.evidenceCardLabels}
              </span>
              <span>
                <Icon name="check" size={17} /> {t.evidenceCardRankings}
              </span>
            </div>
          </div>
          <div className={cls("howCopy")} data-reveal>
            <span className={cls("kicker")}>{t.howKicker}</span>
            <h2 id="how-heading">{t.howTitle}</h2>
            <p>{t.howIntro}</p>
            <ol className={cls("steps")}>
              {[
                [t.step1Title, t.step1Body],
                [t.step2Title, t.step2Body],
                [t.step3Title, t.step3Body],
              ].map(([title, body], index) => (
                <li key={title}>
                  <span aria-hidden="true">{`0${String(index + 1)}`}</span>
                  <div>
                    <strong>{title}</strong>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section
        className={`${cls("roadside")} ${cls("container")}`}
        aria-labelledby="roadside-heading"
      >
        <Image
          className={cls("roadsideImage")}
          data-reveal
          src={roadsideImage}
          alt={t.roadsideImageAlt}
          sizes="(max-width: 760px) 100vw, 45vw"
        />
        <div className={cls("roadsideCopy")} data-reveal>
          <span className={cls("kicker")}>{t.roadsideKicker}</span>
          <h2 id="roadside-heading">{t.roadsideTitle}</h2>
          <p>{t.roadsideBody}</p>
          <div className={cls("roadsideActions")}>
            <Link className={cls("helpButton")} href="/emergency">
              {t.helpNow} <Icon name="arrow" size={18} />
            </Link>
            <span>
              <Icon name="clock" size={19} /> {t.roadsideFree}
            </span>
          </div>
          <small>
            <strong>{t.roadsideDangerLead}</strong> {t.roadsideDangerBody}
          </small>
        </div>
      </section>

      <section className={`${cls("stories")} ${cls("container")}`} aria-labelledby="reads-heading">
        <div className={cls("sectionHeading")}>
          <div>
            <span className={cls("kicker")}>{t.readsKicker}</span>
            <h2 id="reads-heading">{t.readsTitle}</h2>
          </div>
          <Link href="/articles">
            {t.exploreHub} <Icon name="arrow" size={18} />
          </Link>
        </div>
        <div className={cls("storyGrid")}>
          {READS.map((read) => (
            <article key={read.query} data-reveal>
              <span className={`${cls("storyArt")} ${read.art ? cls(read.art) : ""}`}>
                <Icon name={read.icon} size={56} />
              </span>
              <div>
                <small>{t.readTopic}</small>
                <h3>{read.title}</h3>
                <Link href={`/articles?q=${read.query}`}>
                  {t.readMore} <Icon name="arrow" size={16} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        className={`${cls("providerBanner")} ${cls("container")}`}
        id="providers"
        data-reveal
        aria-labelledby="providers-heading"
      >
        <div>
          <span className={cls("kicker")}>{t.providersKicker}</span>
          <h2 id="providers-heading">{t.providersTitle}</h2>
          <p>{t.providersBody}</p>
        </div>
        <Link className={cls("bannerButton")} href="/for-providers">
          {t.createAccount} <Icon name="arrow" size={18} />
        </Link>
      </section>

      {webEnv.appEnv !== "production" ? (
        <p className={`${cls("container")} ${cls("envNote")}`}>
          {fill(t.environment, { name: webEnv.appEnv })}
        </p>
      ) : null}
    </div>
  );
}
