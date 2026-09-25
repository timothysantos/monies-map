# Known Coupling Targets

This document records the audit findings that should become explicit tests or
contract checks before and during the Stage 4 refactor.

Use it together with:

- [`docs/preimplementation-checklist.md`](./preimplementation-checklist.md)
- [`docs/implementation-order.md`](./implementation-order.md)
- [`docs/scenario-catalog.md`](./scenario-catalog.md)
- [`docs/query-map.md`](./query-map.md)

## Target List

The [2026-09-22 macro plan](./macro-performance-plan.md) adds task-scoped tests
for all-route bundle warmup (P1), banner cancellation versus active Imports
ownership (P2), AI readiness during protected workflows (P3), initialization
outside API timing (P4), and cache/snapshot ownership races (P6). These are open
targets, not claims that runtime regressions have already been reproduced.
The [detailed handoff](./macro-performance-implementation.md) additionally requires
URL-parameter/query-key identity characterization (H02), complete panel-local
busy reporting (H03), and shared query cancellation/promotion race tests (H06)
before broadening warmup cache reuse.

| Risk area | What should be tested | Primary slice | Test level |
| --- | --- | --- | --- |
| Route-page cache clears vs specialized keys (`App.jsx` `clearRoutePageCache*`, Splits `invalidateMonth`) | A Settings or split mutation that should refresh Month/Splits/Imports/Settings clears the key those routes actually cache under (`month-page`, `splits-page`, …), not `route-page`. Characterized in audit §H02; no stale UI observed yet | `app shell`, `settings`, `splits` | `Unit` and `E2E` |
| Month route query identity (`query-keys.js` `routeRequestKey`) | Switching Month from Household to a person issues a new `month-page` request and shows that person's figures; the fetched key equals the key `invalidateMonthQueries` targets. Proven broken on 2026-09-23 (audit §H01 finding 5); repaired in H02 (`403bb63`), covered by `month-page.spec.js` and the key matrix in `query-foundation.test.mjs` | `month` | `Unit` (real QueryClient) and `E2E` |
| Runtime schema initialization order (`ensureDemoSchemaOnce` in `app-repository-schema.ts`) | A freshly migrated `schema.sql` database serves its first `/api/app-shell` request with 200: tables that legacy repairs write (such as `audit_events`) exist before the repairs run, and repair audits never assume the default household exists. An existing household still gets the OCBC repair audit, and a transient failure is retried on the next request | `infrastructure` | Local D1 (`tests/fresh-schema-initialization.test.mjs`) |
| First-load page error vs shell arrival (`App.jsx` `routePageError`, `loadAppShell`, the route-page contract check) | A Summary/Month/Splits/Imports/Settings page request that fails before the app shell lands still shows the page error screen, and its Retry makes one page request per attempt and renders the page; a shell failure plus a page failure recover through both screens. Proven broken on 2026-09-24: shell success cleared the page error (a workaround for a Summary contract error raised before the shell arrived), leaving the loading panel up forever. Shell loads no longer touch page errors and the contract check waits for the shell; covered by `app-shell-chrome.spec.js` "first-load page failures" | `app shell` | `E2E` |
| Superseded server responses (`reference-data-owner.js`, `summary-owner.js`, `route-data-owner.js`, `app-shell-owner.js`) | A load or refresh overtaken by a newer one never overwrites newer data, clears it, or raises an error screen; a Settings refresh for a hidden route never supersedes the open route's load. Proven broken before H12: two quick cross-tab refreshes put up the reference-data error screen and dropped an open draft, and a late background refresh of the old month left the new month unusable | `app shell`, `summary`, `month`, `splits`, `settings` | `Unit` and `E2E` (`reference-data-owner`, `route-data-owner`, `summary-owner`, `app-sync-subscription` specs) |
| Optional AI wording readiness (`financial-insight.jsx` `canRequestWording`) | No wording request while an editor or save is open or the route is loading; an aborted, non-OK or stale response is never shown or cached | `summary`, `month`, `entries`, `splits` | `E2E` (`financial-insight.spec.js` readiness block) |
| Month page entry list (`month-page.ts`, `buildPlanLinkCandidates`) | `monthPage.entries` holds every household entry in order, adjusted for the view, so plan-link candidates need no second household list | `month` | `Unit` (`month-page-entries.test.mjs`) |
| Splits month slice (`splits-page.ts`) | Splits carries only `{ month, entries }` with the month's transfers, identical to the Entries page's transfers for the view | `splits` | `E2E` (`splits-page-payload.spec.js`) |
| Mobile data admission (`route-warmup-admissions.js`) | Mobile warms data only for a measured family (gzip bytes and handler p95 within the caps), on 4g, without data saver, after a recent required read of 500 ms or less | `app shell` | `Unit` and `E2E` (`route-warmup-data.spec.js` mobile block) |
| `src/client/App.jsx` app-shell coupling | Shell state, route fallback, cache reset, and cross-tab restore stay coherent while the shell is being retired | `app shell` then `summary`, `month`, `entries` | `Integration` and `E2E` |
| `src/client/query-mutations.js` broad invalidation | Mutation invalidation hits only the affected queries and does not fan out to broad buckets unless the docs allow it | `entries`, `month`, `summary`, `imports`, `settings` | `Integration` |
| `src/client/focus-utils.js`, `src/client/splits-dialogs.jsx`, `src/client/splits-linked-entry-dialog.jsx`, `src/client/account-dialog.jsx`, `src/client/settings-reconciliation-dialog.jsx` amount focus/select behavior | Money inputs do not force select-all just to replace a value; focus should not create a keyboard trap, a late deferred select-all must never select digits already typed (regression: `money-field-editability.spec.js` holds animation frames while typing), and the replacement contract stays consistent across core workflows | `entries`, `month`, `splits`, `imports`, `settings` | `E2E` |
| `src/client/entry-editor.jsx` amount typing contract | Editable amount fields preserve typed draft state and normalize on blur without requiring select-all | `entries` | `E2E` |
| `src/client/entry-editor.jsx` transfer dialog render path | Matched and unmatched transfer rows can open the transfer manager without a missing-import crash, and both transfer directions survive the same render path | `entries` | `E2E` |
| `src/client/month-panel.jsx` month amount editing | Month budget and planned amount fields accept replacement typing naturally and normalize after blur | `months` | `E2E` |
| `src/client/deferred-focus.js` delayed editor autofocus (`splits-dialogs.jsx` amount focus) | A delayed first-field focus never takes focus from a field the person already focused, so a note typed right after opening a split editor stays in Note and the amount is unchanged (regression: `splits-edit-expense.spec.js` holds the short timer while typing) | `splits` | `E2E` |
| `src/client/import-preview-rows-table.jsx` and `src/client/statement-compare.jsx` import/reconciliation amount editing | Import and reconciliation money fields follow the same typing and normalization contract as entries | `imports` | `E2E` |
| Mobile sheets versus desktop editors | Same workflow versus separate workflow is deliberate, and workflow locks protect active sheets from background freshness | `entries`, `months`, `imports` | `E2E` |
| `src/client/monies-client-service.js` helper facade boundaries | Shared helper APIs stay small, and slice-specific logic does not leak back into the facade | all slices, especially `entries` and `months` | `Integration` |

## How To Use This List

- Treat each row as a test target, not just a note.
- If a row affects a user-visible workflow, add or tighten a scenario first.
- If a row is mostly a boundary or cache issue, add or tighten a contract test.
- If a row spans multiple slices, start with the slice most likely to own the
  workflow lock or query boundary.

## Stop Condition

If a new refactor uncovers another repeated coupling pattern, add a row here
before moving more code.
