# ADR-0022: Community articles as a validated document, with quotas, pre-moderation, reports and an append-only moderation log

- Status: Accepted
- Date: 2026-11-23

## Context

Prompt 15 builds the knowledge hub (SRS J7, F-110..F-112): drafts, rich text, publishing, categories and tags, images, bookmarks, comments, reports, search and moderation.

Constraints:

- **No reviews or ratings** (SRS §1, §8, ADR-0011). Articles are labelled "Community content — not a verified review" and must not become rating data (AB-13).
- **Spam and SEO abuse** (AB-06): sanitisation, article quotas, link limits for new accounts, a moderation queue.
- **Visitors can read articles** (A-04, OQ-11).
- **Not built yet:** the admin console (Prompt 26), appeals and account sanctions (Prompt 23), notifications (Prompt 17).

## Decision

1. **The body is a structured document, not HTML.**
   - It is a strict subset of the ProseMirror / TipTap JSON format: paragraphs, headings (h2, h3), lists, quotes, code blocks, rules and images; marks bold, italic, code and link.
   - A strict schema refuses anything else, including unknown nodes, attributes, `style` and event handlers.
   - **Links:** absolute `http`, `https` and `mailto` only. `javascript:`, `data:`, protocol-relative, credential-bearing and obfuscated targets (control or bidi characters) are refused.
   - **Text:** NFC-normalised. Control and bidi-override characters are refused.
   - **Rendering:** the server renders HTML with its own renderer (`renderArticleHtml` in `@fleettrust/types`), which escapes every text and attribute value. There is no HTML parser to get wrong.
   - **Clients:** web and mobile editors produce this JSON natively (TipTap). Web can use the rendered `html`; mobile can render the document natively.
2. **Lifecycle.**

   | Status               | Meaning                                                                             |
   | -------------------- | ----------------------------------------------------------------------------------- |
   | `draft`              | Private to the author. Free (no quota)                                              |
   | `pending_moderation` | Submitted by a pre-moderated author, or auto-flagged by reports. Not public         |
   | `published`          | Public                                                                              |
   | `rejected`           | A moderator sent it back with a reason. Editing returns it to draft                 |
   | `hidden`             | A moderator removed it with a reason. The author can't edit it (appeals: Prompt 23) |

   Deleting is a soft delete: content stays as moderation evidence until the retention job (Prompt 27).

3. **Quota.**
   - The first publication of an article uses one `articles.daily` unit, in the same transaction and idempotent by article.
   - **Subject:** the author's quota, or the organization's for organization articles. Publishing for an organization needs the new `articles.publish` permission (owner, admin, manager).
   - Unpublishing and publishing again doesn't use another unit. Drafts never do.
4. **Spam controls (AB-06).**
   - **New accounts** (under 7 days) may add at most 2 links per article and none in comments; established accounts 20 and 3. Plain-text URLs count.
   - **Pre-moderation:** new accounts, and authors with content rejected or hidden in the last 90 days, go to `pending_moderation` instead of `published`. Their later edits to a published article also send it back, so approved content can't be swapped for spam.
   - Links render with `rel="nofollow ugc noopener noreferrer"`.
   - Rate limits apply to drafts, edits, comments, images and reports.
5. **No rating data (AB-13).**
   - There are no score, star, vote, like or view columns or fields. Strict schemas refuse such input.
   - Bookmarks are private and never counted publicly.
   - Text that scores a business or person (star glyphs, "5 stars", "4/5 stars", "rated 2/10") is refused with `rating_content`. This is a heuristic; reports and moderation cover the rest.
   - Articles never feed provider search or ranking (ADR-0019).
6. **Comments** are plain text with one level of replies. They follow the same rating and link rules. Authors can edit or remove their own; a removed comment keeps its place only if it has replies.
7. **Reports and moderation.**
   - **Reports:** any signed-in user can report a public article or comment, once per target while open, and never their own.
   - **Generic table:** `content_reports` has a generic target, so later surfaces (groups, messages, jobs) can join the same queue (SRS J9).
   - **Auto-flag:** 3 distinct open reports take the content out of public view (article → `pending_moderation`, comment → `hidden`) until a moderator decides.
   - **Who moderates:** a new platform role, `trust_safety_moderator` (SRS §2.3), granted with `pnpm db:staff`. Its routes answer 404 to everyone else. Moderators can't decide on their own content.
   - **Decisions:** approve, reject, hide, restore, dismiss reports. Reject and hide need a reason, which the author sees. Hide and reject mark open reports `actioned`; the others mark them `dismissed`.
   - **Audit:** every decision, including automatic flags, goes to the append-only `moderation_actions` table (a trigger refuses updates and deletes) and to `audit_events`. It is also enqueued in the outbox (`ArticleModerated`, `ArticleCommentModerated`) for author notifications (Prompt 17).
8. **Images** use the profile-image pipeline (quarantine, type check, malware scan, metadata stripping), then the public media bucket under a random key.
   - An image can only be used by its uploader, in one article.
   - **Trade-off:** images in drafts are reachable by anyone who has the URL, since keys are unguessable but public. Keeping draft images private until publication can be added if a review asks for it.
9. **Search** uses PostgreSQL full-text search: a weighted `tsvector` (title A, summary and tags B, body C) maintained by a trigger, with the `simple` configuration (no stemming, so any language works).
   - Results are ranked by `ts_rank_cd` when there is a query, newest first otherwise.
   - Cursors are offsets bound to the query (fingerprinted) and capped at 1,000.

## Consequences

- **Clients must use a JSON editor.** Pasted HTML has to be converted by the editor, which TipTap does.
- **The rating heuristic can refuse a harmless phrase** such as "a 5-star hotel". The error names the matched text, so the author can rephrase.
- **Offset cursors can repeat or skip items** if articles are published while someone pages. That is acceptable for a reading list; keyset cursors can follow if needed.
- **Appeals, warnings and suspensions are Prompt 23.** The moderation log already holds what they need.

## Alternatives considered

- **Sanitising HTML** (DOMPurify or sanitize-html): a parser-based allowlist has a long history of bypasses and needs a DOM on the server. A typed document removes the class of bug.
- **Markdown:** easier to type, but embedded HTML and link edge cases still need a sanitiser, and the mobile editor experience is worse.
- **Likes or helpful votes:** they would become popularity scores, which is close to rating data. Left out.
- **Post-moderation for everyone:** cheaper, but new-account spam would be public until reported.
