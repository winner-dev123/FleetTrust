import { copy } from "@fleettrust/copy";
import type { Metadata } from "next";
import Image from "next/image";

import { ButtonLink } from "@/components/button";
import { Icon, type IconName } from "@/components/icon";
import { PHOTOS } from "@/lib/photos";

const t = copy.web.forProviders;

export const metadata: Metadata = { title: t.title, description: t.description };

/**
 * For providers (Figma Make page). The Make mock-up showed sample numbers and a sign-up form;
 * here the card lists what the workspace really contains and sign-up goes through sign-in and
 * onboarding, where the business is created.
 */
export default function ForProvidersPage() {
  const workspace: readonly [IconName, string, string][] = [
    ["search", t.workspaceRequests, t.workspaceRequestsBody],
    ["tools", t.workspaceServices, t.workspaceServicesBody],
    ["clock", t.workspaceBranches, t.workspaceBranchesBody],
    ["user", t.workspaceTeam, t.workspaceTeamBody],
  ];
  const benefits: readonly [IconName, string, string][] = [
    ["search", t.benefitFindTitle, t.benefitFindBody],
    ["clock", t.benefitAdminTitle, t.benefitAdminBody],
    ["shield", t.benefitEvidenceTitle, t.benefitEvidenceBody],
  ];

  return (
    <>
      <section className="feature-hero feature-hero--cool" aria-labelledby="providers-title">
        <div className="feature-hero__grid">
          <div>
            <p className="page-hero__kicker">{t.kicker}</p>
            <h1 id="providers-title">{t.heroTitle}</h1>
            <p className="feature-hero__intro">{t.heroIntro}</p>
            <ButtonLink large href="/sign-in">
              {copy.web.home.createAccount} <Icon name="arrow" size={18} />
            </ButtonLink>
            <p className="feature-hero__note">{t.plansNote}</p>
          </div>
          <div className="provider-visual">
            <Image
              className="provider-visual__portrait"
              src={PHOTOS.workshopOwner}
              alt={t.portraitAlt}
              sizes="(max-width: 900px) 100vw, 45vw"
              priority
            />
            <section className="workspace-card" aria-labelledby="workspace-title">
              <div className="workspace-card__dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <h2 id="workspace-title">{t.workspaceTitle}</h2>
              <ul className="list-plain">
                {workspace.map(([icon, title, body]) => (
                  <li key={title} className="workspace-card__row">
                    <span className="workspace-card__icon" aria-hidden="true">
                      <Icon name={icon} size={22} />
                    </span>
                    <span>
                      <strong>{title}</strong>
                      <small>{body}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </section>

      <section className="feature-section" aria-labelledby="benefits-title">
        <div className="feature-section__intro">
          <p className="page-hero__kicker">{t.benefitsKicker}</p>
          <h2 id="benefits-title">{t.benefitsTitle}</h2>
        </div>
        <ul className="feature-grid list-plain">
          {benefits.map(([icon, title, body]) => (
            <li key={title} className="feature-card">
              <span className="feature-card__icon" aria-hidden="true">
                <Icon name={icon} size={26} />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="join-band" aria-labelledby="join-title">
        <div className="join-band__grid">
          <div>
            <p className="page-hero__kicker">{t.joinKicker}</p>
            <h2 id="join-title">{t.joinTitle}</h2>
            <p className="join-band__intro">{t.joinIntro}</p>
          </div>
          <div className="join-band__card">
            <ol className="join-band__steps">
              <li>{t.joinStep1}</li>
              <li>{t.joinStep2}</li>
              <li>{t.joinStep3}</li>
            </ol>
            <ButtonLink large block href="/sign-in">
              {copy.web.home.createAccount} <Icon name="arrow" size={18} />
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
