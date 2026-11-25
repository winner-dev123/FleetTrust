"use client";

import {
  CATEGORY_LABELS,
  type GeocodeResult,
  type MapConfig,
  openingStatusLabel,
  PROVIDER_CATEGORIES,
  type ProviderSearchResult,
  verificationLabel,
} from "@fleettrust/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type SubmitEvent, useEffect, useState } from "react";

import { Button } from "@/components/button";
import { Checkbox, SelectField, TextField } from "@/components/field";
import { Badge, EmptyState, ErrorNotice, Loading, Notice } from "@/components/feedback";
import { ProviderMap } from "@/components/provider-map";
import { errorMessage } from "@fleettrust/sdk";
import { formatDistance } from "@fleettrust/types";
import {
  parseSearchState,
  RADIUS_OPTIONS,
  type SearchState,
  searchStateToParams,
  toApiQuery,
} from "@/lib/search-query";
import { useSession } from "@/lib/session";

type Results =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | {
      status: "ready";
      items: ProviderSearchResult[];
      nextCursor: string | null;
      disclaimer: string;
      loadingMore: boolean;
    };

function ResultCard({
  result,
  number,
  selected,
}: {
  result: ProviderSearchResult;
  number: number;
  selected: boolean;
}) {
  return (
    <article
      className="card"
      id={`result-${result.branchId}`}
      style={selected ? { borderColor: "var(--color-focus)", borderWidth: 3 } : undefined}
    >
      <h3 className="card__title">
        <span className="muted">{number}. </span>
        <Link href={`/providers/${result.slug}`}>{result.tradingName}</Link>
      </h3>
      <p className="muted small">
        {result.branchName}
        {result.locality ? ` · ${result.locality}` : ""} ·{" "}
        {result.location.approximate ? "about " : ""}
        {formatDistance(result.distanceKm * 1000)} away
      </p>
      <p>{openingStatusLabel(result.hours)}</p>
      <ul className="cluster list-plain" aria-label="Verification">
        {result.verification.map((badge) => (
          <li key={badge.badgeType} style={{ marginTop: 0 }}>
            <Badge tone={badge.status === "verified" ? "verified" : "caution"}>
              {verificationLabel(badge.badgeType, badge.status)}
            </Badge>
          </li>
        ))}
      </ul>
      <p className="small">
        {result.categories.map((category) => CATEGORY_LABELS[category]).join(", ")}
        {result.coversSearchLocation ? " · Travels to your location" : ""}
      </p>
      {result.priceHighlights.length > 0 ? (
        <ul className="small">
          {result.priceHighlights.map((price) => (
            <li key={price.name}>
              {price.name}: {price.label}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/** Provider search: a numbered results list (primary) with an optional map of the same results. */
export function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { api, status: sessionStatus } = useSession();
  const state = parseSearchState(new URLSearchParams(params.toString()));

  const [draft, setDraft] = useState<SearchState>(state);
  const [places, setPlaces] = useState<GeocodeResult[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<Results>(() =>
    toApiQuery(state) ? { status: "loading" } : { status: "idle" },
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [mapConfig, setMapConfig] = useState<MapConfig | null>(null);
  const [locating, setLocating] = useState(false);

  const queryKey = params.toString();
  const signedIn = sessionStatus === "signed-in";

  useEffect(() => {
    const query = toApiQuery(parseSearchState(new URLSearchParams(queryKey)));
    if (!query || sessionStatus === "loading") return;
    let active = true;
    api.searchProviders(query, { signedIn: sessionStatus === "signed-in" }).then(
      (page) => {
        if (active) {
          setResults({
            status: "ready",
            items: page.results,
            nextCursor: page.nextCursor,
            disclaimer: page.priceDisclaimer,
            loadingMore: false,
          });
        }
      },
      (error: unknown) => {
        if (active) setResults({ status: "error", error });
      },
    );
    return () => {
      active = false;
    };
  }, [api, queryKey, sessionStatus]);

  // A place name without coordinates (from the home page form): geocode it once.
  useEffect(() => {
    const current = parseSearchState(new URLSearchParams(queryKey));
    const where = current.where.trim();
    if (current.lat !== null || where.length < 2) return;
    let active = true;
    api.geocode(where).then(
      (found) => {
        if (!active) return;
        const [first] = found;
        if (!first) {
          setFormError(`We couldn't find "${where}". Try a nearby town.`);
          return;
        }
        setPlaces(found.slice(1));
        const next = {
          ...current,
          where: first.label,
          lat: first.location.lat,
          lng: first.location.lng,
        };
        setDraft(next);
        router.replace(`${pathname}?${searchStateToParams(next).toString()}`, { scroll: false });
      },
      (error: unknown) => {
        if (active) setFormError(errorMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, [api, pathname, queryKey, router]);

  useEffect(() => {
    if (state.view !== "map" || mapConfig) return;
    api.mapConfig().then(setMapConfig, () => {
      setMapConfig({ provider: "none", tileUrl: null, attribution: null });
    });
  }, [api, state.view, mapConfig]);

  const navigate = (next: SearchState) => {
    setDraft(next);
    setResults(toApiQuery(next) ? { status: "loading" } : { status: "idle" });
    router.push(`${pathname}?${searchStateToParams(next).toString()}`, { scroll: false });
  };

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setPlaces([]);
    const where = draft.where.trim();
    if (where === state.where && draft.lat !== null) {
      navigate(draft);
      return;
    }
    if (where.length < 2) {
      setFormError("Enter a town or area, or use your current location.");
      return;
    }
    try {
      const found = await api.geocode(where);
      const [first] = found;
      if (!first) {
        setFormError(`We couldn't find "${where}". Try a nearby town.`);
        return;
      }
      setPlaces(found.slice(1));
      navigate({ ...draft, where: first.label, lat: first.location.lat, lng: first.location.lng });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setFormError("Your browser can't share a location. Type a town instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        navigate({
          ...draft,
          where: "Your location",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        setLocating(false);
        setFormError("Location wasn't shared. Type a town or area instead.");
      },
      { maximumAge: 300_000, timeout: 15_000 },
    );
  }

  async function loadMore() {
    if (results.status !== "ready" || !results.nextCursor) return;
    const query = toApiQuery(state, results.nextCursor);
    if (!query) return;
    setResults({ ...results, loadingMore: true });
    try {
      const page = await api.searchProviders(query, { signedIn });
      setResults({
        ...results,
        items: [...results.items, ...page.results],
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch (error) {
      setResults({ status: "error", error });
    }
  }

  const resultCount = results.status === "ready" ? results.items.length : 0;

  return (
    <div className="container stack stack--lg">
      <header>
        <h1>Find vehicle services</h1>
        <p className="muted">
          Workshops, towing, tyres, parts and more. Results are sorted by relevance (text match,
          distance, service area and opening hours). Plans never change the order.
        </p>
      </header>

      <form className="card stack" onSubmit={(event) => void submit(event)} role="search">
        <div className="grid">
          <TextField
            label="What do you need?"
            hint="For example: brakes, tyre repair, towing"
            value={draft.q}
            maxLength={100}
            onChange={(event) => {
              setDraft({ ...draft, q: event.target.value });
            }}
          />
          <TextField
            label="Where?"
            hint="Town, suburb or area"
            required
            value={draft.where}
            maxLength={100}
            autoComplete="address-level2"
            error={formError}
            onChange={(event) => {
              setDraft({ ...draft, where: event.target.value, lat: null, lng: null });
            }}
          />
        </div>
        <div className="grid">
          <SelectField
            label="Category"
            value={draft.category ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setDraft({
                ...draft,
                category: PROVIDER_CATEGORIES.find((category) => category === value) ?? null,
              });
            }}
            options={[
              { value: "", label: "Any category" },
              ...PROVIDER_CATEGORIES.map((category) => ({
                value: category,
                label: CATEGORY_LABELS[category],
              })),
            ]}
          />
          <SelectField
            label="Distance"
            required
            value={String(draft.radiusKm)}
            onChange={(event) => {
              setDraft({ ...draft, radiusKm: Number(event.target.value) });
            }}
            options={RADIUS_OPTIONS.map((km) => ({
              value: String(km),
              label: `Within ${String(km)} km`,
            }))}
          />
        </div>
        <div className="cluster">
          <Checkbox
            label="Open now"
            checked={draft.openNow}
            onChange={(event) => {
              setDraft({ ...draft, openNow: event.target.checked });
            }}
          />
          <Checkbox
            label="Business registration verified"
            checked={draft.verifiedOnly}
            onChange={(event) => {
              setDraft({ ...draft, verifiedOnly: event.target.checked });
            }}
          />
        </div>
        <div className="cluster">
          <Button type="submit">Search</Button>
          <Button variant="ghost" onClick={useMyLocation} busy={locating}>
            {locating ? "Finding you…" : "Use my location"}
          </Button>
        </div>
        <p className="small muted">
          Your location is used for this search only. FleetTrust doesn&apos;t store it.
        </p>
      </form>

      {places.length > 0 ? (
        <nav aria-label="Other places with that name" className="cluster">
          <span className="small">Did you mean:</span>
          {places.map((place) => (
            <button
              key={`${place.label}-${String(place.location.lat)}`}
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setPlaces([]);
                navigate({
                  ...state,
                  where: place.label,
                  lat: place.location.lat,
                  lng: place.location.lng,
                });
              }}
            >
              {place.label}
            </button>
          ))}
        </nav>
      ) : null}

      <section aria-labelledby="results-heading" className="stack">
        <div className="cluster cluster--between">
          <h2 id="results-heading">
            {state.lat === null ? "Results" : `Results near ${state.where || "the chosen point"}`}
          </h2>
          {state.lat !== null ? (
            <Button
              variant="secondary"
              aria-pressed={state.view === "map"}
              onClick={() => {
                navigate({ ...state, view: state.view === "map" ? "list" : "map" });
              }}
            >
              {state.view === "map" ? "Hide map" : "Show map"}
            </Button>
          ) : null}
        </div>

        <p role="status" aria-live="polite" className="small muted">
          {results.status === "ready"
            ? `${String(resultCount)} ${resultCount === 1 ? "result" : "results"}${results.nextCursor ? " so far" : ""}.`
            : ""}
        </p>

        {results.status === "idle" && state.lat === null && state.where && !formError ? (
          <Loading label="Finding that place…" />
        ) : null}
        {results.status === "idle" && (state.lat === null ? !state.where || formError : false) ? (
          <EmptyState title="Tell us where to look">
            <p>Type a town or use your location to see providers nearby.</p>
          </EmptyState>
        ) : null}
        {results.status === "loading" ? <Loading label="Searching…" /> : null}
        {results.status === "error" ? <ErrorNotice error={results.error} /> : null}
        {results.status === "ready" ? (
          <>
            <Notice>
              <p className="small">{results.disclaimer}</p>
              {!signedIn ? (
                <p className="small">
                  Locations are approximate until you <Link href="/sign-in">sign in</Link>.
                </p>
              ) : null}
            </Notice>
            {results.items.length === 0 ? (
              <EmptyState title="No providers match">
                <p>Try a larger distance, another category or fewer filters.</p>
              </EmptyState>
            ) : (
              <div className={state.view === "map" ? "search-layout" : undefined}>
                <ol className="list-plain" aria-label="Providers">
                  {results.items.map((result, index) => (
                    <li key={result.branchId}>
                      <ResultCard
                        result={result}
                        number={index + 1}
                        selected={selected === result.branchId}
                      />
                    </li>
                  ))}
                </ol>
                {state.view === "map" && state.lat !== null && state.lng !== null ? (
                  <ProviderMap
                    center={{ lat: state.lat, lng: state.lng }}
                    config={mapConfig}
                    selectedId={selected}
                    onSelect={(id) => {
                      setSelected(id);
                      document
                        .getElementById(`result-${id}`)
                        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                    }}
                    pins={results.items.map((result, index) => ({
                      id: result.branchId,
                      number: index + 1,
                      label: `${result.tradingName}, ${formatDistance(result.distanceKm * 1000)}`,
                      location: result.location,
                    }))}
                  />
                ) : null}
              </div>
            )}
            {results.nextCursor ? (
              <Button
                variant="secondary"
                busy={results.loadingMore}
                onClick={() => void loadMore()}
              >
                {results.loadingMore ? "Loading…" : "Show more results"}
              </Button>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
