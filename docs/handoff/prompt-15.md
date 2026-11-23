# Handoff — Prompt 15: Article publishing and knowledge hub

- Date: 2026-11-23
- Status: **awaiting owner approval** · branch `feat/prompt-15-articles`
- Prompt 14 approved and merged (PR #16 → `3df0759`).

## Assumptions

- **Body format:** structured JSON (the TipTap / ProseMirror format), not HTML. The server validates it against an allowlist and renders escaped HTML itself, so no HTML sanitiser library is needed. The web and mobile editors (Prompts 24 and 25) use TipTap, which produces this format.
- **Authors:** individuals publish with their own quota. Organization owners, admins and managers can publish for their organization (new `articles.publish` permission), using its quota.
- **Pre-moderation:** new accounts (under 7 days) and authors with content rejected or hidden in the last 90 days are moderated before publication. Everyone else publishes immediately and is moderated through reports.
- **Moderators:** a new platform role, `trust_safety_moderator`, granted with `pnpm db:staff`. The admin console UI is Prompt 26; appeals, warnings and suspensions are Prompt 23.
- **No ratings:** there are no likes, votes or view counts, since these would become popularity scores. Bookmarks are private.
- **Not built yet:** the UI (Prompts 24 and 25) and notifications (events already go to the outbox, Prompt 17).

## What was built

| Area         | Details                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data         | `articles` (search vector by trigger, soft delete), `article_images`, `article_bookmarks`, `article_comments`, `content_reports`, `moderation_actions` (append-only trigger). Migrations `0021`, `0022` |
| Rich text    | Strict document schema; safe links only (`http`, `https`, `mailto`); control and bidi characters refused; server renderer escapes everything; links `nofollow ugc`                                      |
| Publishing   | Draft → published or pending moderation; unpublish; soft delete; rejected articles return to draft on edit; edits by pre-moderated authors go back to moderation                                        |
| Quota        | `articles.daily` consumed on first publication only, in the same transaction, idempotent per article; user or organization subject                                                                      |
| Spam (AB-06) | Link limits for new accounts (2 per article, 0 per comment), pre-moderation, rate limits on drafts, edits, comments, images and reports                                                                 |
| No ratings   | Rating-like text refused (`rating_content`); no score, star, vote or counter fields; strict schemas; not used by search ranking                                                                         |
| Images       | Upload pipeline (quarantine, type check, malware scan, metadata strip) → public media under a random key; only the uploader, one article each                                                           |
| Comments     | Plain text, one level of replies, edit and remove own, can be turned off per article                                                                                                                    |
| Bookmarks    | Private; only published articles                                                                                                                                                                        |
| Search       | Full text (title, summary, tags, body), category, tag, organization; relevance or newest; query-bound cursors                                                                                           |
| Moderation   | Reports (one open per user and target, not your own); 3 reporters auto-flag; queue; approve, reject, hide, restore, dismiss; reasons shown to authors; moderators can't decide on their own content     |
| Audit        | `moderation_actions` (append-only) + `audit_events` + outbox for every decision and automatic flag                                                                                                      |
| SDK and docs | 22 methods; [ADR-0022](../adr/0022-community-articles-and-moderation.md); [architecture/articles.md](../architecture/articles.md)                                                                       |

## Acceptance criteria

| Criterion                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XSS tests pass            | `articles.e2e-spec.ts`: HTML strings, unknown nodes and attributes, and event handlers are refused. Ten dangerous link forms are refused (`javascript:` in any case, with a tab or a leading space, `data:`, `vbscript:`, protocol-relative, relative, credentials, bidi). `<script>`, `<img onerror>`, quotes and `&` in text, code blocks and alt text come back escaped. Bidi and control characters in titles are refused. `articles.test.ts`: the same at unit level. **Checked that the tests catch a regression:** with escaping turned off, the XSS and image tests fail                          |
| Upload tests pass         | GPS metadata removed (served bytes equal the clean image); EICAR rejected (`malware_detected`); SVG/text bytes rejected (`content_type_mismatch`); SVG content type refused; unfinished, infected and other users' images can't be used (`image_not_ready`); an image can't move to another article                                                                                                                                                                                                                                                                                                       |
| Article quota works       | Drafts free; 2 publications then 403 `quota_exceeded` (limit 2); unpublish and publish again uses no unit; **5 concurrent publishes against a limit of 2 → exactly 2**; organization articles use the organization's quota; outsiders can't publish for an organization (404)                                                                                                                                                                                                                                                                                                                             |
| Moderation flow auditable | New account → pending (not public, not in search); queue for moderators only (others 404); approve → public, `moderation_actions` row with the moderator, `audit_events` `moderation.article_approved` (actor `admin`); **the database refuses updates and deletes of `moderation_actions`**; reject needs a reason, author sees it, edit → draft, resubmit uses no extra quota; 3 reports auto-flag (recorded with no moderator), hide → reports `actioned`, author can't edit, restore; comment auto-hide, restore → reports `dismissed`, dismiss-reports; moderators can't decide on their own content |
| Not rating data           | Titles, summaries, bodies and comments with "5 stars", "★★★★☆", "2/10 stars", "rated 3 out of 5", "Score: 4/5" refused; `rating`, `stars`, `score`, `providerId` fields refused; public responses contain no rating, score, star, vote, like, bookmark or view fields                                                                                                                                                                                                                                                                                                                                     |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **256** (+25 article e2e), types **56** (+8), sdk **22** (+1), db 86 + 5 PG-only skipped locally (run in CI), web 18, local-infra 44, repo-guards 22, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                        |

## Migration notes

- **`0021`** adds six tables and widens the `platform_staff` role check (`trust_safety_moderator`). **drizzle-kit quoted `tsvector`**, so it was unquoted by hand, like the geography type (documented in [database.md](../development/database.md)).
- **`0022`** adds `updated_at` triggers, the search-vector trigger and the append-only trigger on `moderation_actions`.
- Both are additive, with no backfill.

## Before production (owner)

- **Grant moderators:** `pnpm db:staff grant <email> trust_safety_moderator`. The person must have signed in once.
- **Optional:** review article limits in the plan catalog (personal-free 2 per day, provider-free 2, provider-pro 20, fleet-free 2, fleet-pro 20; sample values from OQ-09).
- **Optional:** review the pre-moderation window (7 days) and auto-flag threshold (3 reports) in `packages/types/src/articles.ts`.

## Next: Prompt 16 — Friendships and communities

Friend requests with the daily quota on successful outgoing requests, blocking and privacy, and groups by region, route or specialty.
