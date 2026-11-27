import { copy, fill } from "@fleettrust/copy";
import { ApiError } from "@fleettrust/sdk";
import {
  CATEGORY_LABELS,
  openingStatusLabel,
  type PublicProviderProfile,
  VEHICLE_TYPE_LABELS,
  verificationLabel,
} from "@fleettrust/types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { cache } from "react";

import { ButtonLink } from "@/components/button";
import { Badge, Notice } from "@/components/feedback";
import { Icon } from "@/components/icon";
import { CATEGORY_ICONS } from "@/lib/category-icons";
import { formatDate } from "@fleettrust/types";
import { publicApi } from "@/lib/public-api";

import { ContactDetails } from "./contact-details";

export const dynamic = "force-dynamic";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAMES: Record<(typeof DAYS)[number], string> = copy.web.provider.days;

const loadProfile = cache(async (slug: string): Promise<PublicProviderProfile> => {
  try {
    return await publicApi().provider(slug);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
});

export async function generateMetadata(props: PageProps<"/providers/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const profile = await loadProfile(slug);
  return {
    title: profile.tradingName,
    description:
      profile.description?.slice(0, 160) ??
      fill(copy.web.provider.descriptionFallback, {
        categories: profile.categories.map((c) => CATEGORY_LABELS[c]).join(", "),
      }),
  };
}

/** Public provider profile: what they offer, where, when, and what FleetTrust verified. */
export default async function ProviderPage(props: PageProps<"/providers/[slug]">) {
  const { slug } = await props.params;
  const profile = await loadProfile(slug);
  const logo = profile.media.find((m) => m.kind === "logo");
  const firstCategory = profile.categories[0];
  // Hours in the side panel only when there is one branch; otherwise see each branch card.
  const onlyBranch = profile.branches.length === 1 ? profile.branches[0] : undefined;
  const verifiedCount = profile.verification.filter((b) => b.status === "verified").length;
  const serviceArea = [...new Set(profile.branches.map((b) => b.locality).filter(Boolean))].join(
    ", ",
  );

  return (
    <div className="container profile-page">
      <Link className="back-link" href="/search">
        <span aria-hidden="true">←</span> {copy.web.provider.backToSearch}
      </Link>
      <header className="profile-header">
        {logo ? (
          // Provider media is served from signed storage URLs, not Next image optimisation.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="profile-header__logo"
            src={logo.url}
            alt={logo.altText ?? `${profile.tradingName} logo`}
            width={76}
            height={76}
          />
        ) : (
          <span className="profile-header__avatar" aria-hidden="true">
            <Icon name={firstCategory ? CATEGORY_ICONS[firstCategory] : "car"} size={38} />
          </span>
        )}
        <div>
          {verifiedCount > 0 ? (
            <span className="verified-label">
              <Icon name="shield" size={14} /> {copy.web.provider.evidenceChecked}
            </span>
          ) : null}
          <h1>{profile.tradingName}</h1>
          <p className="profile-header__meta">
            {profile.categories.map((c) => CATEGORY_LABELS[c]).join(" · ")}
          </p>
        </div>
        <ButtonLink large href={`/app/requests/new?provider=${encodeURIComponent(profile.slug)}`}>
          {copy.web.provider.requestQuote} <Icon name="arrow" size={18} />
        </ButtonLink>
      </header>

      <div className="profile-grid">
        <div className="stack stack--lg">
          {profile.description ? (
            <section aria-labelledby="about-heading" className="profile-section">
              <h2 id="about-heading">{copy.web.provider.about}</h2>
              <p style={{ whiteSpace: "pre-line" }}>{profile.description}</p>
              {profile.vehicleTypes.length > 0 ? (
                <p className="small">
                  {fill(copy.web.provider.vehicles, {
                    types: profile.vehicleTypes.map((v) => VEHICLE_TYPE_LABELS[v]).join(", "),
                  })}
                </p>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="services-heading" className="profile-section stack">
            <h2 id="services-heading">{copy.web.provider.services}</h2>
            <Notice>
              <p className="small">{profile.catalog.disclaimer}</p>
            </Notice>
            {profile.catalog.offerings.length === 0 ? (
              <p className="muted">{copy.web.provider.noServices}</p>
            ) : (
              <div
                className="table-wrap"
                tabIndex={0}
                role="region"
                aria-label={copy.web.provider.services}
              >
                <table className="table">
                  <caption className="visually-hidden">{copy.web.provider.services}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{copy.web.provider.service}</th>
                      <th scope="col">{copy.web.provider.indicativePrice}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.catalog.offerings.map((offering) => (
                      <tr key={offering.id}>
                        <td>
                          <strong>{offering.name}</strong>
                          {offering.description ? (
                            <span className="small muted" style={{ display: "block" }}>
                              {offering.description}
                            </span>
                          ) : null}
                        </td>
                        <td>{offering.price.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="branches-heading" className="profile-section stack">
            <h2 id="branches-heading">{copy.web.provider.branches}</h2>
            <div className="grid">
              {profile.branches.map((branch) => (
                <article key={branch.id} className="card stack" style={{ gap: 8 }}>
                  <h3 className="card__title">{branch.name}</h3>
                  <p className="profile-fact">
                    <Icon name="pin" size={18} />
                    <span>
                      {[branch.addressLine1, branch.locality, branch.region, branch.countryCode]
                        .filter(Boolean)
                        .join(", ")}
                      {branch.location.approximate ? (
                        <small>{copy.web.provider.addressAfterSignIn}</small>
                      ) : null}
                    </span>
                  </p>
                  <p className="profile-fact">
                    <Icon name="clock" size={18} />
                    <span>
                      <strong>{openingStatusLabel(branch.hours.status)}</strong>
                      {branch.serviceRadiusKm ? (
                        <small>
                          {fill(copy.web.provider.travelsUpTo, { km: branch.serviceRadiusKm })}
                        </small>
                      ) : null}
                    </span>
                  </p>
                  {branch.hours.weekly ? (
                    <details>
                      <summary>{copy.web.provider.weeklyHours}</summary>
                      <dl className="small">
                        {DAYS.map((day) => {
                          const intervals = branch.hours.weekly?.[day] ?? [];
                          return (
                            <div key={day} className="cluster cluster--between">
                              <dt>{DAY_NAMES[day]}</dt>
                              <dd style={{ margin: 0 }}>
                                {intervals.length === 0
                                  ? copy.web.provider.closed
                                  : intervals.map((i) => `${i.opens}–${i.closes}`).join(", ")}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                      <p className="small muted">
                        {fill(copy.web.provider.localTimes, { timeZone: branch.timeZone })}
                      </p>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="profile-aside stack" aria-labelledby="details-heading">
          <h2 id="details-heading" className="card__title">
            {copy.web.provider.details}
          </h2>
          {serviceArea ? (
            <p className="profile-fact">
              <Icon name="pin" size={18} />
              <span>
                <strong>{copy.web.provider.serviceArea}</strong>
                {serviceArea}
              </span>
            </p>
          ) : null}
          {onlyBranch ? (
            <p className="profile-fact">
              <Icon name="clock" size={18} />
              <span>
                <strong>{copy.web.provider.openingHours}</strong>
                {openingStatusLabel(onlyBranch.hours.status)}
              </span>
            </p>
          ) : null}
          <section aria-labelledby="verification-heading" className="evidence-box">
            <h3 id="verification-heading">
              <Icon name="shield" size={20} /> {copy.web.provider.verification}
            </h3>
            <ul className="list-plain stack" style={{ gap: 8 }}>
              {profile.verification.map((badge) => (
                <li key={badge.badgeType} style={{ marginTop: 0 }}>
                  <Badge tone={badge.status === "verified" ? "verified" : "caution"}>
                    {verificationLabel(badge.badgeType, badge.status)}
                    {badge.status === "verified" && badge.expiresAt
                      ? ` ${fill(copy.web.provider.badgeUntil, { date: formatDate(badge.expiresAt) })}`
                      : ""}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="small">{copy.web.provider.verificationNote}</p>
          </section>
          <ContactDetails slug={profile.slug} />
        </aside>
      </div>

      <p className="small muted profile-page__published">
        {fill(copy.web.provider.published, { date: formatDate(profile.publishedAt) })}
      </p>
    </div>
  );
}
