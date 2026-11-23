# Community articles and moderation

SRS J7, J9, F-110..F-112. Design: [ADR-0022](../adr/0022-community-articles-and-moderation.md).

> Every article, list and comment response carries the label **"Community content — not a verified review"**. There are no ratings, scores, votes or public counters.

## Flow

1. **Images (optional):** `POST /v1/article-images` returns `{ imageId, upload }`. `PUT` the bytes to `upload.url`, then `POST /v1/article-images/:imageId/complete`, which returns `{ id, url }`.
2. **Draft:** `POST /v1/me/articles`. Edit with `PATCH /v1/me/articles/:articleId`. Drafts are free.
3. **Publish:** `POST /v1/me/articles/:articleId/publish`. The first publication uses one `articles.daily` unit. New accounts and authors with recent strikes go to `pending_moderation`.
4. **Readers:** `GET /v1/articles` (search) and `GET /v1/articles/:slug`. No sign-in needed.
5. **Readers interact:** bookmark, comment, or report.
6. **Moderators decide:** they work through `GET /v1/moderation/queue`.

## Article body

The body is JSON, never HTML: a subset of the TipTap / ProseMirror format.

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 2 },
      "content": [{ "type": "text", "text": "Before you leave" }]
    },
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "Check tyres " },
        {
          "type": "text",
          "text": "cold",
          "marks": [
            { "type": "bold" },
            { "type": "link", "attrs": { "href": "https://example.org/tyres" } }
          ]
        }
      ]
    },
    { "type": "image", "attrs": { "imageId": "0196f2a8-…", "alt": "Tread depth gauge" } }
  ]
}
```

| Allowed | Values                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Blocks  | `paragraph`, `heading` (level 2 or 3), `bulletList`, `orderedList`, `listItem`, `blockquote`, `codeBlock`, `horizontalRule`, `image` |
| Inline  | `text`, `hardBreak`                                                                                                                  |
| Marks   | `bold`, `italic`, `code`, `link` (`http`, `https`, `mailto` only)                                                                    |
| Limits  | 40,000 characters of text, 3,000 nodes, nesting depth 6, 10 images plus a cover, 5 tags                                              |

Responses include the document (`body`) and server-rendered, escaped `html`. Links render with `rel="nofollow ugc noopener noreferrer" target="_blank"`. Title, summary and comments are plain text: render them as text, never as HTML.

## Creating an article

```json
{
  "title": "Pre-trip tyre checks",
  "summary": "Five minutes that prevent most blowouts.",
  "body": { "type": "doc", "content": [] },
  "category": "maintenance",
  "tags": ["tyres", "pre-trip"],
  "coverImageId": null,
  "commentsEnabled": true,
  "organizationId": null
}
```

- **Categories:** `maintenance`, `safety`, `regulations`, `routes`, `fuel_efficiency`, `business`, `technology`, `driver_wellbeing`, `other`.
- **Tags:** lowercase letters, digits and hyphens, up to 30 characters.
- **`organizationId`:** publish for an organization. This needs `articles.publish` (owner, admin, manager) and uses the organization's quota.

**Errors (400):**

- `rating_content`: the text scores a business or person (e.g. "5 stars", "★★★★☆", "rated 2/10"). The response includes `match`.
- `too_many_links`: over the link limit (`limit` in the response). New accounts (under 7 days): 2 per article and 0 per comment. Otherwise 20 and 3. Plain-text URLs count.
- `image_not_ready`: the image isn't finished, isn't yours, or is used in another article.
- `document_too_large`, `document_too_deep`, `too_many_images`.
- `article_incomplete`: publishing with less than 20 characters of text.

**Other errors:**

- 403 `quota_exceeded` (`articles.daily`).
- 409 `profile_incomplete`: publishing or commenting without a display name.
- 409 `invalid_transition`, `article_hidden`.

## Routes

**Public** (no sign-in; rate-limited by IP):

| Method & path                     | Notes                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /v1/articles`                | `q`, `category`, `tag`, `organizationId`, `limit` (1–50), `cursor` → `{ items, nextCursor, label }` |
| `GET /v1/articles/:slug`          | Published only; otherwise 404                                                                       |
| `GET /v1/articles/:slug/comments` | Visible comments, oldest first                                                                      |

**Author** (signed in):

