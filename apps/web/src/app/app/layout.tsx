"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { AccountProvider } from "@/lib/account";

/** Signed-in area for people, providers, fleets and FleetTrust staff. */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return (
    <AccountProvider>
      <AppShell>{children}</AppShell>
    </AccountProvider>
  );
}
