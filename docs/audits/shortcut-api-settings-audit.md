# Shortcut API Settings Audit

Date: 2026-08-22

## Feature List

- Quick-entry URL flow: external shortcuts can open Entries with a prefilled
  draft for user review before save.
- Direct-create shortcut API: `POST /api/shortcuts/entries/create` creates a
  ledger row and returns an `openUrl` for the saved row.
- Shortcut request protection: the endpoint requires a shared token. Advanced
  clients may add a nonce and recent timestamp as a complete pair for replay
  protection.
- Verified Apple install: Settings saves and copies a private connection, then
  opens a secret-free shared shortcut with an Apple setup question.
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
- Production verification found that Cloudflare Access intercepted the original
  app-hostname shortcut URL before the Worker could authenticate it. A direct
  iOS Shortcut could not use that route without an interactive Access session.

## Implemented Contract

- `app_settings` persists app-owned shortcut settings as JSON.
- `GET /api/settings-page` returns `settingsPage.shortcutSettings` with the
  endpoint path, active API key source, API key value, and default account
  priority IDs.
- `POST /api/settings/shortcuts/save` validates a non-empty API key and at
  least one active account, then saves the shortcut settings.
- `POST /api/shortcuts/entries/create` authenticates against the app-managed
  key first, falls back to `SHORTCUT_INGEST_TOKEN`, accepts header, Bearer, or
  private connection URL token transport, and resolves a default account when
  the request omits account fields.
- Nonce/timestamp replay protection remains available when both headers are
  supplied. Supplying only one is rejected.
- The Settings page includes an Apple Pay shortcut section with a primary
  install action, masked key, collapsed advanced controls, drag-and-drop account
  reordering, and up/down controls.
- Install generates a key when needed, saves it, copies the private connection
  URL, and opens the verified `Monies Map Apple Pay Direct` iCloud artifact.
- The public artifact contains no secret. Its setup question targets the URL
  action and its POST body contains only `amount`, `description`, and `date`.
- Production now deploys `monies-map-shortcuts` as a public shortcut-only
  Worker against the same D1 database. It rejects every non-shortcut path and
  returns protected-app origins in response deep links.
- The Access-protected app Settings DTO supplies the dedicated absolute gateway
  URL. Installing saves the app-managed key to shared D1, so no Cloudflare
  Access cookie or duplicated gateway secret is required.
- Shortcut dates normalize ISO and day-first local text before persistence.
- Moving a default-account priority row saves immediately and shows an inline
  status, so refreshing Settings preserves the new first account without
  requiring a separate Save click.

## Test Coverage

- `tests/settings-workflow.test.mjs` covers shortcut draft defaults and reorder
  behavior.
- `tests/settings-refresh-plan.test.mjs` covers the settings-only refresh plan
  for shortcut settings saves.
- `tests/e2e/settings-reference-data.spec.js` covers saving the shortcut key
  and priority order, then creating an entry without account fields through
  the protected shortcut API.
- `tests/e2e/settings-reference-data.spec.js` also covers moving an account
  priority row from the UI, waiting for the save endpoint, refreshing Settings,
  and verifying the moved account remains first.
- `tests/e2e/settings-reference-data.spec.js` covers the install action saving
  the key, copying the authenticated connection URL, opening the verified
  iCloud URL, rejecting partial replay headers, and accepting a local date.
- The downloaded signed iCloud artifact was decrypted and inspected: it has
  nine actions, one setup question targeting action index 5, no token, and no
  unexpected headers or JSON keys.
- Closure verification passed TypeScript, the production build, all 173 unit
  and parser tests, all 116 smoke scenarios, and all 31 additional browser
  scenarios outside the smoke bundle.
- Browser layout checks passed at 390 by 844 and 1280 by 720 with no document
  overflow, no control overlap, a masked key by default, and no console errors
  or warnings while the advanced settings were open.
- The single-process smoke command reached 89 passing scenarios before the
  local Wrangler proxy repeatedly ended with `Network connection lost` after
  roughly four minutes. The remaining 27 smoke scenarios and all 31 non-smoke
  scenarios passed in fresh bounded runs, covering the complete E2E inventory.
- Dedicated-gateway tests prove route isolation, shared production D1 binding,
  absence of static assets, and protected-app response links. The focused
  install browser test proves Settings copies the configured public origin.
- Live production probes return `404` for the gateway root and Settings route,
  reach the Worker for the direct-create POST without a Cloudflare Access
  redirect, and leave the main app protected by Access.

## Closure Result

- Status: passed.
- The public iCloud artifact is secret-free and the private connection is
  generated, saved, and copied only inside the authenticated Settings flow.
- The default account order autosaves and survives a reload.
- Missing or invalid authentication is rejected, partial replay headers are
  rejected, and valid header, Bearer, and private-URL authentication paths are
  covered.
- The install surface is responsive and the advanced controls remain available
  without becoming part of the normal setup path.

## Residual Risks

- The app-managed API key is available in the settings DTO so the user can copy
  or rotate it from the app. This is acceptable only while Settings is protected
  by the app's normal access boundary.
- There is one active app-managed key, not multiple named shortcut keys. Add
  key labels and key history if more shortcuts or devices need independent
  rotation later.
- The private connection URL can appear in the installed shortcut and request
  logs. Treat it as a password and rotate the key after accidental exposure.
- The shortcut gateway is Internet-reachable by design. Its route allowlist and
  high-entropy app key are mandatory controls; add edge rate limiting if this
  becomes a multi-household or high-volume endpoint.
- Apple does not package a personal Transaction automation inside a shared
  shortcut. Each iPhone still needs that final device-local automation step.
- The drag-and-drop UI has button equivalents for accessibility, but mobile
  drag behavior should be checked whenever the Settings layout is redesigned.
