"use client";

import { copy } from "@fleettrust/copy";
import Link from "next/link";

import { PUBLIC_NAV } from "@/lib/nav";
import { useSession } from "@/lib/session";

import { NavMenu } from "./nav-menu";

export function SkipLink() {
  return (
    <a className="skip-link" href="#main">
      {copy.web.site.skipToContent}
    </a>
  );
}

function AccountLink() {
  const { status } = useSession();
  if (status === "loading") return null;
  return status === "signed-in" ? (
    <Link className="btn btn--secondary" href="/app">
      {copy.web.site.yourDashboard}
    </Link>
  ) : (
    <Link className="btn btn--primary" href="/sign-in">
      {copy.web.site.signIn}
    </Link>
  );
}

/** Header for public pages. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href="/">
          {copy.web.site.brand}
        </Link>
        <div className="site-header__nav">
          <NavMenu label={copy.web.site.mainNav} items={PUBLIC_NAV} />
        </div>
        <div className="site-header__account">
          <AccountLink />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container stack small">
        <p>{copy.web.site.footerAbout}</p>
        <p>{copy.web.site.footerTrust}</p>
        <ul className="cluster list-plain" aria-label={copy.web.site.footerLinks}>
          <li>
            <Link href="/accessibility">{copy.web.site.accessibility}</Link>
          </li>
          <li>
            <Link href="/emergency">{copy.web.site.emergencyHelp}</Link>
          </li>
          <li>
            <Link href="/legal/privacy">{copy.web.site.privacyNotice}</Link>
          </li>
          <li>
            <Link href="/legal/terms">{copy.web.site.terms}</Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}
