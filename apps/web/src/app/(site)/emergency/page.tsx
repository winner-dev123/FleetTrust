import { DEFAULT_EMERGENCY_GUIDANCE, EMERGENCY_DISCLAIMER } from "@fleettrust/types";
import type { Metadata } from "next";

import { ButtonLink } from "@/components/button";

export const metadata: Metadata = {
  title: "Emergency help",
  description: "What to do if you need help on the road, and how FleetTrust alerts can help.",
};

/**
 * Public emergency page. Static on purpose: it must load even when the API is down. Wording
 * never implies that help is certain (SRS J3, ADR-0010; checked by a test).
 */
export default function EmergencyPage() {
  return (
    <div className="container container--readable stack stack--lg">
      <header>
        <h1>Emergency help</h1>
      </header>
      <section className="emergency-panel stack" aria-labelledby="danger-heading">
        <h2 id="danger-heading">If anyone is in danger</h2>
        <p>
          <strong>{DEFAULT_EMERGENCY_GUIDANCE}</strong> Do this first, before using FleetTrust.
        </p>
        <p>{EMERGENCY_DISCLAIMER}</p>
      </section>

      <section className="stack" aria-labelledby="alert-heading">
        <h2 id="alert-heading">Alert the people you trust</h2>
        <p>
          With a free account you can choose trusted contacts. One tap sends them an alert with your
          situation and, if you choose, your location for that alert only. You can also ask nearby
          providers who offer roadside assistance; they see only an approximate area.
        </p>
        <p>Emergency alerts are never limited by your plan.</p>
        <div className="cluster">
          <ButtonLink variant="danger" large href="/app/emergency">
            Open emergency alerts
          </ButtonLink>
          <ButtonLink variant="secondary" href="/search?category=towing">
            Find towing nearby
          </ButtonLink>
        </div>
        <p className="small muted">You&apos;ll be asked to sign in if you aren&apos;t already.</p>
      </section>

      <section aria-labelledby="safety-heading">
        <h2 id="safety-heading">While you wait</h2>
        <ul>
          <li>Move away from traffic if it&apos;s safe to do so.</li>
          <li>Switch on hazard lights and use a warning triangle if you have one.</li>
          <li>Keep your phone charged and share your location only with people you trust.</li>
          <li>Don&apos;t pay anyone upfront for roadside help you didn&apos;t arrange.</li>
        </ul>
      </section>
    </div>
  );
}
