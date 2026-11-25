import { CURRENT_CONSENT_VERSIONS } from "@fleettrust/types";
import type { Metadata } from "next";

import { Notice } from "@/components/feedback";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The rules for using FleetTrust.",
};

/** Terms of service. DRAFT until legal review (OQ-17). */
export default function TermsPage() {
  return (
    <div className="container container--readable stack stack--lg">
      <header className="stack">
        <h1>Terms of service</h1>
        <p className="muted">Version {CURRENT_CONSENT_VERSIONS.terms}</p>
        <Notice tone="caution" title="Draft">
          <p>These terms are a draft awaiting legal review.</p>
        </Notice>
      </header>
      <section className="stack" aria-labelledby="service">
        <h2 id="service">The service</h2>
        <p>
          FleetTrust helps you find vehicle services, ask for quotes and get help on the road.
          Prices shown are indicative; you agree the final price with the provider and pay them
          directly. FleetTrust doesn&apos;t take payments.
        </p>
      </section>
      <section className="stack" aria-labelledby="emergency">
        <h2 id="emergency">Emergencies</h2>
        <p>
          FleetTrust doesn&apos;t replace emergency services. If anyone is in danger, call your
          local emergency number first. Alerts to your contacts and providers may not be seen in
          time.
        </p>
      </section>
      <section className="stack" aria-labelledby="conduct">
        <h2 id="conduct">Your conduct</h2>
        <p>
          You must be 18 or older. Be honest, respect other people, and don&apos;t post unlawful,
          misleading or abusive content. Moderators may hide content or suspend accounts; you can
          appeal their decisions.
        </p>
      </section>
      <section className="stack" aria-labelledby="verification">
        <h2 id="verification">Verification</h2>
        <p>
          A verified badge means FleetTrust checked documents for that item. It isn&apos;t an
          endorsement or a quality rating, and plans can&apos;t buy it.
        </p>
      </section>
    </div>
  );
}
