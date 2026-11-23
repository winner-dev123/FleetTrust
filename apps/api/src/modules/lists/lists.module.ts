import { Module } from "@nestjs/common";

import { FavoritesController, JoinListController, ListsController } from "./lists.controller.js";
import { ListsService } from "./lists.service.js";

/** Favorites and named provider lists with sharing (SRS F-101, ADR-0020). */
@Module({
  controllers: [FavoritesController, ListsController, JoinListController],
  providers: [ListsService],
})
export class ListsModule {}
