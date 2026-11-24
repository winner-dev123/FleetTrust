import "./globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { SkipLink } from "@/components/site-chrome";
import { FirebaseSessionProvider } from "@/lib/session";

import { themeCss } from "./theme";

export const metadata: Metadata = {
  title: { default: "FleetTrust", template: "%s · FleetTrust" },
  description: "Find trusted vehicle services, request quotes and get help on the road.",
};

/** Zoom stays enabled (WCAG 1.4.4): no maximum-scale or user-scalable=no. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <style>{themeCss}</style>
      </head>
      <body>
        <SkipLink />
        <FirebaseSessionProvider>{children}</FirebaseSessionProvider>
      </body>
    </html>
  );
}
