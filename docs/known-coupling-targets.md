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
| Runtime schema initialization order (`ensureDemoSchemaOnce` in `app-repository.ts`) | A freshly migrated `schema.sql` database serves its first `/api/app-shell` request with 200: tables that legacy repairs write (such as `audit_events`) exist before the repairs run, and repair audits never assume the default household exists. An existing household still gets the OCBC repair audit, and a transient failure is retried on the next request | `infrastructure` | Local D1 (`tests/fresh-schema-initialization.test.mjs`) |
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
