import { CURRENT_CONSENT_VERSIONS } from "@fleettrust/types";
import type { Metadata } from "next";
import Link from "next/link";

import { Notice } from "@/components/feedback";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "What FleetTrust collects, why, how long it's kept, and your rights.",
};

/** Privacy notice. DRAFT until legal review (OQ-17); the facts reflect how the product works. */
export default function PrivacyPage() {
  return (
    <div className="container container--readable stack stack--lg">
      <header className="stack">
        <h1>Privacy notice</h1>
        <p className="muted">Version {CURRENT_CONSENT_VERSIONS.privacy}</p>
        <Notice tone="caution" title="Draft">
          <p>
            This notice is a draft awaiting legal review. It describes how FleetTrust works today.
          </p>
        </Notice>
      </header>
      <section className="stack" aria-labelledby="collect">
        <h2 id="collect">What we collect</h2>
        <ul>
          <li>Your email address and sign-in method (from Firebase Authentication).</li>
          <li>Your display name and time zone, if you add them.</li>
          <li>
            What you create: service requests (with the vehicle and the place you choose), vehicles,
            messages, articles, comments, lists, trusted contacts and emergency alerts.
          </li>
          <li>
            Documents you upload for verification or your vehicle vault. They are encrypted and only
            reviewers or people you share them with can open them.
          </li>
          <li>
            Your location only when you share it: for a search, a request or an alert. Alert
            locations are erased when the alert closes. The app never tracks you in the background.
          </li>
        </ul>
      </section>
      <section className="stack" aria-labelledby="use">
        <h2 id="use">Why</h2>
        <p>
          To run the service you asked for (find providers, request quotes, message, alert your
          contacts), to keep it safe (moderation, abuse prevention, an audit log of staff actions),
          and, only if you agree, to count anonymous usage or send product news.
        </p>
      </section>
      <section className="stack" aria-labelledby="share">
        <h2 id="share">Who sees it</h2>
        <p>
          Providers see the requests you send them. Trusted contacts see the alerts you raise.
          Nearby providers see only the type of problem and an approximate area. FleetTrust staff
          see what their role needs, and every staff action is recorded. We use Google Cloud and
          Firebase to host the service. We don&apos;t sell your data.
        </p>
      </section>
      <section className="stack" aria-labelledby="keep">
        <h2 id="keep">How long we keep it</h2>
        <p>
          Your data stays while your account is open. Some records are deleted sooner: read
          notifications after 6 months, verification documents 90 days after a decision, and push
          registrations after 9 months of inactivity. The full list is in our data retention policy.
        </p>
      </section>
      <section className="stack" aria-labelledby="rights">
        <h2 id="rights">Your rights</h2>
        <ul>
          <li>
            <strong>See and take your data:</strong> download a copy from your{" "}
            <Link href="/app/account">account page</Link>.
          </li>
          <li>
            <strong>Correct it:</strong> edit your profile, vehicles and content directly.
          </li>
          <li>
            <strong>Delete it:</strong> delete your account from your account page or the app. Your
            personal data is erased; messages you sent stay for the people who received them, shown
            as from a deleted member.
          </li>
          <li>
            <strong>Change your mind:</strong> turn optional choices on or off at any time.
          </li>
        </ul>
      </section>
      <section className="stack" aria-labelledby="contact">
        <h2 id="contact">Contact</h2>
        <p>A privacy contact will be listed here before launch.</p>
      </section>
    </div>
  );
}
