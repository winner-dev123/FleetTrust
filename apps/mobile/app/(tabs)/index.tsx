import { copy, fill, plural } from "@fleettrust/copy";
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
  { value: "all", label: copy.find.anyService },
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
      <Heading>{copy.find.title}</Heading>
      <LocationPicker
        value={location}
        onChange={setLocation}
        label={copy.find.whereLabel}
        hint={copy.find.whereHint}
      />
      <TextField
        label={copy.find.needLabel}
        optional
        value={q}
        onChangeText={setQ}
        maxLength={100}
        placeholder={copy.find.needPlaceholder}
      />
      <Choice
        label={copy.find.serviceLabel}
        options={CATEGORY_OPTIONS}
        value={category}
        onChange={setCategory}
      />
      <Toggle label={copy.find.openNow} value={openNow} onChange={setOpenNow} />
      <Button
        label={copy.common.search}
        busy={busy && !results}
        disabled={!location}
        hint={location ? undefined : copy.find.chooseLocationFirst}
        onPress={() => void search()}
      />
      {!location ? (
        <Body small muted>
          {copy.find.chooseLocationToSearch}
        </Body>
      ) : null}
      {error ? <ErrorNotice error={error} onRetry={() => void search()} /> : null}
      {busy && !results ? <Loading label={copy.find.searching} /> : null}
      {results ? (
        <View style={{ gap: 12 }} accessibilityLabel={copy.find.resultsLabel}>
          <View style={styles.row}>
            <Heading level={2}>
              {results.items.length === 0
                ? copy.find.noResults
                : plural(results.items.length, copy.find.resultCount)}
            </Heading>
            {results.items.length > 0 ? (
              <Button
                label={showMap ? copy.find.hideMap : copy.find.showMap}
                variant="ghost"
                onPress={() => {
                  setShowMap((value) => !value);
                }}
              />
            ) : null}
          </View>
          <Body small muted>
            {copy.find.rankingNote}
          </Body>
          {status !== "signed-in" && results.items.length > 0 ? (
            <Body small muted>
              {copy.find.approximateNote}
            </Body>
          ) : null}
          {results.items.length === 0 ? (
            <EmptyState title={copy.find.emptyTitle}>{copy.find.emptyBody}</EmptyState>
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
              title={fill(
                selected === result.branchId
                  ? copy.find.resultTitleSelected
                  : copy.find.resultTitle,
                { number: index + 1, name: result.tradingName },
              )}
              subtitle={[
                result.branchName,
                result.locality,
                fill(
                  result.location.approximate ? copy.find.distanceApproximate : copy.find.distance,
                  { distance: formatDistance(result.distanceKm * 1000) },
                ),
              ]
                .filter(Boolean)
                .join(" · ")}
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
                    {result.coversSearchLocation ? ` · ${copy.find.travelsToYou}` : ""}
                  </Body>
                  {result.priceHighlights.map((price) => (
                    <Body key={price.name} small>
                      {fill(copy.find.priceLine, { name: price.name, price: price.label })}
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
              label={copy.find.showMore}
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
