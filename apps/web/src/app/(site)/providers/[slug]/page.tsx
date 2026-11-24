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
import { cache } from "react";

import { ButtonLink } from "@/components/button";
import { Badge, Notice } from "@/components/feedback";
import { formatDate } from "@/lib/format";
import { publicApi } from "@/lib/public-api";

import { ContactDetails } from "./contact-details";

export const dynamic = "force-dynamic";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAMES: Record<(typeof DAYS)[number], string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

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
      `${profile.categories.map((c) => CATEGORY_LABELS[c]).join(", ")} on FleetTrust`,
  };
}

/** Public provider profile: what they offer, where, when, and what FleetTrust verified. */
export default async function ProviderPage(props: PageProps<"/providers/[slug]">) {
  const { slug } = await props.params;
  const profile = await loadProfile(slug);
  const logo = profile.media.find((m) => m.kind === "logo");

  return (
    <div className="container stack stack--lg">
      <header className="stack">
        <div className="cluster">
          {logo ? (
            // Provider media is served from signed storage URLs, not Next image optimisation.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo.url}
              alt={logo.altText ?? `${profile.tradingName} logo`}
              width={64}
              height={64}
              style={{ borderRadius: 8, objectFit: "cover" }}
            />
          ) : null}
          <div>
            <h1 style={{ marginBottom: 4 }}>{profile.tradingName}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {profile.categories.map((c) => CATEGORY_LABELS[c]).join(" · ")}
            </p>
          </div>
        </div>
        <section aria-labelledby="verification-heading" className="stack" style={{ gap: 8 }}>
          <h2 id="verification-heading" className="visually-hidden">
            Verification
          </h2>
          <ul className="cluster list-plain">
            {profile.verification.map((badge) => (
              <li key={badge.badgeType} style={{ marginTop: 0 }}>
                <Badge tone={badge.status === "verified" ? "verified" : "caution"}>
                  {verificationLabel(badge.badgeType, badge.status)}
                  {badge.status === "verified" && badge.expiresAt
                    ? ` (until ${formatDate(badge.expiresAt)})`
                    : ""}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="small muted">
            Verification means FleetTrust checked documents for that item. It isn&apos;t an
            endorsement or a quality rating, and plans can&apos;t buy it.
          </p>
        </section>
        <div className="cluster">
          <ButtonLink href={`/app/requests/new?provider=${encodeURIComponent(profile.slug)}`}>
            Request a quote
          </ButtonLink>
          <ButtonLink variant="secondary" href="/search">
            Back to search
          </ButtonLink>
        </div>
      </header>

      {profile.description ? (
        <section aria-labelledby="about-heading">
          <h2 id="about-heading">About</h2>
          <p style={{ whiteSpace: "pre-line" }}>{profile.description}</p>
          {profile.vehicleTypes.length > 0 ? (
            <p className="small">
              Vehicles: {profile.vehicleTypes.map((v) => VEHICLE_TYPE_LABELS[v]).join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      <ContactDetails slug={profile.slug} />

      <section aria-labelledby="services-heading" className="stack">
        <h2 id="services-heading">Services and indicative prices</h2>
        <Notice>
          <p className="small">{profile.catalog.disclaimer}</p>
        </Notice>
        {profile.catalog.offerings.length === 0 ? (
          <p className="muted">No services listed yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Services and indicative prices</caption>
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Indicative price</th>
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

      <section aria-labelledby="branches-heading" className="stack">
        <h2 id="branches-heading">Branches and opening hours</h2>
        <div className="grid">
          {profile.branches.map((branch) => (
            <article key={branch.id} className="card stack" style={{ gap: 8 }}>
              <h3 className="card__title">{branch.name}</h3>
              <p style={{ margin: 0 }}>
                {[branch.addressLine1, branch.locality, branch.region, branch.countryCode]
                  .filter(Boolean)
                  .join(", ")}
                {branch.location.approximate ? (
                  <span className="small muted" style={{ display: "block" }}>
                    Street address shown after you sign in.
                  </span>
                ) : null}
              </p>
              <p style={{ margin: 0 }}>
                <strong>{openingStatusLabel(branch.hours.status)}</strong>
              </p>
              {branch.serviceRadiusKm ? (
                <p className="small" style={{ margin: 0 }}>
                  Travels up to {branch.serviceRadiusKm} km
                </p>
              ) : null}
              {branch.hours.weekly ? (
                <details>
                  <summary>Weekly hours</summary>
                  <dl className="small">
                    {DAYS.map((day) => {
                      const intervals = branch.hours.weekly?.[day] ?? [];
                      return (
                        <div key={day} className="cluster cluster--between">
                          <dt>{DAY_NAMES[day]}</dt>
                          <dd style={{ margin: 0 }}>
                            {intervals.length === 0
                              ? "Closed"
                              : intervals.map((i) => `${i.opens}–${i.closes}`).join(", ")}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  <p className="small muted">Times are local ({branch.timeZone}).</p>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <p className="small muted">Profile published {formatDate(profile.publishedAt)}.</p>
    </div>
  );
}
