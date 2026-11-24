"use client";

import type { PublicProviderProfile } from "@fleettrust/types";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useSession } from "@/lib/session";

/**
 * Contact details are shown to signed-in people only (OQ-11): the profile is fetched again with
 * the person's token in the browser.
 */
export function ContactDetails({ slug }: { slug: string }) {
  const { api, status } = useSession();
  const [contact, setContact] = useState<PublicProviderProfile["contact"]>(null);

  useEffect(() => {
    if (status !== "signed-in") return;
    let active = true;
    api.provider(slug, { signedIn: true }).then(
      (profile) => {
        if (active) setContact(profile.contact);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api, slug, status]);

  return (
    <section aria-labelledby="contact-heading" className="card card--muted">
      <h2 id="contact-heading" className="card__title">
        Contact
      </h2>
      {status !== "signed-in" ? (
        <p style={{ margin: 0 }}>
          <Link href="/sign-in">Sign in</Link> to see phone, email and street addresses.
        </p>
      ) : contact ? (
        <ul className="list-plain">
          {contact.phone ? (
            <li>
              Phone: <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}>{contact.phone}</a>
            </li>
          ) : null}
          {contact.email ? (
            <li>
              Email: <a href={`mailto:${contact.email}`}>{contact.email}</a>
            </li>
          ) : null}
          {contact.website ? (
            <li>
              Website:{" "}
              <a href={contact.website} rel="nofollow noopener noreferrer" target="_blank">
                {contact.website}
              </a>
            </li>
          ) : null}
        </ul>
      ) : (
        <p style={{ margin: 0 }} className="muted">
          No contact details published.
        </p>
      )}
      <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
        Agree the price and pay the provider directly. FleetTrust does not process payments.
      </p>
    </section>
  );
}
