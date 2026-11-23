import { Module } from "@nestjs/common";

import { ProvidersModule } from "../providers/index.js";
import { RouteSearchService } from "./route-search.service.js";
import { GeoController, RouteSearchController, SearchController } from "./search.controller.js";
import { SearchService } from "./search.service.js";

/**
 * Provider search (SRS F-040..F-042, ADR-0019). Must not import entitlements: ranking is
 * independent of plans (ADR-0009, eslint.boundaries.js).
 */
@Module({
  imports: [ProvidersModule],
  controllers: [SearchController, RouteSearchController, GeoController],
  providers: [SearchService, RouteSearchService],
})
export class SearchModule {}
