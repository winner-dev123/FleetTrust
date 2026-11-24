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
}

export type ColorScheme = "light" | "dark";

export const colors: Readonly<Record<ColorScheme, ColorTokens>> = {
  light: {
    background: "#ffffff",
    surface: "#f4f6f8",
    text: "#14202b",
    textMuted: "#4a5866",
    border: "#c9d2db",
    borderStrong: "#6b7a89",
    focus: "#0b5cad",
    primary: "#0b5cad",
    onPrimary: "#ffffff",
    danger: "#b3261e",
    onDanger: "#ffffff",
    verified: "#1b6e3a",
    caution: "#8a5300",
  },
  dark: {
    background: "#0f161d",
    surface: "#18222c",
    text: "#e8edf2",
    textMuted: "#a7b4c1",
    border: "#33424f",
    borderStrong: "#8796a5",
    focus: "#7cb8f5",
    primary: "#7cb8f5",
    onPrimary: "#08223d",
    danger: "#ffb4ab",
    onDanger: "#690005",
    verified: "#7fd69b",
    caution: "#f5c26b",
  },
};

/** 4-point spacing scale, in density-independent pixels. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radii = { sm: 4, md: 8, lg: 16, pill: 999 } as const;

export const typography = {
  fontSize: { sm: 14, md: 16, lg: 20, xl: 28 },
  lineHeight: { sm: 20, md: 24, lg: 28, xl: 36 },
  fontWeight: { regular: "400", medium: "500", bold: "700" },
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

/** Durations in milliseconds. Animations are skipped when the user prefers reduced motion. */
export const motion = { fast: 120, normal: 200 } as const;
