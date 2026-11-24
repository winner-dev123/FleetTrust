"use client";

import Link from "next/link";

import { PUBLIC_NAV } from "@/lib/nav";
import { useSession } from "@/lib/session";

import { NavMenu } from "./nav-menu";

export function SkipLink() {
  return (
    <a className="skip-link" href="#main">
      Skip to main content
    </a>
  );
}

function AccountLink() {
  const { status } = useSession();
  if (status === "loading") return null;
  return status === "signed-in" ? (
    <Link className="btn btn--secondary" href="/app">
      Your dashboard
    </Link>
  ) : (
    <Link className="btn btn--primary" href="/sign-in">
      Sign in
    </Link>
  );
}

/** Header for public pages. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href="/">
          FleetTrust
        </Link>
        <div className="site-header__nav">
          <NavMenu label="Main" items={PUBLIC_NAV} />
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
        <p>
          FleetTrust helps you find vehicle services and get help on the road. Prices shown are
          indicative: you agree the final price and pay the provider directly. FleetTrust does not
          process payments.
        </p>
        <p>
          Verification labels show the evidence FleetTrust checked. They are not endorsements, and
          plans can&apos;t buy them. Community posts are opinions, not verified reviews.
        </p>
        <ul className="cluster list-plain" aria-label="Site information">
          <li>
            <Link href="/accessibility">Accessibility</Link>
          </li>
          <li>
            <Link href="/emergency">Emergency help</Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}
