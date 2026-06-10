# Fourteenth Slice Audit

## Verdict

Ready to close as a narrowing and regression-protection slice.

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

## Measured Narrowing

- Imports refresh no longer performs the extra `clearSummaryPageCache()` and
  `clearSummaryAccountPillsCache()` work before fetching the imports route.
- Split cache clearing no longer clears the app-shell cache merely because a
  mutation affects entries, month, or summary caches; it only clears the shell
  when `refreshShell` is explicitly requested.
- The query foundation suite now asserts that import invalidation does not touch
  the `app-shell` query key.

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
- `App.jsx` still contains the coordination boundary for the app shell and
  shared route refresh paths; this slice narrows its authority but does not
  remove it.
- Explicit shell refresh remains available as a named escape hatch for
  reference-data flows that truly need it.

## Remaining Risk

- The slice does not eliminate all shared infrastructure.
- `App.jsx` remains a coordination gravity center and should be watched for
  future broad refresh pressure.
- Explicit shell refresh remains an escape hatch that can grow if future slices
  overuse it.
- Shared invalidation helpers still exist, so future work should continue to
  guard their scope with regression tests rather than convention alone.

## Why This Is Safe To Close

- The remaining broad shared invalidation path was narrowed rather than
  widened.
- The regression test now protects the narrower import invalidation contract.
- The unit suite and the full serial smoke bundle both pass.
- The slice reduced coordination breadth without reintroducing a global refresh
  abstraction.
