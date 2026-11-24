# ADR-0031: Web app on the shared SDK with a small token-based design system, a built-in tile map and browser tests against a contract-checked mock API

- Status: Accepted
- Date: 2026-11-24

## Context

Prompt 24 builds the Next.js web product (SRS F-092): a public site and signed-in areas for people, providers, fleets and FleetTrust staff. It includes the design system, search with a map, onboarding, community, emergency screens and plan usage dashboards.

The acceptance criteria are:

- WCAG-oriented accessibility checks;
- views that work on mobile;
- end-to-end tests of the critical journeys.

Constraints already in place:

- Firebase Auth on the web only (OVERLAY row 24).
- One API, used through `@fleettrust/sdk`, which validates every response.
- The map vendor isn't chosen yet (OQ-13); the API hands out an XYZ tile template.
- Tokens in `@fleettrust/ui` are shared with React Native.

## Decision

1. **Design system: tokens in `@fleettrust/ui`, web components in `apps/web`.**
   - `@fleettrust/ui` stays platform-neutral: colours, spacing, type, radii, breakpoints, layout widths, touch-target size, focus ring and motion.
   - New colour tokens: `borderStrong` (input borders) and `focus`. Tests check 4.5:1 for text and 3:1 for controls and focus, in light and dark.
   - The web turns tokens into CSS custom properties (`theme.ts`); one stylesheet (`globals.css`) uses only those variables.
   - Components live in `apps/web/src/components`: buttons, fields, notices, badges, cards, usage meters, navigation, map. The mobile app builds its own on the same tokens (Prompt 25).
   - No CSS-in-JS library and no component library.
2. **Accessibility rules built into the components.**
   - Fields: label, hint and error are linked with `aria-describedby` and `aria-invalid`. Optional fields say "(optional)" in words.
   - Notices: errors use `role="alert"`, confirmations use `role="status"`.
   - Status badges always carry words ("verified", "not verified"), never colour alone.
   - Every page has a skip link, a focusable `main` and a visible focus ring. Pages set their own document title.
   - Controls are at least 44 px. Zoom isn't blocked. Animation stops under reduced motion.
3. **Rendering.**
   - Public content is rendered on the server on each request, so it works without JavaScript and can be indexed:
     - provider profiles;
     - articles;
     - jobs;
     - the article and job lists, whose filters are plain GET forms.
   - The emergency information page is static, so it loads even when the API is down.
   - Signed-in pages are client components using the person's Firebase ID token.
   - Contact details and street addresses load only in the browser for signed-in people (OQ-11).
4. **Sessions and navigation.**
   - `FirebaseSessionProvider` tracks sign-in. `AccountProvider` loads the profile and memberships in `/app`.
   - Navigation is built from memberships and permissions (`appNavigation`), so nobody is offered a page that would answer 403 or 404. The API remains the only boundary.
   - Staff are detected by asking for the trust dashboard; everyone else gets 404.
   - Visitors sent to sign in come back to the page they asked for. Only same-site paths are accepted (`safeReturnPath`), which prevents an open redirect.
5. **Map: a small built-in tile map, the list stays primary.**
   - About 150 lines of Web Mercator maths (`lib/map.ts`) place XYZ tiles from `GET /v1/geo/map-config` and numbered pins.
   - Only https tile templates are used (http on localhost).
   - Pins are buttons that select the matching numbered result. Pan and zoom work with buttons as well as dragging.
   - Without a tile source (development), a plain grid is drawn.
   - No map SDK is added until OQ-13 picks a vendor.
6. **Tests.**
   - **Unit tests (Vitest):** helpers.
   - **Component tests (jsdom + Testing Library + axe-core):** WCAG A/AA rules on every component.
   - **Copy guard:** fails if emergency screens imply that help is certain, or if any screen offers checkout, card payment, verified payments, star ratings or reviews.
   - **Browser tests (Playwright):** run against the production build. A desktop and a 320 px phone project cover:
     - the critical journeys;
     - axe WCAG 2.2 A/AA checks (contrast included, plus a dark-theme pass) on every page;
     - a reflow check that nothing scrolls sideways.
   - **Sign-in is real:** email link through the Firebase Auth emulator.
   - **The API is a mock (`e2e/mock-api.ts`):** every response is validated against the `@fleettrust/types` schema. A mismatch fails the run, so the mock can't drift from the contract.
   - A new CI job runs the browser tests.
7. **Realtime on the web.** Conversations and active emergency alerts refresh by polling (10 and 15 seconds). The WebSocket channel (ADR-0024) can replace polling later without changing the screens.

## Consequences

- **The browser tests cover the web, not the API.** The API has its own tests (326, most of them over HTTP). A full-stack browser run (real API and database) belongs to Prompt 28.
- **Every page is tested.** A new page that isn't added to the browser test lists isn't checked by axe; the lists in `e2e/accessibility.spec.ts` must grow with the app.
- **No new runtime dependency.** Only dev tools were added: Playwright, axe-core, Testing Library and jsdom.
- **Shared display labels moved to `@fleettrust/types` (`labels.ts`)** so mobile shows the same wording: categories, vehicle types, verification and opening status.
- **The web can't do everything the API offers yet.** Not built here:
  - verification document upload;
  - media upload for profiles and articles;
  - group pages;
  - parts listings;
  - the CRM pipeline and appointments for providers;
  - fleet expenses.

  The admin console with actions is Prompt 26; `/app/admin` is a read-only overview.

## Alternatives considered

- **A component library (MUI, Chakra) or Tailwind.** Rejected: more weight than the screens need, and their theming would duplicate the shared tokens that React Native also uses.
- **MapLibre or Leaflet now.** Rejected until OQ-13: either would bring a vendor-shaped API and CSS, while the built-in map only needs tiles and pins, and the list stays the accessible view.
- **Full-stack browser tests in this prompt.** Rejected for now: they need Postgres with PostGIS, Redis and the API running, which CI's web job doesn't have. The contract-checked mock and the API's HTTP tests cover the two sides; Prompt 28 joins them.
