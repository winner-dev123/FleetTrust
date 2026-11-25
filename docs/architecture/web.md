# Web app

Next.js 16 (App Router) in `apps/web`, hosted on Firebase App Hosting. Design: [ADR-0031](../adr/0031-web-app-and-design-system.md).

## Pages

**Public** (`src/app/(site)`; header, footer, skip link):

| Path                                              | Rendering                  | Notes                                                                           |
| ------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `/`                                               | static                     | Search form (plain GET), categories, "I need help now"                          |
| `/search`                                         | client                     | Numbered results list; optional map; filters kept in the URL                    |
| `/providers/[slug]`                               | server, per request        | Verification labels in words, indicative prices and disclaimer, hours, branches |
| `/articles`, `/articles/[slug]`                   | server, per request        | "Community content — not a verified review"; comment form for signed-in people  |
| `/jobs`, `/jobs/[id]`                             | server, per request        | Scam warning, employer verification, apply form                                 |
| `/emergency`                                      | static (works without API) | Call the local emergency number first; how alerts work                          |
| `/accessibility`                                  | static                     | Accessibility statement                                                         |
| `/sign-in`, `/auth/finish`, `/invitations/accept` | client                     | Email link, Google, Apple (Prompt 06)                                           |

**Signed in** (`src/app/app`; shell with navigation from memberships):

| Path                                                                  | For                                                                                           |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/app`                                                                | Dashboard: active alert, open requests, unread, organizations                                 |
| `/app/onboarding`                                                     | Display name, then personal / provider / fleet path                                           |
| `/app/requests`, `/new`, `/[id]`                                      | Service requests: create (matched or one provider), quotes, accept, message, complete, cancel |
| `/app/emergency`, `/[id]`                                             | Guidance, raise an alert (one confirmation), trusted contacts, alert status, close or cancel  |
| `/app/vehicles`, `/[id]`                                              | Personal vehicles, maintenance, service history                                               |
| `/app/messages`, `/[id]`                                              | Conversations (polling every 10 s)                                                            |
| `/app/notifications`                                                  | Inbox with links to what each notification is about                                           |
| `/app/community`, `/write`                                            | Your articles, groups, friends, friend requests; write and publish                            |
| `/app/account`                                                        | Profile, plan and usage, Power User rules, sign out (everywhere)                              |
| `/app/appeals`                                                        | Sanctions and appeals; works while suspended                                                  |
| `/app/o/[orgId]`                                                      | Provider: setup checklist, verification, publish. Fleet: dashboard                            |
| `/app/o/[orgId]/profile`, `/branches`, `/services`, `/inquiries[/id]` | Provider profile, location and hours, services and prices, quotes                             |
| `/app/o/[orgId]/vehicles`, `/incidents`, `/jobs`                      | Fleet vehicles, incident log, job listings                                                    |
| `/app/o/[orgId]/members`, `/usage`                                    | Members and invitation links; organization plan usage                                         |
| `/app/admin`                                                          | FleetTrust staff: read-only trust and safety overview (actions: Prompt 26)                    |

## Design system

- **Tokens** (`@fleettrust/ui`): colours (light and dark), spacing, radii, type, `breakpoints` (480 / 768 / 1024 / 1280), `layout` (720 readable, 1120 content), `touchTarget` (44), `focusRing`, `motion`.
- **CSS:** `theme.ts` emits the tokens as custom properties; `globals.css` uses only those variables. Mobile-first; nothing scrolls sideways at 320 px.
- **Components** (`src/components`):

| Component                                          | Accessibility built in                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Button`, `ButtonLink`                             | 44 px; `busy` disables and sets `aria-busy`; `danger` only for emergencies             |
| `TextField`, `TextArea`, `SelectField`, `Checkbox` | Label, hint and error linked; `aria-invalid`; "(optional)" in words                    |
| `Notice`, `ErrorNotice`, `Loading`, `EmptyState`   | `alert` for blocking errors, `status` for confirmations and loading                    |
| `Badge`                                            | Meaning in words, never colour alone                                                   |
| `PageHeader`, `Card`, `Stat`, `UsageMeter`         | Sets the document title; `<meter>` plus the same value in text                         |
| `NavMenu`, `SiteHeader`, `AppShell`, `SkipLink`    | Disclosure menu (`aria-expanded`), `aria-current="page"`, skip to `main`               |
| `ProviderMap`                                      | Repeats the list; numbered pin buttons with names; pan and zoom buttons                |
| `UsagePanel`                                       | "Activated by FleetTrust staff", never "paid"; says emergency alerts are never limited |

## Map

- `GET /v1/geo/map-config` gives `{ tileUrl, attribution }`.
- `@fleettrust/ui` (`map.ts`, shared with the mobile app since Prompt 25) does the Web Mercator maths and lays out the tiles.
- Only https templates are drawn (http on localhost). Without a template, a grid is shown with a note.
- The searcher's location stays in the browser: it's in the URL of their own search and the API never stores it (ADR-0019).

## Tests

| Kind       | Where                                   | What                                                                                                                   |
| ---------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Unit       | `src/lib/*.test.ts`                     | Return-path guard, navigation by permission, map maths, search URL state, prices, error messages, article text         |
| Component  | `src/components/design-system.test.tsx` | axe WCAG A/AA rules on every component; field wiring; live regions; disclosure menu; usage meter; map pins             |
| Copy guard | `src/copy-guards.test.ts`               | Emergency wording never implies help is certain; no checkout, card payment, verified payment, stars or reviews         |
| Browser    | `e2e/*.spec.ts` (Playwright)            | Journeys plus axe WCAG 2.2 A/AA (contrast included, dark theme too) and reflow on every page, desktop and 320 px phone |

Browser test journeys:

1. A visitor searches, uses the map and opens a provider profile.
2. Sign-in sends you back to the page that asked for it.
3. A new member sets up, requests a quote and accepts it.
4. An emergency alert is raised with one confirmation, shows who was notified, and is cancelled.
5. A provider completes the checklist and publishes.
6. Keyboard users can skip to the content.

**Running the browser tests:**

```sh
pnpm --filter @fleettrust/web e2e                          # downloads nothing if Chromium is installed
PLAYWRIGHT_CHANNEL=chrome pnpm --filter @fleettrust/web e2e # use the installed Chrome
```

They start three things themselves:

- the mock API on port 8787;
- the Firebase Auth emulator on port 9099 (needs `firebase-tools`, Java in CI);
- a production build on port 3100.

The mock checks every response against the shared schemas, and the run fails on any mismatch.
