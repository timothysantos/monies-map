# Fourteenth Slice Audit

## Verdict

Ready to close.

## Scope

This audit covers the cross-slice infrastructure cleanup slice focused on query
ownership, invalidation narrowing, and removing broad shared refresh behavior.

## What Was Implemented

- Narrowed shared orchestration in `App.jsx` so imports refresh no longer clears
  unrelated summary caches up front.
- Narrowed split mutation cache handling so app-shell cache clearing happens only
  when the slice explicitly asks for a shell refresh.
- Added a regression in the query foundation tests that keeps import
  invalidation from touching the app-shell key.
- Preserved the existing slice-owned refresh plans and query ownership rules
  instead of broadening shared infrastructure.

## Legacy Paths Removed

- Removed the broad "any downstream invalidation clears app shell" behavior from
  split cache handling.
- Removed unnecessary summary-cache clearing from imports refresh handling.
- Kept the old broad bridge behavior from becoming the default for the new slice.

## Proof

- `node --test tests/query-foundation.test.mjs tests/settings-refresh-plan.test.mjs tests/app-sync.test.mjs tests/splits-workflow.test.mjs tests/month-state.test.mjs tests/entry-refresh-plan.test.mjs`
- `tests/e2e/mobile-continuity.spec.js -g "imports page stays readable on mobile"` passes alone.
- `tests/e2e/reseed-contract.spec.js` passes alone.
- `tests/e2e/entries-delete-entry.spec.js` passes alone.
- Full serial smoke bundle passes with `54 passed`.

## Tests Run

- `node --test tests/query-foundation.test.mjs tests/settings-refresh-plan.test.mjs tests/app-sync.test.mjs tests/splits-workflow.test.mjs tests/month-state.test.mjs tests/entry-refresh-plan.test.mjs`
- `npm run test:e2e -- tests/e2e/entries-delete-entry.spec.js`
- `npm run test:e2e -- tests/e2e/mobile-continuity.spec.js -g "imports page stays readable on mobile"`
- `npm run test:e2e -- tests/e2e/reseed-contract.spec.js`
- Full serial smoke bundle:
  - `tests/e2e/api-performance.spec.js`
  - `tests/e2e/month-page.spec.js`
  - `tests/e2e/entries-delete-entry.spec.js`
  - `tests/e2e/entries-category-filter.spec.js`
  - `tests/e2e/import-ledger-flow.spec.js`
  - `tests/e2e/summary-workflow.spec.js`
  - `tests/e2e/entries-add-to-splits.spec.js`
  - `tests/e2e/mobile-continuity.spec.js`
  - `tests/e2e/reseed-contract.spec.js`

## Intentional Exceptions

- The app shell still owns global composition and the shell query itself.
- Shared invalidation helpers remain, but their behavior is now constrained by
  slice-owned refresh plans and regression tests.

## Remaining Risk

- The slice does not eliminate all shared infrastructure, and future feature
  work should keep watching for broad refresh pressure in `App.jsx` and
  app-sync-style helpers.

## Why This Is Safe To Close

- The remaining broad shared invalidation path was narrowed rather than
  widened.
- The regression test now protects the narrower import invalidation contract.
- The unit suite and the full serial smoke bundle both pass.

