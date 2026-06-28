# App Shell Reference Data Split Audit

Date: 2026-06-29

## Problem

Production showed `/api/app-shell` failures where Cloudflare returned a 503
because the Worker exceeded resource limits. The visible symptom was a startup
screen stuck at "Applying latest data" and later page requests returning an HTML
Cloudflare error page instead of JSON.

The app shell had become too broad. It was meant to load global chrome and route
identity, but it also pulled account and category data that could trigger wider
repository work.

## Findings

1. `/api/app-shell` loaded `loadAccounts()`. That computes balances,
   checkpoint status, unresolved transfer counts, and checkpoint history by
   scanning ledger and statement data. Those fields are useful in Settings and
   Summary wallet pills, but they do not belong in the first-load shell.
2. The app-shell query key included route-shaped inputs such as month, scope,
   and summary range. Changing route state could therefore create a different
   shell request identity even though the shell response is route-neutral.
3. Route page context also loaded full accounts for pages that did not need
   account diagnostics. Summary page did not use that account payload at all.
4. Settings is the legitimate owner of full account diagnostics because it
   renders reconciliation status and checkpoint history. Summary account pills
   also need computed balances, so that cost remains isolated in
   `/api/summary-account-pills`.

## Implemented Fix

- `/api/app-shell` now returns only shell-level data:
  household, available view ids, selected view id, tracked months, viewer
  identity, viewer registration, and environment.
- `/api/reference-data` now serves lightweight account and category lists for
  dropdowns and import mapping. The lightweight account loader does not compute
  balances, checkpoint history, or unresolved transfer counts.
- `/api/settings-page` now carries full account diagnostics, including
  checkpoint history.
- Generic route context no longer loads full accounts.
- Entries warm-start shell uses lightweight account references.
- App-shell cache identity is route-neutral. Month, scope, and summary-range
  changes no longer refetch app-shell.
- Account and category mutations refresh reference data instead of app-shell.
  Person/demo changes still refresh app-shell because they affect navigation or
  viewer identity.
- The startup effect no longer force-refetches app-shell after ordinary route
  navigation when cached shell data already exists.

## Tests

Covered by:

- `tests/query-foundation.test.mjs`
  - `buildAppShellParams keeps the shell route-neutral`
  - `queryKeys.referenceData returns a stable reference slice key`
- `tests/settings-refresh-plan.test.mjs`
  - account/category mutations refresh reference data, not app-shell
  - person/demo changes still refresh app-shell
- `tests/e2e/app-shell.spec.js`
  - `/api/app-shell` stays shell-only
  - `/api/reference-data` owns lightweight account/category lists
  - top-level route transitions still render
- `tests/e2e/settings-reference-data.spec.js`
  - account and category edits refresh reference data
  - downstream summary, entries, month, and shell identity behavior still works
- `npm run verify`
  - strict TypeScript, parser/unit contracts, production build, and smoke bundle

## Residual Risk

- `/api/settings-page` and `/api/summary-account-pills` still run full account
  diagnostics. That is intentional because those screens display the computed
  values. If either endpoint becomes a production bottleneck, split account
  health and checkpoint history into a dedicated paged diagnostics endpoint.
- `trackedMonths` remains in app-shell because navigation needs it. If imported
  history grows enough for this to become costly, replace it with a compact
  month-range summary or a route-local month list.
- Import preview and commit can still be heavy. They should remain draft-scoped,
  chunked, and covered by diagnostics rather than being folded into app-shell.
