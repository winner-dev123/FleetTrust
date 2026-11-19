import { type ColorTokens, colors } from "@fleettrust/ui";

function toCssVariables(palette: ColorTokens): string {
  return Object.entries(palette)
    .map(
      ([name, value]) =>
        `--color-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`,
    )
    .join(" ");
}

/** CSS custom properties generated from the shared design tokens, light by default with a dark override. */
export const themeCss = `:root { color-scheme: light dark; ${toCssVariables(colors.light)} }
@media (prefers-color-scheme: dark) { :root { ${toCssVariables(colors.dark)} } }
html, body { margin: 0; background: var(--color-background); color: var(--color-text); }
body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }`;
