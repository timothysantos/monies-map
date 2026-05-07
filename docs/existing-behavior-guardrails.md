# Existing Behavior Guardrails

This document captures learned behaviors from the current app that must not be
silently lost during the architecture rewrite.

These are not future ideas. They are current product constraints already
encoded across client code, tests, and user-facing FAQ behavior. Treat them as
guardrails for the TanStack migration and slice refactor.

## Why This Exists

Monies Map has several behaviors that look incidental if you only read one
component, but they are actually product requirements learned through bugs and
real usage.

Examples:

- quick-entry URLs should not reopen on refresh
- mobile editing flows should not be clobbered by background freshness
- cross-tab changes should make stale pages settle quickly
- prefetch should improve snappiness without competing with visible work
- optimistic updates should not be overwritten by older refreshes

If these rules stay scattered across components, the rewrite will likely
reintroduce old regressions.

## Rule 1: URL-Triggered Quick Entry Is A One-Shot Workflow

Current behavior:

- `Entries` accepts quick-expense URL params such as `action=add-expense`
- the URL payload is converted into a normal draft once
- the special query params are removed from the URL after translation
- the draft is kept in session storage as a reload safety net
- the composer waits for the correct month payload before opening
- an explicit linked-entry edit target overrides the pending quick-entry draft

Why it matters:

- browser refresh should not relaunch the same quick-entry workflow forever
- account/category choices must match the loaded page context
- mobile handoff from an external shortcut must survive fragile refresh moments

Design implication:

- TanStack route/query redesign must preserve one-shot URL semantics
- quick-entry is a workflow, not just a set of search params

Source anchors:

- `src/client/entries-panel.jsx`
- `docs/faq.md`

## Rule 2: Active Workflows Outrank Background Freshness

Current behavior:

- some flows are sensitive to auto-refresh and cross-tab invalidation
- open mobile edit sheets, quick-entry drafts, and import-preview drafts must
  not be silently closed or reset by a background refresh

Examples of protected workflows:

- quick entry opened from URL or shortcut
- mobile entry edit sheet
- month add/edit sheet
- import preview draft and statement review

Why it matters:

- freshness is valuable, but losing a draft is worse
- mobile is especially vulnerable because the active workflow often lives in a
  sheet, dialog, or route-driven editing state

Design implication:

- stale marking can happen immediately
- destructive refetch application must be gated until the workflow settles
- TanStack invalidation design must distinguish `stale` from `safe to replace`

Source anchors:

- `src/client/entries-panel.jsx`
- `src/client/App.jsx`
- `src/client/imports-panel.jsx`
- `docs/faq.md`

## Rule 3: Cross-Tab Freshness Must Work Without Forcing A Full Reload

Current behavior:

- app tabs communicate through `BroadcastChannel` and storage events
- persisted changes in one tab should cause other tabs to refresh or reconcile
- Summary and Month are expected to stay aligned after imports and edits

Why it matters:

- users work across Summary, Month, Entries, Imports, and Settings in separate
  tabs
- stale totals or stale account pills break trust quickly in a finance app

Design implication:

- cross-tab invalidation is a first-class capability
- each slice must know which queries become stale after each mutation
- cross-tab refresh must still respect local workflow locks

Source anchors:

- `src/client/App.jsx`
- `tests/e2e/import-ledger-flow.spec.js`
- `tests/e2e/splits-cross-tab-refresh.spec.js`

## Rule 4: Warmup Must Be Staged, Sparse, And Easy To Stop

Current behavior:

- prefetch starts only after the first usable screen renders
- it prefers likely next navigation, especially adjacent month or summary range
- it runs one request at a time with spacing between requests
- touch devices skip background API prefetching
- route change, tab hide, edit, import, rollback, manual refresh, data-saver,
  or invalidation stops staged prefetch

Why it matters:

- the app currently feels snappy partly because likely-next screens are warmed
- mobile should not pay for desktop-style warmup behavior
- warmup must never outrank visible page loading or mutation settlement

Design implication:

- keep warmup as a planned behavior in the TanStack architecture
- warmup queries must be low-priority and cancellable or ignorable
- do not reintroduce eager "load everything after bootstrap" behavior

Source anchors:

- `src/client/App.jsx`
- `docs/faq.md`

## Rule 4a: Broad Route Queries Can Trigger Worker Instability

Current behavior and lesson:

- the app still leans heavily on `bootstrap`
- `src/index.ts` already logs API pages slower than `750ms`
- broad slow requests increase the chance of worker restart, upstream throttle,
  or temporary blanket request failure
- E2E helpers already defend against "worker restarted mid-request"

Why it matters:

- this feels to the user like random `503` failures across the app
- retrying the same broad request pattern can keep the app unhealthy longer

Design implication:

- treat worker-safe query budgets as an architecture concern, not just a nice-
  to-have optimization
- split broad route payloads before adding more retries
- prefer smaller independent requests over one request that hydrates many
  screens

Source anchors:

- `src/index.ts`
- `src/client/App.jsx`
- `tests/e2e/helpers.js`

## Rule 5: Persisted Shell Cache Is Allowed, But Writes Must Burst It

Current behavior:

- the app can render a persisted bootstrap payload immediately on refresh
- it then refreshes in the background
- writes that change app data clear the stored bootstrap copy

Why it matters:

- this is one of the reasons refresh and return navigation feel fast today
- without cache-burst rules, stale ledger state survives too long

Design implication:

- a future `appShell` cache is acceptable
- persisted shell data must stay light
- any mutation that changes authoritative ledger or planning state must clear or
  invalidate persisted shell data predictably

Source anchors:

- `src/client/App.jsx`
- `docs/faq.md`

