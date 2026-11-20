import {
  geocodeQuerySchema,
  type GeocodeResult,
  type MapConfig,
  type ProviderSearchPage,
  searchProvidersQuerySchema,
} from "@fleettrust/types";
import { Controller, Get, Inject, Query } from "@nestjs/common";

import { MAP_PROVIDER, type MapProvider } from "../../platform/maps/index.js";
import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { Public } from "../identity/index.js";
import { SearchService } from "./search.service.js";

/**
 * Provider search. Visitors get approximate locations and distances (OQ-11); signed-in users
 * (`/full`) get exact ones. Query strings are never logged (the request logger drops them), so
 * searchers' locations aren't kept (SRS AB-04).
 */
@Controller("v1/search/providers")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Public()
  @RateLimit({ name: "search-visitor", limit: 60, windowSeconds: 60, by: "ip" })
  visitor(@Query() query: unknown): Promise<ProviderSearchPage> {
    return this.search.search(parseBody(searchProvidersQuerySchema, query), false);
  }

  @Get("full")
  @RateLimit({ name: "search", limit: 120, windowSeconds: 60, by: "user" })
  full(@Query() query: unknown): Promise<ProviderSearchPage> {
    return this.search.search(parseBody(searchProvidersQuerySchema, query), true);
  }
}

/** Map vendor adapter (OQ-13): place-name lookup and client tile configuration. */
@Controller("v1/geo")
export class GeoController {
  constructor(@Inject(MAP_PROVIDER) private readonly maps: MapProvider) {}

  @Get("geocode")
  @Public()
  @RateLimit({ name: "geocode", limit: 30, windowSeconds: 60, by: "ip" })
  geocode(@Query() query: unknown): Promise<GeocodeResult[]> {
    const { q, limit, country } = parseBody(geocodeQuerySchema, query);
    return this.maps.geocode(q, { limit, ...(country ? { country } : {}) });
  }

  @Get("map-config")
  @Public()
  mapConfig(): MapConfig {
    return this.maps.clientConfig();
  }
}
