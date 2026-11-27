import "./globals.css";

import type { Metadata, Viewport } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import type { ReactNode } from "react";

import { SkipLink } from "@/components/site-chrome";
import { FirebaseSessionProvider } from "@/lib/session";

import { themeCss } from "./theme";
import { copy } from "@fleettrust/copy";

/**
 * Typefaces from the Figma Make design: DM Sans for text, Manrope for headings and the logo.
 * Self-hosted by Next.js, so pages make no request to Google at runtime.
 */
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: copy.web.site.brand, template: copy.web.site.titleTemplate },
  description: copy.web.site.description,
};

/** Zoom stays enabled (WCAG 1.4.4): no maximum-scale or user-scalable=no. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${manrope.variable}`}>
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
