import type { ReactNode } from "react";

import { SiteFooter, SiteHeader } from "@/components/site-chrome";

/** Public pages: header, main landmark (skip-link target) and footer. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
