import type { SearchQueryParams } from "@fleettrust/sdk";
import { PROVIDER_CATEGORIES, type ProviderCategory } from "@fleettrust/types";

/**
 * Provider search state kept in the address bar, so results can be shared, bookmarked and
 * restored with the back button. The searcher's coordinates stay in the browser's URL only:
 * the API never stores or logs them (ADR-0019).
 */
export interface SearchState {
  q: string;
  /** Place name typed by the person (geocoded to lat/lng). */
  where: string;
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  category: ProviderCategory | null;
  openNow: boolean;
  verifiedOnly: boolean;
  view: "list" | "map";
}

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;

const isCategory = (value: string | null): value is ProviderCategory =>
  value !== null && (PROVIDER_CATEGORIES as readonly string[]).includes(value);

function coordinate(value: string | null, limit: number): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

export function parseSearchState(params: URLSearchParams): SearchState {
  const lat = coordinate(params.get("lat"), 90);
  const lng = coordinate(params.get("lng"), 180);
  const radius = Number(params.get("radiusKm"));
  const category = params.get("category");
  return {
    q: (params.get("q") ?? "").slice(0, 100),
    where: (params.get("where") ?? "").slice(0, 100),
    lat: lat !== null && lng !== null ? lat : null,
    lng: lat !== null && lng !== null ? lng : null,
    radiusKm: (RADIUS_OPTIONS as readonly number[]).includes(radius) ? radius : 25,
    category: isCategory(category) ? category : null,
    openNow: params.get("openNow") === "true",
    verifiedOnly: params.get("verified") === "true",
    view: params.get("view") === "map" ? "map" : "list",
  };
}

export function searchStateToParams(state: SearchState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.where) params.set("where", state.where);
  if (state.lat !== null && state.lng !== null) {
    params.set("lat", state.lat.toFixed(5));
    params.set("lng", state.lng.toFixed(5));
  }
  if (state.radiusKm !== 25) params.set("radiusKm", String(state.radiusKm));
  if (state.category) params.set("category", state.category);
  if (state.openNow) params.set("openNow", "true");
  if (state.verifiedOnly) params.set("verified", "true");
  if (state.view === "map") params.set("view", "map");
  return params;
}

/** The API query for a state, or null until a location is known. */
export function toApiQuery(state: SearchState, cursor?: string): SearchQueryParams | null {
  if (state.lat === null || state.lng === null) return null;
  const query: SearchQueryParams = {
    lat: state.lat,
    lng: state.lng,
    radiusKm: state.radiusKm,
    limit: 20,
  };
  if (state.q) query.q = state.q;
  if (state.category) query.category = state.category;
  if (state.openNow) query.openNow = "true";
  if (state.verifiedOnly) query.verified = "business";
  if (cursor) query.cursor = cursor;
  return query;
}
