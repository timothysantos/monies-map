# Smoke Stabilization Audit

## Verdict

Ready to close as a smoke stabilization pass.

## Scope

This audit covers the smoke stabilization pass that began with the order-sensitive `entries-delete-entry` failure and continued through the imports-page readiness cleanup.

## What Was Implemented

- Fixed the stale boot and port issues that were masking the `entries-delete-entry` flow.
- Stabilized the imports-page smoke checks so late-bundle runs no longer fail while waiting on decorative chrome.
- Replaced brittle imports-heading waits with a real readiness contract:
  - wait for `/api/imports-page`
  - assert the stable interactive `Source label` control is visible
- Updated the mobile imports smoke to use the same readiness contract.
- Kept the changes narrow to smoke coverage instead of broadening product semantics.

## Legacy Paths Removed

- Removed reliance on the `Import and certify` heading as the smoke readiness signal.
- Removed the stale imports-page assumption from the cross-tab sync scenario.
- Removed the last lingering import-heading assertion from the long multi-card import flow.

## Proof

- `tests/e2e/mobile-continuity.spec.js` passes alone.
- `tests/e2e/import-ledger-flow.spec.js -g "multi-card statements reconcile while certifying growing midcycle rows"` passes alone.
- The full serial smoke bundle passes with `54 passed`.

## Tests Run

- `npm run test:e2e -- tests/e2e/mobile-continuity.spec.js`
- `npm run test:e2e -- tests/e2e/import-ledger-flow.spec.js -g "multi-card statements reconcile while certifying growing midcycle rows"`
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

- The imports smoke now uses API-backed page readiness and the real interactive field instead of a decorative heading.
- No accounting or workflow semantics were broadened to make the smoke pass.

## Remaining Risk

- The smoke bundle is currently green, but the imports flows are still the most timing-sensitive area and should stay on the bundle watchlist if the page chrome changes again.

## Why This Is Safe To Close

- The original order-sensitive failure was resolved.
- The replacement checks are tied to actual page readiness rather than fragile visible text.
- The serial smoke bundle now gives a trustworthy signal again.

## Framing

This slice stabilizes the current smoke infrastructure. It does not prove permanent reliability, and the imports flows should remain on the watchlist because they are still timing-sensitive and UI-coupled.
