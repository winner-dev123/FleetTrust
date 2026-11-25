# Mobile device test plan

This plan covers the checks that need a real phone (or an emulator/simulator running a dev build): OS permission prompts, links opened by the OS, notifications delivered by FCM/APNs, and real network loss.

The same behaviour is also simulated in Jest on a fake device (`apps/mobile/test/screens/*`), so regressions in the app's logic are caught in CI. This plan checks the parts Jest can't: the OS itself.

- **Status:** written, **not yet run**. Running it needs the owner's Firebase project files, a dev build, and Apple and Google developer accounts (OQ-19).
- **Record results** in the table at the end, one row per device and build.

## Devices

Run on at least:

| Platform | Version                      | Why                                                        |
| -------- | ---------------------------- | ---------------------------------------------------------- |
| Android  | 14 or 15 (Pixel or emulator) | POST_NOTIFICATIONS runtime permission, app links           |
| Android  | 12 (API 31/32)               | No notification prompt; "approximate" location option      |
| iOS      | Current (17+)                | Approximate location, notification prompt, universal links |
| iOS      | One major version back       | Older permission dialogs                                   |

**Setup:**

1. Build a development or staging build (`eas build --profile staging`).
2. Point it at a staging API, or at a local API reachable from the phone.
3. Sign in with a test account that has one trusted contact and one open service request with a quote.

## 1. Location permission

Do each row from a fresh install (or reset permissions in Settings).

| #   | Steps                                                                    | Expected                                                                                              | Jest simulation                      |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------ |
| L1  | Open the app                                                             | No location prompt at launch                                                                          | `permissions.test.tsx`               |
| L2  | Find → "Use my location" → Allow while using                             | The OS prompt shows our purpose text; the position is used; search works                              | `permissions.test.tsx`               |
| L3  | Fresh install → "Use my location" → Don't allow                          | "Location is off for FleetTrust…"; "Try again"; typing a place still searches                         | `permissions.test.tsx`               |
| L4  | Android: deny twice (or "Don't ask again"); iOS: deny once               | The button becomes "Open Settings" and opens the FleetTrust settings page; no prompt                  | `permissions.test.tsx` (blocked)     |
| L5  | iOS: allow with Precise **off**; Android 12+: choose "Approximate"       | "This position is approximate (within about N km)…"                                                   | `permissions.test.tsx`               |
| L6  | Turn off device location services, then "Use my location"                | "We couldn't get your position…" within about 15 s; no crash or endless spinner                       | `permissions.test.tsx` (GPS failure) |
| L7  | Allow location, then revoke it in Settings while the app is open; return | The next "Use my location" asks again or offers Settings; no crash                                    | —                                    |
| L8  | Check Settings → FleetTrust → Location                                   | Only "While using" / "Ask next time" offered; **no "Always"** (iOS); no background location (Android) | `guards.test.ts` (config)            |
| L9  | Emergency → raise alert with "Share my location"                         | Uses the same flow; refusing still lets you send without location                                     | `offline.test.tsx` (alert flow)      |

## 2. Notification permission and delivery

| #   | Steps                                                                    | Expected                                                                                                      | Jest simulation                        |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| N1  | Fresh install, sign in                                                   | **No** notification prompt                                                                                    | `permissions.test.tsx`                 |
| N2  | Account → "Turn on notifications" → Allow                                | The OS prompt appears once; "Notifications are on for this phone"; the API has the FID (`PUT /v1/me/devices`) | `permissions.test.tsx`, `push.test.ts` |
| N3  | Fresh install → "Turn on notifications" → Don't allow                    | The button becomes "Open Settings"; the inbox still works                                                     | `permissions.test.tsx`                 |
| N4  | Android 12: "Turn on notifications"                                      | Granted without a prompt                                                                                      | — (OS behaviour)                       |
| N5  | App **quit**: provider sends a quote (staging)                           | The OS shows the push; tapping starts the app on that request                                                 | `deep-links.test.tsx`                  |
| N6  | App in **background**: someone sends a message                           | The push shows "New message" (previews off); tapping opens the conversation                                   | `deep-links.test.tsx`                  |
| N7  | App **open** on another screen: a quote arrives                          | No system notification; an in-app banner with "Open" and "Dismiss"; "Open" goes to the request                | `deep-links.test.tsx`                  |
| N8  | Account → turn on "Show message text on the lock screen"; send a message | The lock-screen push shows the text                                                                           | — (API behaviour)                      |
| N9  | Account → turn off "New messages"; send a message                        | No push; the conversation still shows unread                                                                  | — (API behaviour)                      |
| N10 | Sign out, then send that user a message                                  | No push on this phone (FID unregistered)                                                                      | `push.test.ts`                         |
| N11 | Sign in as user B on the same phone; send A a message                    | Not delivered to this phone                                                                                   | `push.test.ts` (unregister)            |
| N12 | A trusted contact raises an alert                                        | The push arrives within seconds and opens the alert                                                           | `push.test.ts` (target)                |

