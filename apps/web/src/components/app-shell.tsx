"use client";

import { copy } from "@fleettrust/copy";
import { ApiError } from "@fleettrust/sdk";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useAccountState } from "@/lib/account";
import { appNavigation } from "@/lib/nav";
import { rememberReturnPath } from "@/lib/return-path";
import { takeExitPath } from "@/lib/session-exit";
import { useSession } from "@/lib/session";

import { ErrorNotice, Loading, Notice } from "./feedback";
import { ConsentGate } from "./consent-gate";
import { SiteNotice } from "./site-notice";
import { NavMenu } from "./nav-menu";
import { Brand } from "./site-chrome";

/** Pages a suspended member can still use (the API marks them @AllowSuspended). */
const SUSPENDED_ALLOWED = "/app/appeals";

function TopBar() {
  const { signOut, status } = useSession();
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Brand href="/app" />
        <div className="cluster">
          <Link className="nav__link" href="/search">
            {copy.web.shell.findServices}
          </Link>
          {status === "signed-in" ? (
            <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
              {copy.web.shell.signOut}
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/**
 * Signed-in shell: sends visitors to sign in (remembering where they were going), loads the
 * account, and shows navigation for the person's memberships.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const account = useAccountState();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (session.status !== "signed-out") return;
    const exit = takeExitPath();
    if (exit) {
      router.replace(exit);
      return;
    }
    rememberReturnPath(window.localStorage, window.location.pathname + window.location.search);
    router.replace("/sign-in");
  }, [session.status, router]);

  let body: ReactNode;
  let nav: ReactNode = null;
  if (session.status !== "signed-in" || account.status === "loading") {
    body = <Loading label={copy.web.shell.loadingAccount} />;
  } else if (account.status === "error") {
    const suspended =
      account.error instanceof ApiError && account.error.reason === "account_suspended";
    body =
      suspended && pathname.startsWith(SUSPENDED_ALLOWED) ? (
        children
      ) : suspended ? (
        <Notice tone="danger" title={copy.web.shell.suspendedTitle} live="assertive">
          <p>{copy.web.shell.suspendedBody}</p>
          <p>
            <Link href={SUSPENDED_ALLOWED}>{copy.web.shell.suspendedLink}</Link>
          </p>
        </Notice>
      ) : (
        <ErrorNotice error={account.error} />
      );
  } else {
    body = <ConsentGate>{children}</ConsentGate>;
    nav = (
      <aside className="app-nav">
        <NavMenu
          label={copy.web.shell.yourAreas}
          sections={appNavigation(account.organizations, { isStaff: account.isStaff })}
        />
      </aside>
    );
  }

  return (
    <>
      <TopBar />
      <SiteNotice />
      <div className="app-layout">
        {nav}
        <main id="main" tabIndex={-1} className="container stack stack--lg">
          {body}
        </main>
      </div>
    </>
  );
}
