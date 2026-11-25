# RFC-0006: Multilingual UI and content

- **Status:** Draft (specification only, [ADR-0011](../adr/0011-future-modules-spec-only.md))
- **Date:** 2026-11-25
- **Excluded by:** SRS §9 ("Multilingual UI"; RFC only). SRS §7 asks for English at launch, UTF-8 throughout, locale-aware formatting, and strings kept outside code so translation can be added later.

## Summary

FleetTrust would be offered in more than one language: first the interface (website, app, emails, push notifications), then optionally user content (articles, messages), on demand. The pilot is in Europe (`europe-west1`), where drivers and providers often work in several languages.

## Where the code stands today (honest baseline)

| Area                    | Today                                                                                              | Gap for translation                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Text encoding           | UTF-8 everywhere; `safeText` normalises to NFC                                                     | None                                                                            |
| Dates, numbers, money   | Central helpers in `packages/types/src/format.ts` using `Intl`, with the locale fixed to `"en"`    | Pass the user's locale instead of `"en"`                                        |
| Domain labels           | Central maps in `@fleettrust/types` (categories, vehicle types, consents, opening hours)           | Turn the maps into message keys                                                 |
| Error messages          | Central reason → message map in the SDK (`packages/sdk/src/errors.ts`)                             | Message keys per reason                                                         |
| Screen text, mobile app | **In the English catalog** `@fleettrust/copy`, enforced by `apps/mobile/test/copy-catalog.test.ts` | Message keys already in place                                                   |
| Screen text, website    | **Mostly written inline in components**                                                            | Extract into the same catalog (the remaining task)                              |
| Emails and push         | Built in the API in English                                                                        | Templates per locale                                                            |
| `<html lang>`           | `"en"`                                                                                             | Set from the active locale                                                      |
| Right-to-left scripts   | Not handled                                                                                        | Logical CSS properties and mirrored layouts (only if an RTL language is chosen) |

SRS §7's "strings kept outside code" is therefore **met for the mobile app** and **partly met for the website** (labels, errors, formatting). The migration path starts by closing the website gap.

## Why it's excluded today, and preconditions

- **Translation quality matters most where safety matters.** Emergency guidance, disclaimers and legal texts need professional, legally reviewed translations, not machine output.
- **The pilot languages aren't decided** (they depend on the jurisdiction, OQ-03).
- **Preconditions to start:**
  - the launch languages chosen;
  - a translation workflow and vendor;
  - legal review of the translated terms, privacy notice and emergency wording;
  - an ADR superseding ADR-0011 for this module.

## Principles and constraints

1. **Locale is a preference, not an inference.** Use the account setting first, then the device or browser `Accept-Language`, then English. Never infer it from location.
2. **Safety texts are never machine-translated.** The emergency guidance, `EMERGENCY_DISCLAIMER`, legal texts and verification label meanings (SRS §8.1) need reviewed translations. If one is missing, show the English text, not a guess.
3. **One message catalog per language, keyed by stable IDs**, kept in the repository and reviewed like code. ICU MessageFormat for plurals and gender.
4. **No language-dependent behaviour.** Search, matching and ranking work the same in every language (the full-text search configuration may add stemming per language later).
5. **User content stays in its original language.** Optional translation on demand is a separate later step (see RFC-0004 for any machine translation, with the same privacy rules).

## Proposed design

- **Catalogs:** `packages/i18n` (future) holding `en.json`, `<lang>.json` and a typed key helper shared by the website, app, API emails and push.
- **Library:** a small, well-supported ICU library chosen in the ADR. The guard currently blocks i18n frameworks, so the choice is deliberate.
- **Formatting:** the existing `format.ts` helpers take a `locale` argument instead of the fixed `"en"`.
- **API:** the user's preference is stored on the account. The API uses it to pick email and push templates, and error responses keep machine-readable `reason` codes so clients translate them (as today).

**Data it would own** (described, not created): one new nullable column `users.locale` (an expand-only change), no new tables.

## Integration seams

### Consumes (existing events)

There are no events for the language itself. The seams are where outgoing text is produced:

| Event               | Producer (today) | Use                                                                           |
| ------------------- | ---------------- | ----------------------------------------------------------------------------- |
| `FriendRequestSent` | Social module    | The inbox and push text are rendered from a catalog in the recipient's locale |
| `MessageSent`       | Messaging module | Push notification text (not the message itself) in the recipient's locale     |
| `MaintenanceDue`    | Vehicles module  | Reminder text in the fleet member's locale                                    |

All notification texts flow through `NotificationsService` today, so it is the single place to render per-locale templates.

### Emits (proposed events; schemas in [events/](events/))

| Event               | When                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `UserLocaleChanged` | A person changed their language. Clients refresh catalogs, and cached email or push templates use the new locale |

### Ports (future)

- `Translator.t(key, params, locale)` in the shared package. Missing keys fall back to English and are logged.
- `LocaleResolver.forUser(user, acceptLanguage)`.

### Touch points in existing code

The website and app components (string extraction), `NotificationsService` (templates), email builders, `format.ts`, the root layout's `<html lang>`, and account settings (a language picker).

## Event schemas

- [`UserLocaleChanged`](events/UserLocaleChanged.schema.json)

## Migration path

1. **Extract English first.** Move inline screen text into the English catalog (`packages/copy`) with no behaviour change; this closes the SRS §7 gap. **Done for the mobile app** (a guard test fails on new inline text there). The website is next, area by area, with the same guard.
2. **Decide.** Choose the launch languages and the translation workflow. Write the ADR. The guard's i18n-framework block is narrowed to the chosen library.
3. **Expand.** Add the `users.locale` column (nullable), the language picker, locale-aware `format.ts`, and per-locale notification templates.
4. **Translate and review:** professional translation, legal review of the safety and legal texts, and a native-speaker pass on the main journeys (the same journeys as the accessibility manual checks).
5. **Launch per language**, behind the normal release process. Missing keys fall back to English.
6. **Withdraw path.** Remove the language from the picker; English remains complete.

## Risks

| Risk                                 | Mitigation                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| Mistranslated safety or legal text   | Professional translation plus legal review; English fallback, never a machine guess     |
| Partial translations confusing users | Launch a language only at 100 % of the main journeys; fallback to English per string    |
| Layout breakage (long words, RTL)    | Playwright journeys per locale; logical CSS properties                                  |
| Catalog drift                        | Typed keys; CI check that every key exists in English and that unused keys are reported |

## Open questions

- Which languages first? (This depends on the pilot jurisdiction.)
- Do articles and community content get on-demand translation, and with what privacy terms?

## Exit criteria (to leave Draft)

- Launch languages and the translation workflow decided.
- English extraction (step 1) planned with an estimate.
- The ADR and guard change drafted with the first change.