## 3. Deep links

Send each link to the phone (notes app, email, or `adb shell am start -a android.intent.action.VIEW -d "<url>"` / `xcrun simctl openurl booted "<url>"`). Repeat each with the app quit and with it in the background.

| #   | Link                                                             | Expected                                                                           | Jest simulation                          |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| D1  | `fleettrust://providers/<slug>`                                  | The provider profile                                                               | `links.test.ts`, `deep-links.test.tsx`   |
| D2  | `https://<web>/app/requests/<id>` (signed in)                    | Opens **in the app** (not the browser) on the request                              | `links.test.ts`                          |
| D3  | Same link, signed out                                            | "Sign in to see this request"; after sign-in, back on the request                  | `deep-links.test.tsx`                    |
| D4  | `https://<web>/app/messages/<id>`                                | The conversation                                                                   | `links.test.ts`                          |
| D5  | `https://<web>/search?q=brakes&category=workshop`                | Find, with the search pre-filled                                                   | `links.test.ts`                          |
| D6  | `https://<web>/app/billing` (not claimed)                        | Opens in the **browser**, not the app                                              | `guards.test.ts` (claimed paths)         |
| D7  | Request a sign-in link on the phone; open the email on the phone | The app opens and signs in without asking for the email; returns to where you were | `deep-links.test.tsx`, `sign-in.test.ts` |
| D8  | Request the link on the phone; open the email on a **computer**  | The web finishes sign-in there (the phone isn't signed in)                         | — (web)                                  |
| D9  | Request the link on phone A; open it on phone B                  | Phone B asks for the email address, then signs in                                  | `sign-in.test.ts`                        |
| D10 | `fleettrust://requests/..%2Fadmin`, `fleettrust://nowhere`       | The home screen; no crash                                                          | `links.test.ts`                          |
| D11 | Android: Settings → Apps → FleetTrust → Open by default          | The web and link domains are listed as **verified**                                | — (needs assetlinks.json)                |

## 4. Degraded network

Use airplane mode, Android emulator network throttling, or the Network Link Conditioner on iOS ("Very Bad Network", "100% Loss").

| #   | Steps                                                                               | Expected                                                                                                                         | Jest simulation                      |
| --- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| W1  | Airplane mode, open the app                                                         | The offline bar on every screen; already-loaded lists stay; loads show "You're offline" with "Try again"                         | `accessibility.test.tsx` (bar)       |
| W2  | Offline: type a new request, close the app, reopen                                  | "Draft restored"; text kept; "Send request" disabled with an explanation                                                         | `offline.test.tsx`                   |
| W3  | Online: tap Send, cut the network mid-request, then retry when back                 | Exactly **one** request is created (the same `clientRequestId`)                                                                  | `offline.test.tsx`                   |
| W4  | Offline: send two chat messages                                                     | Both show "Waiting to send (offline)", in order                                                                                  | `offline.test.tsx`, `outbox.test.ts` |
| W5  | Go back online                                                                      | Both are sent once, in order; no duplicates on the other side                                                                    | `offline.test.tsx`, `outbox.test.ts` |
| W6  | Send a message in a closed request conversation (read-only)                         | "Not sent: …" with Retry and Delete; nothing retried silently                                                                    | `outbox.test.ts`                     |
| W7  | Open a conversation, background the app for 2 minutes while messages arrive, return | Live status reconnects; missed messages appear once, in order                                                                    | `realtime.test.ts`                   |
| W8  | 100% packet loss (connected but no internet), open Emergency                        | Official guidance shows; "Send alert" disabled or the send fails with "The alert was not sent… call your local emergency number" | `offline.test.tsx`                   |
| W9  | Very slow network: raise an alert, tap "Yes, send alert" twice quickly              | One alert                                                                                                                        | `offline.test.tsx` (same ID)         |
| W10 | Offline: sign out                                                                   | Signs out; drafts and queued messages removed from the phone                                                                     | `offline.test.tsx`, `push.test.ts`   |
| W11 | Kill the API (staging maintenance) and use the app                                  | Clear errors; the Emergency guidance still shows                                                                                 | `offline.test.tsx`                   |

## 5. Accessibility on device

| #   | Steps                                                                        | Expected                                                               |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A1  | VoiceOver (iOS) / TalkBack (Android) through Find → result → Request a quote | Every control is announced with a name and role; headers are announced |
| A2  | Largest system font size                                                     | Text wraps; nothing is cut off; buttons grow                           |
| A3  | Dark mode                                                                    | Readable contrast everywhere (tokens are tested at 4.5:1 and 3:1)      |
| A4  | Emergency with TalkBack/VoiceOver                                            | The confirmation and errors are announced                              |

## Results

| Date | Build | Device / OS | Sections run | Failures (IDs) | Tester |
| ---- | ----- | ----------- | ------------ | -------------- | ------ |
|      |       |             |              |                |        |
