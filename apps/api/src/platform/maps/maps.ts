import type { GeocodeResult, MapConfig } from "@fleettrust/types";
import { type DynamicModule, Module } from "@nestjs/common";

import type { ApiEnv } from "../../config/env.js";

/**
 * Map vendor port (OQ-13: tiles, geocoding; routing arrives with Prompt 13). Search itself never
 * calls the vendor: it runs on PostGIS. Clients geocode a place name, then search near it.
 */
export interface MapProvider {
  readonly name: string;
  geocode(query: string, options: { limit: number; country?: string }): Promise<GeocodeResult[]>;
  clientConfig(): MapConfig;
}

export const MAP_PROVIDER = Symbol("MAP_PROVIDER");

/** A few well-known places, enough for development and tests. Not for production. */
const GAZETTEER: readonly GeocodeResult[] = [
  {
    label: "Cape Town, South Africa",
    location: { lng: 18.4241, lat: -33.9249 },
    countryCode: "ZA",
  },
  {
    label: "Johannesburg, South Africa",
    location: { lng: 28.0473, lat: -26.2041 },
    countryCode: "ZA",
  },
  { label: "Durban, South Africa", location: { lng: 31.0218, lat: -29.8587 }, countryCode: "ZA" },
  { label: "Nairobi, Kenya", location: { lng: 36.8219, lat: -1.2921 }, countryCode: "KE" },
  { label: "Lagos, Nigeria", location: { lng: 3.3792, lat: 6.5244 }, countryCode: "NG" },
  { label: "London, United Kingdom", location: { lng: -0.1276, lat: 51.5072 }, countryCode: "GB" },
  {
    label: "Manchester, United Kingdom",
    location: { lng: -2.2426, lat: 53.4808 },
    countryCode: "GB",
  },
  { label: "Berlin, Germany", location: { lng: 13.405, lat: 52.52 }, countryCode: "DE" },
  { label: "Rotterdam, Netherlands", location: { lng: 4.4777, lat: 51.9244 }, countryCode: "NL" },
  { label: "New York, United States", location: { lng: -74.006, lat: 40.7128 }, countryCode: "US" },
  { label: "Chicago, United States", location: { lng: -87.6298, lat: 41.8781 }, countryCode: "US" },
  { label: "São Paulo, Brazil", location: { lng: -46.6333, lat: -23.5505 }, countryCode: "BR" },
  { label: "Sydney, Australia", location: { lng: 151.2093, lat: -33.8688 }, countryCode: "AU" },
  { label: "Auckland, New Zealand", location: { lng: 174.7633, lat: -36.8485 }, countryCode: "NZ" },
];

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export class StubMapProvider implements MapProvider {
  readonly name = "stub";

  constructor(
    private readonly tiles: { tileUrl: string | null; attribution: string | null } = {
      tileUrl: null,
      attribution: null,
    },
  ) {}

  geocode(query: string, options: { limit: number; country?: string }): Promise<GeocodeResult[]> {
    const q = fold(query.trim());
    const matches = GAZETTEER.filter(
      (place) =>
        (!options.country || place.countryCode === options.country) &&
        fold(place.label).includes(q),
    );
    return Promise.resolve(matches.slice(0, options.limit));
  }

  clientConfig(): MapConfig {
    return { provider: this.name, ...this.tiles };
  }
}

@Module({})
export class MapsModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: MapsModule,
      global: true,
      providers: [
        {
          provide: MAP_PROVIDER,
          useValue: new StubMapProvider({
            tileUrl: env.MAP_TILE_URL ?? null,
            attribution: env.MAP_ATTRIBUTION ?? null,
          }),
        },
      ],
      exports: [MAP_PROVIDER],
    };
  }
}