## Rule 6: Optimistic UI Needs Stale-Refresh Guards

Current behavior:

- some slices update local UI immediately, then refresh downstream derived data
- `Splits` uses a refresh-generation guard so an older refresh cannot clobber a
  newer optimistic state

Why it matters:

- naive refetch-after-save logic can reintroduce flicker, reordering, or state
  rollback
- the problem is not only correctness; it is preserving trust in the editing
  surface

Design implication:

- when a slice uses optimistic editing, it needs an explicit freshness
  reconciliation strategy
- stale server responses must not blindly replace newer local intent

Source anchors:

- `src/client/splits-panel.jsx`
- `src/client/entry-actions.js`

## Rule 7: Import Preview Refresh Is Explicit And Throttled

Current behavior:

- statement preview refresh is not a naive always-refetch loop
- preview refresh depends on preview identity and throttle rules
- focus or visibility can trigger refresh under guarded conditions
- reconciliation-sensitive edits may force an immediate preview refresh to keep
  badges and checkpoint state accurate

Why it matters:

- import preview is expensive and draft-sensitive
- users need fresh reconciliation state, but not at the cost of churn and
  unstable review surfaces

Design implication:

- import preview should remain a deep workflow module with its own refresh
  rules
- do not collapse preview freshness into generic global window-focus behavior

Source anchors:

- `src/client/imports-panel.jsx`
- `src/client/import-preview-auto-refresh.js`
- `tests/e2e/import-preview-auto-refresh.spec.js`

## Rule 7a: Import Parsers Must Tolerate Structural Variants From The Same Source

Current behavior and lesson:

- files that look human-identical can differ structurally underneath
- one concrete example is UOB current-transaction XLS exports stored in the OLE
  mini-stream instead of the main workbook stream
- header-matching alone is not enough if the workbook reader fails before the
  parser even sees the rows

Why it matters:

- brittle importers create repeated production regressions for normal bank
  export changes
- this problem applies across banks and export types, not only to UOB

Design implication:

- treat bank/source recognition as a deep parser concern, not as a thin string
  match
- keep real fixture coverage for each supported importer, including small
  structural variants from the same source
- prefer parser error messages that distinguish:
  - unsupported format
  - unreadable workbook/container
  - recognized format with unexpected header/layout variation

Source anchors:

- `src/lib/statement-import/xls.ts`
- `tests/fixtures/uob-current-transactions/`

## Rule 7b: Preserve The Original Parse Path Before Adding A Fallback

Current behavior and lesson:

- the original workbook-stream parse path is still the default for UOB XLS
- the OLE mini-stream reader exists as a fallback for smaller files that need
  it
- a fallback should not silently replace the original path for every file of the
  same nominal format

Why it matters:

- some related exports share a bank family but not the same low-level workbook
  layout
- forcing one structural workaround across the entire family can break files
  that previously worked

Design implication:

- when a parser has an established canonical path, keep that path first
- add a fallback only when the fallback is needed for a clearly identified
  subtype or structural variant
- regression tests should include at least one case for the original path and
  one for the fallback path when both exist

Source anchors:

- `src/lib/statement-import/xls.ts`
- `tests/uob-current-transactions-xls.test.mjs`

## Rule 8: URL State Sometimes Represents Workflow State, Not Just Filters

Current behavior:

- some URL params are simple filters or route context
- other URL params intentionally preserve workflow state, such as:
  - `editing_entry`
  - `split_group`
  - `split_mode`
  - summary focus and range state

Why it matters:

- not all search params are equal
- removing or normalizing them too aggressively can destroy the user's current
  workspace

Design implication:

- the rewrite should classify URL params by role:
  - route identity
  - filter state
  - workflow restoration state
  - one-shot launch state

Source anchors:

- `src/client/entries-panel.jsx`
- `src/client/splits-panel.jsx`
- `src/client/summary-panel.jsx`
- `src/client/App.jsx`

## Rule 9: Same-Tab Return Should Feel Fresh Without Looking Like A Hard Reload

Current behavior:

- a user can move from Summary to Month or Entries, save, and come back
- related totals, month cards, donut shares, and account pills are expected to
  settle quickly
- the visible app should not feel like it discarded all local context

Why it matters:

- this app is built around drilldown and return navigation
- "fresh but jarring" is not good enough

Design implication:

- same-tab return should prefer narrow invalidation, background settlement, and
  placeholder continuity over full-screen teardown
- this should be tested as a navigation contract, not left to incidental query
  timing

Source anchors:

- `tests/e2e/import-ledger-flow.spec.js`
- `docs/scenario-catalog.md`

## Rule 10: Mobile And Desktop May Share Domain Semantics But Not Mechanics

Current behavior:

- desktop and mobile often share the same business goal but use different
  containers and interaction mechanics
- mobile relies more on sheets, compact context controls, and stricter refresh
  caution

Why it matters:

- a technically correct shared implementation can still regress mobile UX
- mobile background work competes more directly with visible editing

Design implication:

- preserve responsive behavior as a first-class planning concern
- when workflows differ by form factor, the tests and slice boundaries should
  acknowledge that directly

Source anchors:

- `src/client/entry-mobile-sheet.jsx`
- `src/client/month-page` related flows
- `tests/e2e/month-page.spec.js`
- `docs/responsive-behavior.md`

## How To Use This During Refactors

Before changing a slice:

- identify which of these guardrails apply
- add or update the scenario coverage first
- ensure the slice query plan preserves the relevant freshness behavior
- avoid replacing a specific guardrail with a vague "TanStack will handle it"

If a behavior is intentionally changed:

- update this document
- update the scenario catalog
- update the query map or responsive behavior docs as needed
- document the product reason for the change
