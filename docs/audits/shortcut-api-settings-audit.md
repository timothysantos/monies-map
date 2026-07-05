# Shortcut API Settings Audit

Date: 2026-07-05

## Feature List

- Quick-entry URL flow: external shortcuts can open Entries with a prefilled
  draft for user review before save.
- Direct-create shortcut API: `POST /api/shortcuts/entries/create` creates a
  ledger row and returns an `openUrl` for the saved row.
- Shortcut request protection: the endpoint requires a shared token, a nonce,
  and a recent timestamp.
- In-app Shortcut API settings: Settings now owns the shortcut API key and an
  ordered active-account fallback list.
- Default account fallback: if a shortcut request omits `accountId` and
  `accountName`, the endpoint uses the first configured active account.
- Environment token fallback: `SHORTCUT_INGEST_TOKEN` still works for existing
  deployments, but an app-managed key saved in Settings takes priority.

## Existing-State Findings

- The dedicated shortcut endpoint already existed and was documented in
  `docs/faq.md`.
- Replay protection already existed through `shortcut_request_nonces`.
- The endpoint was not fully app-configurable because token verification only
  read `SHORTCUT_INGEST_TOKEN` from the Worker environment.
- The endpoint rejected account-less payloads, so Apple Pay shortcuts had to
  send a card or account every time.
- Settings did not expose a place to rotate the shortcut API key or express
  which card/account should be preferred.

## Implemented Contract

- `app_settings` persists app-owned shortcut settings as JSON.
- `GET /api/settings-page` returns `settingsPage.shortcutSettings` with the
  endpoint path, active API key source, API key value, and default account
  priority IDs.
- `POST /api/settings/shortcuts/save` validates a non-empty API key and at
  least one active account, then saves the shortcut settings.
- `POST /api/shortcuts/entries/create` authenticates against the app-managed
  key first, falls back to `SHORTCUT_INGEST_TOKEN`, keeps nonce/timestamp
  protection, and resolves a default account when the request omits account
  fields.
- The Settings page includes a dedicated Shortcut API section with key
  generation, endpoint display, save, drag-and-drop account reordering, and
  up/down controls.

## Test Coverage

- `tests/settings-workflow.test.mjs` covers shortcut draft defaults and reorder
  behavior.
- `tests/settings-refresh-plan.test.mjs` covers the settings-only refresh plan
  for shortcut settings saves.
- `tests/e2e/settings-reference-data.spec.js` covers saving the shortcut key
  and priority order, then creating an entry without account fields through
  the protected shortcut API.

## Residual Risks

- The app-managed API key is available in the settings DTO so the user can copy
  or rotate it from the app. This is acceptable only while Settings is protected
  by the app's normal access boundary.
- There is one active app-managed key, not multiple named shortcut keys. Add
  key labels and key history if more shortcuts or devices need independent
  rotation later.
- The drag-and-drop UI has button equivalents for accessibility, but mobile
  drag behavior should be checked whenever the Settings layout is redesigned.