| Method & path                               | Notes                                                |
| ------------------------------------------- | ---------------------------------------------------- |
| `POST /v1/me/articles`                      | Create a draft (30 per hour)                         |
| `GET /v1/me/articles`                       | Your articles in every status, with `moderationNote` |
| `GET /v1/me/articles/:articleId`            |                                                      |
| `PATCH /v1/me/articles/:articleId`          | Not when hidden. Rejected → draft                    |
| `POST /v1/me/articles/:articleId/publish`   | From draft. Display name required                    |
| `POST /v1/me/articles/:articleId/unpublish` | Published or pending → draft                         |
| `DELETE /v1/me/articles/:articleId`         | Soft delete                                          |

**Readers** (signed in):

| Method & path                                 | Notes                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `PUT /v1/me/bookmarks/articles/:articleId`    | Published articles only. Private                                                      |
| `DELETE /v1/me/bookmarks/articles/:articleId` |                                                                                       |
| `GET /v1/me/bookmarks/articles`               | Still-published bookmarks                                                             |
| `POST /v1/articles/:articleId/comments`       | `{ body, parentId? }` (20 per hour). One level of replies                             |
| `PATCH /v1/article-comments/:commentId`       | Your own visible comment                                                              |
| `DELETE /v1/article-comments/:commentId`      | Your own                                                                              |
| `POST /v1/reports`                            | `{ targetType: article \| article_comment, targetId, reason, details? }` (20 per day) |

**Report reasons:** `spam`, `scam`, `harassment`, `hate`, `defamation`, `misinformation`, `sexual_content`, `violence`, `other`.

**Report errors:**

- 400 `own_content`.
- 409 `already_reported`.
- 404 if the target isn't public.

**Moderation** (platform role `trust_safety_moderator`; 404 for everyone else):

| Method & path                                                 | Notes                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| `GET /v1/moderation/queue`                                    | Pending articles and anything with open reports, oldest first |
| `GET /v1/moderation/articles/:articleId`                      | Content, reports, decision history. Drafts 404                |
| `GET /v1/moderation/comments/:commentId`                      |                                                               |
| `POST /v1/moderation/articles/:articleId/approve`             | pending → published                                           |
| `POST /v1/moderation/articles/:articleId/reject`              | pending → rejected. `{ reason }` required                     |
| `POST /v1/moderation/articles/:articleId/hide`                | published or pending → hidden. `{ reason }` required          |
| `POST /v1/moderation/articles/:articleId/restore`             | hidden → published                                            |
| `POST /v1/moderation/{articles,comments}/:id/dismiss-reports` | Close open reports, no change to the content                  |
| `POST /v1/moderation/comments/:commentId/hide` and `/restore` | Hide needs `{ reason }`                                       |

Moderators can't decide on their own content (409 `own_content`). Grant the role with `pnpm db:staff grant <email> trust_safety_moderator`.

## Automatic flagging

When **3 different users** have open reports on the same content, it leaves public view until a moderator decides:

- An article moves to `pending_moderation`.
- A comment becomes `hidden`.

The automatic flag is recorded with no moderator.

## Audit trail

| Where                | What                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moderation_actions` | Every decision and automatic flag: moderator, action, reason, report count. Append-only (trigger)                                                                                 |
| `audit_events`       | `article.*`, `article_comment.*`, `content_report.created`, `moderation.<target>_<action>` (actor type `admin` or `system`)                                                       |
| Outbox               | `ArticlePublished`, `ArticleSubmitted`, `ArticleCommentCreated`, `ContentReported`, `ArticleModerated`, `ArticleCommentModerated` (IDs only), ready for notifications (Prompt 17) |

## Data

| Table                | Notes                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `articles`           | Author, optional organization, slug, status, title, summary, body (JSON), body text, category, tags, search vector, moderation note, `quota_consumed_at`, soft delete |
| `article_images`     | Upload pipeline state; `article_id` set on first use                                                                                                                  |
| `article_bookmarks`  | Private, per user                                                                                                                                                     |
| `article_comments`   | Plain text, one level of replies, `visible` / `hidden` / `deleted`                                                                                                    |
| `content_reports`    | Generic target (articles and comments now; other surfaces later). One open report per reporter and target                                                             |
| `moderation_actions` | Append-only decision log                                                                                                                                              |
