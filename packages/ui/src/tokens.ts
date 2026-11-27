/**
 * Design tokens shared by the Next.js web app and the React Native app.
 * Values are plain data so they work on both platforms. The full design
 * system builds on these: the web components live in apps/web (ADR-0031) and the mobile
 * components in apps/mobile.
 */

export interface ColorTokens {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  /** Decorative dividers and card outlines (not required to meet 3:1). */
  border: string;
  /** Boundaries users must see to operate a control, e.g. text inputs: 3:1 or more (WCAG 1.4.11). */
  borderStrong: string;
  /** Keyboard focus indicator: 3:1 or more against background and surface (WCAG 2.4.11 / 2.4.13). */
  focus: string;
  primary: string;
  onPrimary: string;
  /** Emergency actions only. Never used for marketing or upsell UI. */
  danger: string;
  onDanger: string;
  /** Shown next to evidence-based verification badges. */
  verified: string;
  /** Shown for unverified or stale information, e.g. "Unverified", "Stock as of ...". */
  caution: string;
  /** Recessed areas inside a surface: inputs' tracks, table headers, tag backgrounds. */
  surfaceSunken: string;
  /** Brand navy: the logo, hero bands and the "next step" card. */
  brand: string;
  /** Secondary accent (teal): open-now dots and positive changes. Never the only signal. */
  accent: string;
}

export type ColorScheme = "light" | "dark";

export const colors: Readonly<Record<ColorScheme, ColorTokens>> = {
  light: {
    background: "#f7f8fa",
    surface: "#ffffff",
    surfaceSunken: "#eef1f5",
    text: "#0b1726",
    textMuted: "#4a5868",
    border: "#dde3ea",
    borderStrong: "#6b7a89",
    focus: "#0a5bd3",
    primary: "#0a5bd3",
    onPrimary: "#ffffff",
    danger: "#b42318",
    onDanger: "#ffffff",
    verified: "#16703f",
    caution: "#8a5300",
    brand: "#0b2a4a",
    accent: "#0e7c66",
  },
  dark: {
    background: "#0a1019",
    surface: "#111a26",
    surfaceSunken: "#0d1520",
    text: "#eaf0f6",
    textMuted: "#a9b6c4",
    border: "#243243",
    borderStrong: "#8796a5",
    focus: "#9cc3ff",
    primary: "#6ea8ff",
    onPrimary: "#06213f",
    danger: "#ff9c92",
    onDanger: "#5a0a04",
    verified: "#7fd69b",
    caution: "#f5c26b",
    brand: "#9cc3ff",
    accent: "#5fd4b6",
  },
};

/** 4-point spacing scale, in density-independent pixels. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Corners: inputs 6, buttons 10, cards 14, sheets and hero panels 20. */
export const radii = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

export const typography = {
  /** sm caption/small, md body, lg H2 (24), xl H1 (32), xxl display (40). */
  fontSize: { sm: 14, md: 16, lg: 24, xl: 32, xxl: 40 },
  lineHeight: { sm: 20, md: 24, lg: 32, xl: 40, xxl: 44 },
  fontWeight: { regular: "400", medium: "500", bold: "600" },
} as const;

/** Responsive breakpoints (min-width, CSS pixels). Layouts are mobile-first. */
export const breakpoints = { sm: 480, md: 768, lg: 1024, xl: 1280 } as const;

/** Content widths, in CSS pixels. */
export const layout = { readable: 720, content: 1120 } as const;

/**
 * Minimum size of anything you tap or click (WCAG 2.5.8 asks for 24; 44 follows platform
 * guidelines and suits gloved hands at the roadside).
 */
export const touchTarget = 44;

/** Keyboard focus ring. */
export const focusRing = { width: 3, offset: 2 } as const;

/**
 * Elevation (navy-tinted shadows, as CSS box-shadow values; the native app uses its own).
 * e1 resting cards, e2 raised cards and menus, e3 sheets and dialogs.
 */
export const shadows = {
  e1: "0 1px 2px rgba(11, 23, 38, 0.06)",
  e2: "0 4px 12px rgba(11, 23, 38, 0.08)",
  e3: "0 12px 32px rgba(11, 23, 38, 0.12)",
} as const;

/** Durations in milliseconds. Animations are skipped when the user prefers reduced motion. */
export const motion = { fast: 120, normal: 200 } as const;
