/** Display helpers. Locale-aware where the browser knows the locale; deterministic on the server. */

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/** "12.5 km" or "800 m". */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return "";
  return meters < 1000 ? `${String(Math.round(meters))} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** Indicative price, e.g. "ZAR 450" or "ZAR 450–900". Amounts arrive as decimal strings. */
export function formatPriceRange(
  currency: string | null | undefined,
  min: string | null | undefined,
  max: string | null | undefined,
): string {
  if (!currency || (!min && !max)) return "Price on request";
  const clean = (value: string) => value.replace(/\.00$/, "");
  if (min && max && min !== max) return `${currency} ${clean(min)}–${clean(max)}`;
  return `${currency} ${clean(min ?? max ?? "")}`;
}

/** "3 of 10 used", "5 used (no limit)". */
export function usageLabel(used: number, limit: number | null): string {
  return limit === null
    ? `${String(used)} used (no limit)`
    : `${String(used)} of ${String(limit)} used`;
}

export function titleCase(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
