import { Module } from "@nestjs/common";

import { EntitlementsModule } from "../entitlements/index.js";
import { ArticleImagesService } from "./article-images.service.js";
import {
  ArticleImagesController,
  ArticlesController,
  BookmarksController,
  CommentsController,
  MyArticlesController,
} from "./articles.controller.js";
import { ArticlesService } from "./articles.service.js";
import { CommentsService } from "./comments.service.js";

/**
 * Community articles and the knowledge hub (SRS J7, F-110..F-112, ADR-0022): drafts, sanitised
 * rich text, publishing with article quotas, bookmarks, comments, reports and moderation.
 * Articles are never ratings and never feed provider search or ranking.
 */
@Module({
  imports: [EntitlementsModule],
  controllers: [
    ArticlesController,
    MyArticlesController,
    BookmarksController,
    ArticleImagesController,
    CommentsController,
  ],
  providers: [ArticlesService, ArticleImagesService, CommentsService],
})
export class ArticlesModule {}
