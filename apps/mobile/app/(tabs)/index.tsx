import {
  CATEGORY_LABELS,
  formatDistance,
  type MapConfig,
  openingStatusLabel,
  PROVIDER_CATEGORIES,
  type ProviderSearchResult,
  verificationLabel,
} from "@fleettrust/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { ErrorNotice } from "../../src/components/feedback";
import { LocationPicker, type PickedLocation } from "../../src/components/location-picker";
import { type MapPin, ProviderMap } from "../../src/components/provider-map";
import {
  Badge,
  Body,
  Button,
  Choice,
  EmptyState,
  Heading,
  ListRow,
  Loading,
  Notice,
  Screen,
  styles,
  TextField,
  Toggle,
} from "../../src/components/ui";
import { useSession } from "../../src/state/session";

type Category = (typeof PROVIDER_CATEGORIES)[number] | "all";

const CATEGORY_OPTIONS: readonly { value: Category; label: string }[] = [
  { value: "all", label: "Any service" },
  ...PROVIDER_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
];

const isCategory = (value: unknown): value is Category =>
  typeof value === "string" && CATEGORY_OPTIONS.some((option) => option.value === value);

interface Results {
  items: ProviderSearchResult[];
  nextCursor: string | null;
  disclaimer: string;
  center: PickedLocation;
}

/** Nearby provider search: a numbered list (the primary view) with an optional map. */
export default function FindScreen() {
  const params = useLocalSearchParams<{ q?: string; category?: string }>();
  const router = useRouter();
  const { api, status } = useSession();
  const [q, setQ] = useState(typeof params.q === "string" ? params.q : "");
  const [category, setCategory] = useState<Category>(
    isCategory(params.category) ? params.category : "all",
  );
  const [openNow, setOpenNow] = useState(false);
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [mapConfig, setMapConfig] = useState<MapConfig | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!showMap || mapConfig) return;
    let active = true;
    api.mapConfig().then(
      (config) => {
        if (active) setMapConfig(config);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api, mapConfig, showMap]);

  async function search(cursor?: string) {
    if (!location) return;
    setBusy(true);
    setError(null);
    try {
      const page = await api.searchProviders(
        {
          lat: location.lat,
          lng: location.lng,
          ...(category === "all" ? {} : { category }),
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(openNow ? { openNow: "true" } : {}),
          ...(cursor ? { cursor } : {}),
        },
        { signedIn: status === "signed-in" },
      );
      setResults((previous) => ({
        items: cursor && previous ? [...previous.items, ...page.results] : page.results,
        nextCursor: page.nextCursor,
        disclaimer: page.priceDisclaimer,
        center: location,
      }));
    } catch (failure) {
      // Earlier results stay on screen; the notice explains why nothing new arrived.
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const pins: MapPin[] =
    results?.items.map((result, index) => ({
      id: result.branchId,
      number: index + 1,
      label: result.tradingName,
      location: result.location,
    })) ?? [];

  return (
    <Screen>
      <Heading>Find help nearby</Heading>
      <LocationPicker
        value={location}
        onChange={setLocation}
        label="Where are you?"
        hint="Search near you or near a place you type."
      />
      <TextField
        label="What do you need?"
        optional
        value={q}
        onChangeText={setQ}
        maxLength={100}
        placeholder="For example: brakes, tyre repair"
      />
      <Choice label="Service" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
      <Toggle label="Open now" value={openNow} onChange={setOpenNow} />
      <Button
        label="Search"
        busy={busy && !results}
        disabled={!location}
        hint={location ? undefined : "Choose a location first"}
        onPress={() => void search()}
      />
      {!location ? (
        <Body small muted>
          Choose a location to search.
        </Body>
      ) : null}
      {error ? <ErrorNotice error={error} onRetry={() => void search()} /> : null}
      {busy && !results ? <Loading label="Searching…" /> : null}
      {results ? (
        <View style={{ gap: 12 }} accessibilityLabel="Search results">
          <View style={styles.row}>
            <Heading level={2}>
              {results.items.length === 0
                ? "No results"
                : `${String(results.items.length)} results`}
            </Heading>
            {results.items.length > 0 ? (
              <Button
                label={showMap ? "Hide map" : "Show map"}
                variant="ghost"
                onPress={() => {
                  setShowMap((value) => !value);
                }}
              />
            ) : null}
          </View>
          <Body small muted>
            Ranked by relevance and distance. Plans and payments never change the order.
          </Body>
          {status !== "signed-in" && results.items.length > 0 ? (
            <Body small muted>
              Locations are approximate until you sign in.
            </Body>
          ) : null}
          {results.items.length === 0 ? (
            <EmptyState title="Nothing found here">
              Try another service, turn off &quot;Open now&quot;, or search near another place.
            </EmptyState>
          ) : null}
          {showMap && results.items.length > 0 ? (
            <ProviderMap
              pins={pins}
              center={results.center}
              selectedId={selected}
              onSelect={setSelected}
              config={mapConfig}
            />
          ) : null}
          {results.items.map((result, index) => (
            <ListRow
              key={result.branchId}
              title={`${String(index + 1)}. ${result.tradingName}${selected === result.branchId ? " (selected on map)" : ""}`}
              subtitle={`${result.branchName}${result.locality ? ` · ${result.locality}` : ""} · ${result.location.approximate ? "about " : ""}${formatDistance(result.distanceKm * 1000)} away`}
              onPress={() => {
                router.push(`/providers/${result.slug}`);
              }}
              detail={
                <View style={{ gap: 6 }}>
                  <Body small>{openingStatusLabel(result.hours)}</Body>
                  <View style={styles.row}>
                    {result.verification.map((badge) => (
                      <Badge
                        key={badge.badgeType}
                        tone={badge.status === "verified" ? "verified" : "caution"}
                        label={verificationLabel(badge.badgeType, badge.status)}
                      />
                    ))}
                  </View>
                  <Body small muted>
                    {result.categories.map((c) => CATEGORY_LABELS[c]).join(", ")}
                    {result.coversSearchLocation ? " · Travels to your location" : ""}
                  </Body>
                  {result.priceHighlights.map((price) => (
                    <Body key={price.name} small>
                      {price.name}: {price.label}
                    </Body>
                  ))}
                </View>
              }
            />
          ))}
          {results.items.length > 0 ? (
            <Notice>
              <Body small>{results.disclaimer}</Body>
            </Notice>
          ) : null}
          {results.nextCursor ? (
            <Button
              label="Show more results"
              variant="secondary"
              busy={busy}
              onPress={() => void search(results.nextCursor ?? undefined)}
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
