import type { User } from "@fleettrust/db";
import {
  type ArticleCommentDto,
  type ArticlePage,
  type ArticleSummary,
  type CommentList,
  createArticleImageSchema,
  createArticleSchema,
  createCommentSchema,
  type MyArticle,
  type PublicArticle,
  searchArticlesQuerySchema,
  updateArticleSchema,
  updateCommentSchema,
} from "@fleettrust/types";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  type PipeTransform,
  Post,
  Put,
  Query,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser, Public, RequireDisplayName } from "../identity/index.js";
import { ArticleImagesService } from "./article-images.service.js";
import { ArticlesService } from "./articles.service.js";
import { CommentsService } from "./comments.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

@Injectable()
class SlugParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (value.length > 80 || !SLUG.test(value)) {
      throw new NotFoundException({ statusCode: 404, error: "not_found" });
    }
    return value;
  }
}

/** Public knowledge hub (SRS A-04: visitors can read). Labelled as community content. */
@Controller("v1/articles")
export class ArticlesController {
  constructor(
    private readonly articles: ArticlesService,
    private readonly comments: CommentsService,
  ) {}

  @Get()
  @Public()
  @RateLimit({ name: "articles-read", limit: 120, windowSeconds: 60, by: "ip" })
  search(@Query() query: unknown): Promise<ArticlePage> {
    return this.articles.search(parseBody(searchArticlesQuerySchema, query));
  }

  @Get(":slug")
  @Public()
  @RateLimit({ name: "articles-read", limit: 120, windowSeconds: 60, by: "ip" })
  get(@Param("slug", SlugParam) slug: string): Promise<PublicArticle> {
    return this.articles.getPublic(slug);
  }

  @Get(":slug/comments")
  @Public()
  @RateLimit({ name: "articles-read", limit: 120, windowSeconds: 60, by: "ip" })
  listComments(@Param("slug", SlugParam) slug: string): Promise<CommentList> {
    return this.comments.list(slug);
  }

  @Post(":articleId/comments")
  @RequireDisplayName()
  @RateLimit({ name: "article-comment", limit: 20, windowSeconds: 3600, by: "user" })
  comment(
    @CurrentUser() user: User,
    @Param("articleId", IdParam) articleId: string,
    @Body() body: unknown,
  ): Promise<ArticleCommentDto> {
    return this.comments.create(user, articleId, parseBody(createCommentSchema, body));
  }
}

/** The author's articles: drafts, publishing and unpublishing. */
@Controller("v1/me/articles")
export class MyArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Post()
  @RateLimit({ name: "article-draft", limit: 30, windowSeconds: 3600, by: "user" })
  create(@CurrentUser() user: User, @Body() body: unknown): Promise<MyArticle> {
    return this.articles.create(user, parseBody(createArticleSchema, body));
  }

  @Get()
  list(@CurrentUser() user: User): Promise<MyArticle[]> {
    return this.articles.listMine(user);
  }

  @Get(":articleId")
  get(@CurrentUser() user: User, @Param("articleId", IdParam) id: string): Promise<MyArticle> {
    return this.articles.getMine(user, id);
  }

  @Patch(":articleId")
  @RateLimit({ name: "article-edit", limit: 120, windowSeconds: 3600, by: "user" })
  update(
    @CurrentUser() user: User,
    @Param("articleId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<MyArticle> {
    return this.articles.update(user, id, parseBody(updateArticleSchema, body));
  }

  @Post(":articleId/publish")
  @HttpCode(200)
  @RequireDisplayName()
  publish(@CurrentUser() user: User, @Param("articleId", IdParam) id: string): Promise<MyArticle> {
    return this.articles.publish(user, id);
  }

  @Post(":articleId/unpublish")
  @HttpCode(200)
  unpublish(
    @CurrentUser() user: User,
    @Param("articleId", IdParam) id: string,
  ): Promise<MyArticle> {
    return this.articles.unpublish(user, id);
  }

  @Delete(":articleId")
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param("articleId", IdParam) id: string): Promise<void> {
    await this.articles.remove(user, id);
  }
}

/** Private bookmarks. */
@Controller("v1/me/bookmarks/articles")
export class BookmarksController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  list(@CurrentUser() user: User): Promise<ArticleSummary[]> {
    return this.articles.bookmarks(user);
  }

  @Put(":articleId")
  @HttpCode(204)
  async add(@CurrentUser() user: User, @Param("articleId", IdParam) id: string): Promise<void> {
    await this.articles.bookmark(user, id);
  }

  @Delete(":articleId")
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param("articleId", IdParam) id: string): Promise<void> {
    await this.articles.unbookmark(user, id);
  }
}

@Controller("v1/article-images")
export class ArticleImagesController {
  constructor(private readonly images: ArticleImagesService) {}

  @Post()
  @RateLimit({ name: "article-image", limit: 30, windowSeconds: 3600, by: "user" })
  create(@CurrentUser() user: User, @Body() body: unknown) {
    return this.images.create(user, parseBody(createArticleImageSchema, body));
  }

  @Post(":imageId/complete")
  @HttpCode(200)
  complete(@CurrentUser() user: User, @Param("imageId", IdParam) id: string) {
    return this.images.complete(user, id);
  }
}

@Controller("v1/article-comments")
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Patch(":commentId")
  @RateLimit({ name: "article-comment-edit", limit: 60, windowSeconds: 3600, by: "user" })
  update(
    @CurrentUser() user: User,
    @Param("commentId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<ArticleCommentDto> {
    return this.comments.update(user, id, parseBody(updateCommentSchema, body).body);
  }

  @Delete(":commentId")
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param("commentId", IdParam) id: string): Promise<void> {
    await this.comments.remove(user, id);
  }
}
