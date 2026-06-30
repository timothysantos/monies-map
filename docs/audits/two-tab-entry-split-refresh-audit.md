# Two-Tab Entry And Splits Refresh Audit

Date: 2026-06-30

## Scenario

- Tab A stays on `Entries`
- user edits a ledger row and may add it to splits
- Tab B stays on `Splits`
- user refreshes Tab B after the split mutation

Observed failure:

- Tab A could briefly show the saved collapsed row, then snap back to older row
  state
- Tab B could hit heavier refresh paths than necessary after split-linked entry
  actions

## Root Cause

Two separate refresh mistakes were stacked together:

1. Entries-side save and split flows were calling
   `refreshEntriesPage({ bypassCache: true, invalidateAppShell: true })`.
   That widened a row-local mutation into shell invalidation.
2. `addEntryToSplits` was broadcasting both an entry mutation and a split
   mutation even though the split mutation already carried the required
   `invalidateEntries`, `invalidateMonth`, and `invalidateSummary` flags.

That combination created avoidable fan-out:

- more cache churn than the workflow needed
- more opportunities for stale shell-backed data to re-seed the Entries page
- duplicate cross-tab freshness work for the same user action

## Fix

Code changes:

- narrowed Entries page refreshes to `refreshEntriesPage({ bypassCache: true })`
  for:
  - normal entry save follow-up
  - add-to-splits follow-up
  - split-group refresh from Entries
  - delete-created-split follow-up
  - manual Entries refresh from filter controls
- removed the redundant `onEntryMutation` broadcast from
  `addEntryToSplits`; the split mutation remains the single cross-tab event for
  that workflow

Result:

- entry edits no longer invalidate the app shell by default
- add-to-splits emits one mutation family instead of two
- stale shell state no longer gets a chance to overwrite the just-saved
  collapsed row in the common Entries workflow

## Regression Coverage

Added or verified:

- `tests/e2e/entries-add-to-splits.spec.js`
  - `editing an entry then adding it to splits keeps the saved row stable across tabs`
- `tests/e2e/splits-cross-tab-refresh.spec.js`
  - `adding an entry to splits refreshes another tab that is already open on splits`
- `tests/e2e/entries-category-filter.spec.js`
  - `category quick-save keeps the collapsed row on the saved category without a page refresh`
- `tests/e2e/money-field-editability.spec.js`
  - `entry amount replaces the formatted value by typing and persists`

## Verification Run

- `tsc --noEmit`
- `tsx --test tests/*.test.mjs`
- Playwright:
  - `tests/e2e/entries-add-to-splits.spec.js`
  - `tests/e2e/splits-cross-tab-refresh.spec.js`
  - targeted checks from:
    - `tests/e2e/entries-category-filter.spec.js`
    - `tests/e2e/money-field-editability.spec.js`

## Remaining Guardrail

Entries mutations should stay on Entries, Month, Summary, and Splits caches
unless the mutation truly changes shell-owned metadata. Row edits and split-link
actions are not shell mutations.
