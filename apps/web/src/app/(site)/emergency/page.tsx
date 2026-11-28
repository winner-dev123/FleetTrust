import { copy } from "@fleettrust/copy";
import { DEFAULT_EMERGENCY_GUIDANCE, EMERGENCY_DISCLAIMER } from "@fleettrust/types";
import type { Metadata } from "next";
import Image from "next/image";

import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icon";
import { PHOTOS } from "@/lib/photos";

export const metadata: Metadata = {
  title: copy.web.emergency.title,
  description: copy.web.emergency.description,
};

/**
 * Public emergency page (Figma Make layout: warm band, guidance left, alert card right). Static
 * on purpose: it must load even when the API is down. Wording never implies that help is
 * certain (SRS J3, ADR-0010; checked by a test). The danger guidance comes first.
 */
export default function EmergencyPage() {
  return (
    <div className="emergency-page">
      <div className="emergency-page__grid">
        <div className="emergency-page__copy">
          <p className="emergency-page__kicker">
            <Icon name="shield" size={16} /> {copy.web.nav.emergencyHelp}
          </p>
          <h1>{copy.web.emergency.title}</h1>
          <section className="danger-notice" aria-labelledby="danger-heading">
            <h2 id="danger-heading">{copy.web.emergency.dangerTitle}</h2>
            <p>
              <strong>{DEFAULT_EMERGENCY_GUIDANCE}</strong> {copy.web.emergency.doThisFirst}
            </p>
            <p>{EMERGENCY_DISCLAIMER}</p>
          </section>
          <Image
            className="emergency-page__photo"
            src={PHOTOS.safePullout}
            alt={copy.web.emergency.photoAlt}
            sizes="(max-width: 760px) 100vw, 45vw"
          />
        </div>

        <section className="emergency-page__card stack" aria-labelledby="alert-heading">
          <h2 id="alert-heading">{copy.web.emergency.alertTitle}</h2>
          <p>{copy.web.emergency.alertBody}</p>
          <p>{copy.web.emergency.neverLimited}</p>
          <div className="cluster">
            <ButtonLink variant="danger" large href="/app/emergency">
              {copy.web.emergency.openAlerts}
            </ButtonLink>
            <ButtonLink variant="secondary" href="/search?category=towing">
              {copy.web.emergency.findTowing}
            </ButtonLink>
          </div>
          <p className="small muted">{copy.web.emergency.signInNote}</p>
        </section>
      </div>

      <section className="emergency-page__safety" aria-labelledby="safety-heading">
        <h2 id="safety-heading">{copy.web.emergency.waitTitle}</h2>
        <ul>
          <li>{copy.web.emergency.waitTraffic}</li>
          <li>{copy.web.emergency.waitHazards}</li>
          <li>{copy.web.emergency.waitPhone}</li>
          <li>{copy.web.emergency.waitPayment}</li>
        </ul>
      </section>
    </div>
  );
}
