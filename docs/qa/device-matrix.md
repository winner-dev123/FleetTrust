# Accessibility and device matrix

What runs where, on every pull request, and what still needs a person with real devices. Targets come from [SRS §7](../product/SRS.md#7-non-functional-requirements): WCAG 2.2 AA on the web, and the platform accessibility APIs (VoiceOver and TalkBack) on mobile.

## Web: browsers and viewports (automated, CI job "Web end-to-end")

Every journey and accessibility test runs in each of these Playwright projects ([playwright.config.ts](../../apps/web/playwright.config.ts)). The test build is a production build, sign-in goes through the Firebase Auth emulator, and every API response is checked against the shared contract.

| Project   | Engine                    | Viewport         | Stands in for                        | Runs                    |
| --------- | ------------------------- | ---------------- | ------------------------------------ | ----------------------- |
| `desktop` | Chromium                  | 1280 × 900       | Chrome, Edge, Brave, Opera (desktop) | Always                  |
| `mobile`  | Chromium (Pixel 7 device) | **320** × 780    | Android Chrome; WCAG 1.4.10 reflow   | Always                  |
| `firefox` | Gecko                     | 1280 × 900       | Firefox (desktop)                    | CI (`E2E_ALL_BROWSERS`) |
| `webkit`  | WebKit                    | 1280 × 900       | Safari on macOS                      | CI (`E2E_ALL_BROWSERS`) |
| `iphone`  | WebKit (iPhone 13 device) | 390 × 664, touch | Safari on iOS (all iOS browsers)     | CI (`E2E_ALL_BROWSERS`) |

Locally, `PLAYWRIGHT_CHANNEL=chrome` uses the installed Chrome and runs the two Chromium projects only. To run the whole matrix locally: `pnpm --filter @fleettrust/web exec playwright install chromium firefox webkit`, then `E2E_ALL_BROWSERS=1 pnpm --filter @fleettrust/web e2e`.

**Supported browsers** (proposed; add to the public accessibility page when agreed): the current and previous major versions of Chrome, Edge, Firefox and Safari; Safari on iOS 17 and later; Chrome on Android 12 and later. Older browsers may work but are not tested.

## Web: accessibility checks (automated)

[accessibility.spec.ts](../../apps/web/e2e/accessibility.spec.ts), in every project above:

| Check                                                          | Pages                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| axe-core, WCAG 2.0/2.1/2.2 A and AA rules, contrast included   | All public pages, all signed-in pages, provider and fleet org pages, admin console, legal pages |
| AA contrast in the dark theme                                  | Public pages                                                                                    |
| No horizontal scrolling at 320 CSS px (reflow)                 | Every page above, `mobile` project                                                              |
| Skip link reachable by keyboard and moves focus to the content | [journeys.spec.ts](../../apps/web/e2e/journeys.spec.ts)                                         |

## Web: manual checks (before launch, then each major release)

Automated rules catch about a third of WCAG issues. These need a person:

| #   | Check                                                                              | Tool                       | Result    |
| --- | ---------------------------------------------------------------------------------- | -------------------------- | --------- |
| W1  | Search → provider → request → quote, with a screen reader only                     | NVDA + Firefox (Windows)   | _pending_ |
| W2  | The same journey                                                                   | VoiceOver + Safari (macOS) | _pending_ |
| W3  | Emergency page and "raise alert", with a screen reader only                        | VoiceOver + Safari (iOS)   | _pending_ |
| W4  | 200 % browser zoom and 400 % zoom on the main journeys                             | Any desktop browser        | _pending_ |
| W5  | Windows High Contrast / forced colours                                             | Edge                       | _pending_ |
| W6  | Full keyboard-only pass: focus order, visible focus, dialogs trap and return focus | Chrome + Firefox           | _pending_ |
| W8  | Reduced motion respected                                                           | OS setting + Chrome        | _pending_ |
| W7  | Error messages read out after a failed form submit (live region)                   | NVDA + Chrome              | _pending_ |

## Mobile app (Expo, iOS and Android)

Automated on every pull request ([apps/mobile/test](../../apps/mobile/test)):

- Each screen renders with named buttons, labelled fields and touch targets of at least 44 dp ([accessibility.test.tsx](../../apps/mobile/test/screens/accessibility.test.tsx)).
- Offline state and errors are announced.
- Permission flows (location, notifications), links and offline drafts are simulated on a fake device.

Real devices: follow the [mobile device test plan](mobile-device-test-plan.md). It lists the device matrix (Android 14/15 and 12, iOS current and one version back) and the OS-level checks that Jest can't do. Add these accessibility rows when running it:

| #   | Check                                                                     | Platform | Result    |
| --- | ------------------------------------------------------------------------- | -------- | --------- |
| M1  | Find → request → messages, with VoiceOver only                            | iOS      | _pending_ |
| M2  | The same, with TalkBack only                                              | Android  | _pending_ |
| M3  | Largest system font size (Dynamic Type / font scale 2.0): no clipped text | Both     | _pending_ |
| M4  | Emergency button reachable and announced first on the emergency screen    | Both     | _pending_ |

**Status:** the real-device runs need a development build, the owner's Firebase project files, and Apple and Google developer accounts (OQ-19). They are an owner action before launch.
