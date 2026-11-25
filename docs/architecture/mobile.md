# Mobile app (`apps/mobile`)

The design decision is [ADR-0032](../adr/0032-mobile-app.md). The app is built with Expo SDK 58 dev builds, Expo Router and React Native Firebase 27. It talks to the API only through `@fleettrust/sdk`.

## Layout

| Path                        | What                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `app/`                      | Screens (Expo Router files). `_layout.tsx` = providers and stack; `(tabs)/` = the five tabs        |
| `app/+native-intent.tsx`    | Every URL from the OS passes through here first (deep links, universal links, email sign-in links) |
| `src/platform/`             | Device ports (`types.ts`), native adapters (`native.ts`), runtime (`runtime.ts`)                   |
| `src/state/`                | Session (auth and push registration), network state, push listener                                 |
| `src/lib/`                  | Deep links, drafts, outbox, realtime, push, sign-in, permission wording                            |
| `src/components/`           | Design system on the shared tokens: buttons, fields, choices, notices, cards, map, location picker |
| `test/`                     | Fake device, fake API (validated by the real SDK), fixtures, screen tests                          |
| `app.config.ts`, `eas.json` | Permissions, plugins, link domains; EAS build profiles (development, staging, production)          |

## Screens

| Route                                          | Signed out                                                      | Signed in                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/` (Find)                                     | Search near a location or a typed place; list plus optional map | Same, with exact locations                                                                              |
| `/providers/[slug]`                            | Profile, verification in words, services, branches              | Plus phone and street addresses                                                                         |
| `/requests`, `/requests/new`, `/requests/[id]` | Sign-in prompt                                                  | Requests, quotes (accept, message, complete, cancel), new request with draft                            |
| `/messages`, `/messages/[id]`                  | Sign-in prompt                                                  | Conversations; live chat with outbox                                                                    |
| `/community`, `/articles/[slug]`               | Read articles and comments                                      | Plus comment (with draft)                                                                               |
| `/emergency`                                   | Official guidance (bundled), sign-in prompt                     | Guidance, active alerts, raise alert (one confirmation)                                                 |
| `/emergency/[id]`, `/emergency/contacts`       | Sign-in prompt                                                  | Alert status, close, update location; trusted contacts                                                  |
| `/notifications`                               | Sign-in prompt                                                  | Inbox; each row opens its record                                                                        |
| `/account`                                     | Sign-in prompt                                                  | Display name, notifications (permission and categories), location status, link to the website, sign out |
| `/sign-in`, `/auth/finish`                     | Email-link sign-in                                              | —                                                                                                       |

The Emergency button is in the header of every tab.

## Deep links

| Incoming                                                        | Opens                 |
| --------------------------------------------------------------- | --------------------- |
| `fleettrust://requests/<id>` (any app route)                    | That screen           |
| `https://<web>/app/requests/<id>`                               | `/requests/<id>`      |
| `https://<web>/app/messages/<id>`                               | `/messages/<id>`      |
| `https://<web>/app/emergency/<id>`                              | `/emergency/<id>`     |
| `https://<web>/providers/<slug>`, `/articles/<slug>`            | Same path             |
| `https://<web>/search?q=…&category=…`                           | `/` with the query    |
| `https://<web>/articles`                                        | `/community`          |
| `https://<web>/app/account`, `/app/appeals`                     | `/account`            |
| Firebase email link (`mode=signIn&oobCode=…`) on a trusted host | `/auth/finish?link=…` |
| Anything else, any other host, malformed IDs                    | `/` (home)            |

Only `/app`, `/providers`, `/articles`, `/search`, `/emergency`, `/auth/finish` and `/sign-in` are claimed as app links (`APP_LINK_PATHS` in `app.config.ts`). Other web URLs stay in the browser.

**Universal links need files on the web host (owner item):**

- `/.well-known/apple-app-site-association`, with the Apple Team ID and `com.fleettrust.app`;
- `/.well-known/assetlinks.json`, with the Play app signing SHA-256 fingerprint;
- both on the web origin and on the Firebase Hosting link domain.

## Notifications

| App state when a push arrives | What happens                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Quit                          | The OS shows it. Tapping starts the app on the record (`getInitialNotification`)          |
| Background                    | The OS shows it. Tapping brings the app forward on the record (`onNotificationOpenedApp`) |
| Open (foreground)             | The OS shows nothing; an in-app banner shows the title and text with "Open" and "Dismiss" |
| Signed out                    | Tapping opens the screen, which asks for sign-in and returns there afterwards             |

