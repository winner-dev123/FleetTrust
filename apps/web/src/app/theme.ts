import {
  type ColorTokens,
  colors,
  focusRing,
  layout,
  radii,
  shadows,
  spacing,
  touchTarget,
  typography,
} from "@fleettrust/ui";

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function toCssVariables(palette: ColorTokens): string {
  return Object.entries(palette)
    .map(([name, value]) => `--color-${kebab(name)}: ${value};`)
    .join(" ");
}

function scale(prefix: string, values: Readonly<Record<string, number>>): string {
  return Object.entries(values)
    .map(([name, value]) => `--${prefix}-${name}: ${String(value)}px;`)
    .join(" ");
}

/** Non-colour tokens as CSS custom properties (globals.css uses only these variables). */
const sizes = [
  scale("space", spacing),
  scale("radius", radii),
  scale("font", typography.fontSize),
  scale("layout", layout),
  Object.entries(shadows)
    .map(([name, value]) => `--shadow-${name}: ${value};`)
    .join(" "),
  Object.entries(typography.lineHeight)
    .map(([name, value]) => `--leading-${name}: ${String(value)}px;`)
    .join(" "),
  `--touch: ${String(touchTarget)}px;`,
  `--focus-width: ${String(focusRing.width)}px; --focus-offset: ${String(focusRing.offset)}px;`,
].join(" ");

/** CSS custom properties generated from the shared design tokens, light by default with a dark override. */
export const themeCss = `:root { color-scheme: light dark; ${sizes} ${toCssVariables(colors.light)} }
@media (prefers-color-scheme: dark) { :root { ${toCssVariables(colors.dark)} } }
html, body { margin: 0; background: var(--color-background); color: var(--color-text); }
body { font-family: var(--font-inter), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; font-feature-settings: "cv11", "ss01"; -webkit-font-smoothing: antialiased; }`;
