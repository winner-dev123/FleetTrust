# Handoff — Prompt 24: Web product and design system

- Date: 2026-11-24
- Status: **awaiting owner approval** · branch `feat/prompt-24-web`
- Prompt 23 approved and merged (PR #25 → `fd20171`).

## Assumptions

- **The web uses the existing API only.** No API, database or migration changes. Everything goes through `@fleettrust/sdk`.
- **The design system is tokens plus web components.**
  - Tokens stay in `@fleettrust/ui` (shared with React Native).
  - Web components live in `apps/web`; the mobile app builds its own in Prompt 25.
- **WCAG 2.2 AA is the target.**
  - Automated checks run on every page (axe) at desktop size and at 320 px (the WCAG reflow width).
  - Manual screen reader testing is still needed before launch (Prompt 28).
- **"End-to-end" means a real browser.** The tests use a production build and real sign-in through the Firebase Auth emulator. The API is a mock whose every response is checked against the shared schemas. A full-stack run (real API and database) is Prompt 28.
- **Admin:** `/app/admin` is a read-only trust and safety overview. The admin console with actions is Prompt 26.

## What was built

| Area          | Details                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Design tokens | `@fleettrust/ui`: `borderStrong` and `focus` colours, `breakpoints`, `layout`, `touchTarget` (44 px), `focusRing`, `motion`. Contrast tests: text 4.5:1, controls and focus 3:1, light and dark                                                                    |
| Components    | Buttons, fields (label, hint and error linked), notices with live regions, badges in words, cards, usage meters, disclosure navigation, skip link, map                                                                                                             |
| Public site   | Home, search (list plus map, filters in the URL), provider profile, knowledge hub, jobs, emergency help (static), accessibility statement. Profiles, articles and jobs are rendered on the server; their search forms work without JavaScript                      |
| Signed in     | Dashboard, onboarding, service requests (create, quotes, accept, message, complete, cancel), emergency (raise with one confirmation, trusted contacts, alert status), vehicles, messages, notifications, community (write and publish), account and usage, appeals |
| Providers     | Setup checklist and publish, business profile, branch location and weekly hours, services and indicative prices, inquiries and quotes, members (invitation link), plan usage                                                                                       |
| Fleets        | Dashboard (spending shown as "not verified payments"), vehicles, incident log, job listings (fee wording goes to moderation), members, plan usage                                                                                                                  |
| Staff         | Read-only trust and safety overview, shown only to staff                                                                                                                                                                                                           |
| Map           | Built-in tile map on the API's map settings (no vendor until OQ-13); numbered pin buttons that select the matching result; pan and zoom buttons                                                                                                                    |
| Shared labels | `@fleettrust/types/labels.ts`: categories, vehicle types, verification and opening status in words (for web and mobile)                                                                                                                                            |
| Tests         | Unit, component (axe), copy guard, and Playwright browser tests: 6 journeys plus accessibility and reflow on every page, desktop and phone. New CI job `web-e2e`                                                                                                   |
| Docs          | [ADR-0031](../adr/0031-web-app-and-design-system.md), [architecture/web.md](../architecture/web.md)                                                                                                                                                                |

## Acceptance criteria

| Criterion                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WCAG-oriented accessibility checks | **Tokens:** contrast tests for text, controls and focus in both themes (`tokens.test.ts`). <br>**Components:** axe-core WCAG 2.0–2.2 A/AA rules on every component, plus checks of field wiring, live regions, the disclosure menu, the usage meter and map pins (`design-system.test.tsx`). <br>**Pages:** axe WCAG 2.2 A/AA with contrast on 12 public pages and 25 signed-in pages, at desktop size and on a 320 px phone, plus the public pages in the dark theme (`e2e/accessibility.spec.ts`). <br>**Keyboard:** the skip link moves focus to `main`. <br>**Checked that the tests catch regressions:** an unlinked label fails the component test; low-contrast text fails the page checks.                                                                                                                                                                        |
| Mobile-responsive views            | **Layout:** mobile-first CSS from the breakpoint tokens; navigation collapses behind a "Menu" button. <br>**Reflow:** every page is checked at 320 CSS px for sideways scrolling (WCAG 1.4.10). <br>**Journeys:** all six run on the phone project too. <br>**Checked that the test catches a regression:** a 480 px minimum width fails only the phone checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| End-to-end critical journeys       | **In a real browser against the production build** (`e2e/journeys.spec.ts`): <br>1. A visitor searches, uses the map and sees verification in words. <br>2. Sign-in sends you back to the page you asked for. <br>3. A member sets up, requests a quote and accepts it, and sees the payment disclaimer. <br>4. An emergency alert is raised with one confirmation, shows who was notified, and is cancelled; the page contains no forbidden wording. <br>5. A provider completes the checklist and publishes. <br>6. Keyboard skip link. <br>**Sign-in** is the real email-link flow through the Firebase Auth emulator. <br>**The mock API** rejected any response that didn't match the schemas: it caught one of its own mistakes during development. <br>**Checked that the test catches a regression:** sending the alert without the confirmation fails journey 4. |
| Forbidden wording (backlog)        | **Copy guard** (`copy-guards.test.ts`): emergency screens never imply that help is certain; no screen offers checkout, card payment, verified payments, stars or reviews. <br>**Checked that the test catches a regression:** adding "help is on the way" fails it. It also caught a code comment that used the word "checkout".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard (742 files), 39/39 turbo tasks. Tests: web **63** (was 18), ui **35** (was 22), types **79** (+3), api 326, sdk 30, db 96 + 6 PG-only skipped locally, local-infra 44, repo-guards 25, env 5, mobile 5 |
| Browser tests (local, Chrome)   | **18 passed**: on each of desktop and 320 px phone, 6 journeys and 3 accessibility runs (public, dark theme, signed in). Run with `PLAYWRIGHT_CHANNEL=chrome`                                                                         |
| Production build                | 42 routes                                                                                                                                                                                                                             |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                   |

## Not built here (gaps on the web)

The API supports these, but the web doesn't yet offer them:

- **Uploads:** verification documents, profile and article media.
- **Community:** group pages and group search.
- **Providers:** parts listings, the CRM pipeline and appointments.
- **Fleets:** expense entry.
- **Messaging:** realtime delivery (the web polls).

## Before production (owner)

- **A support contact for the accessibility statement** (it says one will be listed before launch).
- **Manual accessibility testing** with a screen reader before launch (Prompt 28).
- **OQ-13 (map vendor):** the map shows a grid until `MAP_TILE_URL` is set.

## Next: Prompt 25 — React Native mobile product

See [the prompt](../prompt-pack/25-react-native-mobile-product.md).
