"use client";

import { copy } from "@fleettrust/copy";
import Link from "next/link";

import { PUBLIC_NAV } from "@/lib/nav";
import { useSession } from "@/lib/session";

import { Icon } from "./icon";
import { NavMenu } from "./nav-menu";

export function SkipLink() {
  return (
    <a className="skip-link" href="#main">
      {copy.web.site.skipToContent}
    </a>
  );
}

/** The FleetTrust logo (Figma Make design): shield mark and two-tone wordmark. */
export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link className="brand" href={href} aria-label={copy.web.site.homeLink}>
      <span className="brand__mark" aria-hidden="true">
        <Icon name="shield" size={22} />
      </span>
      <span aria-hidden="true">
        {copy.web.site.brandFirst}
        <span className="brand__accent">{copy.web.site.brandSecond}</span>
      </span>
    </Link>
  );
}

function AccountLink() {
  const { status } = useSession();
  if (status === "loading") return null;
  return status === "signed-in" ? (
    <Link className="pill-link" href="/app">
      <Icon name="user" size={18} /> {copy.web.site.yourDashboard}
    </Link>
  ) : (
    <Link className="pill-link" href="/sign-in">
      <Icon name="user" size={18} /> {copy.web.site.signIn}
    </Link>
  );
}

/** Header for public pages. Emergency help stays visible on every screen size. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Brand />
        <div className="site-header__nav">
          <NavMenu
            label={copy.web.site.mainNav}
            items={PUBLIC_NAV.filter((item) => !item.emergency && !item.footerOnly)}
          />
        </div>
        <div className="site-header__account">
          <Link className="site-header__emergency" href="/emergency">
            {copy.web.site.emergencyHelp}
          </Link>
          <AccountLink />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__grid">
        <div>
          <Brand />
          <p className="site-footer__tagline">{copy.web.site.tagline}</p>
        </div>
        <nav aria-label={copy.web.site.footerExplore}>
          <strong>{copy.web.site.footerExplore}</strong>
          {PUBLIC_NAV.filter((item) => !item.emergency).map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <nav aria-label={copy.web.site.footerSupport}>
          <strong>{copy.web.site.footerSupport}</strong>
          <Link href="/emergency">{copy.web.site.emergencyHelp}</Link>
          <Link href="/accessibility">{copy.web.site.accessibility}</Link>
        </nav>
        <nav aria-label={copy.web.site.footerLinks}>
          <strong>{copy.web.site.footerLegal}</strong>
          <Link href="/legal/privacy">{copy.web.site.privacyNotice}</Link>
          <Link href="/legal/terms">{copy.web.site.terms}</Link>
        </nav>
      </div>
      <div className="site-footer__legal">
        <p>{copy.web.site.footerAbout}</p>
        <p>{copy.web.site.footerTrust}</p>
      </div>
    </footer>
  );
}