- **Which screen:** `pushTarget(data)` turns the IDs in the push data into a screen: request, conversation, alert or account. Records the app has no screen for (vehicles, jobs) open the notifications list.
- **Lock-screen text:** with `pushPreviews` off (the default), message pushes say "New message" (the API decides).
- **Registration:**
  - after sign-in, only if notifications are allowed;
  - unregistered at sign-out;
  - if registration fails, it's retried at the next start;
  - the inbox always records everything, whatever the push settings.
- **Permission:**
  - never asked at launch;
  - offered in Account, after sending a request, and on the trusted-contacts screen;
  - after a refusal, the button opens Settings.

## Offline and poor signal

- **Offline bar:** a bar on every screen says the phone is offline. Lists already loaded stay visible.
- **What saves and what sends:**

  | What               | Offline                                           | Back online                                      |
  | ------------------ | ------------------------------------------------- | ------------------------------------------------ |
  | Service request    | Kept as a draft; Send is disabled                 | Send by hand; a retry reuses the same request ID |
  | Chat message       | "Waiting to send (offline)" in the conversation   | Sent automatically, in order, exactly once       |
  | Comment            | Kept as a draft; Post is disabled                 | Post by hand                                     |
  | Emergency alert    | Disabled, with "call your local emergency number" | Send (one confirmation); a retry can't duplicate |
  | Emergency guidance | Always shown (bundled)                            | Country number added when the API answers        |
  | Live chat          | "Offline: new messages appear when you reconnect" | Reconnects and replays missed messages           |

- **Timeouts and errors:**
  - API requests time out after 15 seconds and count as offline (`isOffline`), with a "Try again" button.
  - A server error (5xx) leaves queued messages queued.
  - A refusal (4xx) marks a message "Not sent", with Retry and Delete.

## Permissions

| Permission                       | When asked                                                           | If refused                                                                            |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Location, while using the app    | Tapping "Use my location" (search, request, alert)                   | Type a place instead; "blocked" leads to Settings; approximate positions are labelled |
| Notifications (iOS; Android 13+) | "Turn on notifications" (Account, after a request, trusted contacts) | Everything is still in the inbox; the button opens Settings                           |
| Background location              | Never (blocked in the config)                                        | —                                                                                     |

## Configuration

**Build-time public values** (`EXPO_PUBLIC_*` values are inlined into the bundle, so they are never secrets):

| Variable                                  | Purpose                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_APP_ENV`                     | `local`, `test`, `staging`, `production`                                                             |
| `EXPO_PUBLIC_API_URL`                     | API origin (local default `http://localhost:8080`; the Android emulator uses `http://10.0.2.2:8080`) |
| `EXPO_PUBLIC_WEB_URL`                     | Web origin: email-link landing and universal links (local default `http://localhost:3000`)           |
| `EXPO_PUBLIC_LINK_DOMAIN`                 | Firebase Hosting domain used for email links                                                         |
| `EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` | `host:port` of the Auth emulator; refused outside local and test                                     |

**Firebase project files, read only by `expo prebuild`** (EAS file secrets; never committed):

- `GOOGLE_SERVICES_JSON` (Android);
- `GOOGLE_SERVICE_INFO_PLIST` (iOS).

**App Check:**

- Debug builds use the debug provider. Register the debug token in the Firebase console; never put it in the app.
- Release builds use Play Integrity and App Attest, falling back to DeviceCheck.

## Running it

```sh
pnpm --filter @fleettrust/mobile test        # Jest: logic and screens
pnpm --filter @fleettrust/mobile build       # expo export: iOS and Android JS bundles
# Device (needs the Firebase files and a dev build):
cd apps/mobile && npx expo prebuild && npx expo run:android   # or run:ios on macOS
npx eas build --profile development --platform android        # cloud dev build
```

## Tests

- **Unit:**
  - deep links: mapping, trust and ID patterns;
  - drafts: per user, expiry, corrupt data, sign-out;
  - outbox: ordering, idempotent retries, refusals, 5xx;
  - realtime: auth frame, dedupe, replay, backoff, offline, background, suspended;
  - push registration and unregistration;
  - email-link sign-in;
  - permission wording.
- **Screens (real route files on a fake device):**
  - deep links and notification taps from quit, background and foreground;
  - email-link completion;
  - location and notification permission states;
  - offline drafts, the outbox and the emergency rules;
  - accessible names and 44 dp targets on the main screens.
- **Guards:**
  - copy rules (emergency wording, no payments, no stars);
  - no native imports in screens;
  - no background location;
  - link domains only for https.
- **Real devices:** [docs/qa/mobile-device-test-plan.md](../qa/mobile-device-test-plan.md).
