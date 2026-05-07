# Query Map

This document is the Stage 3 TanStack Query and API-shape plan for Monies Map.

Read it alongside
[`docs/existing-behavior-guardrails.md`](./existing-behavior-guardrails.md),
which captures current product behaviors that this query design must preserve,
and [`docs/code-spec.md`](./code-spec.md), which captures the compact
implementation budgets, invalidation shape, and code-size rules.

Its goals are:

- replace bootstrap-heavy loading with smaller slice-owned requests
- keep request payloads short and focused
- preserve current freshness guarantees
- use caching aggressively where data is stable
- retain explicit cache-burst rules where user actions must settle immediately

## Current Problem

Today `GET /api/bootstrap` is carrying too much responsibility.

Observed example:

- `GET /api/bootstrap?month=2026-04&scope=direct_plus_shared`
- duration: `1271ms`

The current bootstrap path builds too much at once:

- household metadata
- accounts
- categories
- tracked months
- selected-month entries
- selected-month plan rows
- summary rows across views and scopes
- income rows across views
- placeholder imports and settings payloads

This is too expensive for first paint, too broad for precise invalidation, and
too large to be the default fetch for every important screen.

For implementation, treat visible route queries that drift past the current
`750ms` slow-log threshold as a design problem unless the workflow is
deliberately heavy, such as import preview.

## Stage 3 Principles

### 1. Bootstrap becomes shell-only

Bootstrap should answer only:

- who is the household
- who is the viewer
- what reference data is needed globally on first load
- what route defaults are needed to render the shell

Bootstrap should stop returning full summary, month, entries, imports, splits,
or settings page data.

### 2. Each screen owns its own query

Each slice should own the requests needed to render its screen and only that
screen.

### 3. Stable data gets long cache windows

Reference data and low-churn data should cache longer in TanStack Query.

### 4. Mutable workflow data gets explicit burst invalidation

Edits to entries, month rows, imports, splits, and settings should invalidate
only the affected slices, but they must still settle promptly so the app does
not regress in freshness.

### 4a. Active workflows outrank freshness bursts

If the user is in the middle of an interactive workflow, freshness must not
destroy that workflow.

Examples:

- mobile quick entry launched from URL
- mobile entry edit sheet
- open import preview draft
- open month add/edit sheet

Rules:

- invalidation may mark data stale immediately
- visible refetch must be gated when it would clobber an active draft or close
  an active workflow container
- the app should reconcile freshness after the workflow is saved, cancelled, or
  explicitly dismissed

### 5. Prefetch is allowed, but only for likely next navigation

Use prefetch for the next likely screen, not as a replacement for route-owned
queries.

## Query Classes

Use these cache classes as planning defaults.

### Class A: Reference data

Examples:

- household
- people
- accounts
- categories
- tracked months
- split groups

Policy:

- `staleTime`: long
- `gcTime`: long
- refetch only on explicit invalidation, login change, or hard refresh

### Class B: Derived but low-churn page metadata

Examples:

- summary metric cards
- summary month cards
- account pills
- settings recent audit history
- imports recent import history

Policy:

- `staleTime`: moderate
- background refetch on window focus is optional, not mandatory
- explicit invalidation after relevant mutations

### Class C: Workflow-critical mutable page data

Examples:

- entries page data
- month page data
- splits page data
- import preview data
- settings trust/reconciliation panels during active editing

Policy:

- `staleTime`: short or zero while actively editing
- explicit burst invalidation after save
- optimistic updates only where the UI already depends on them

## Target Query Inventory

The queries below are the target shape. This is a design contract, not yet an
implementation.

## App Shell Queries

### `appShell`

Purpose:

- render the global shell without loading full feature pages

Response should contain:

- `appEnvironment`
- `household`
- `viewerIdentity`
- `viewerRegistration`
- `selectedViewId`
- `availableViewIds`
- `trackedMonths`
- `accounts` with lightweight account metadata
- `categories`

Must not contain:

- full summary-page payloads
- full month-page payloads
- entries arrays
- imports page payload
- splits page payload
- settings page payload

Cache class:

- `Class A`

Notes:

- this replaces bootstrap as the default first request
- if account health remains expensive, split account health into a separate
  summary-owned or shared query instead of forcing it into the shell

## Summary Slice Queries

### `summaryPage`

Params:

- `viewId`
- `scope`
- `summaryStart`
- `summaryEnd`
- `selectedMonth`

Response should contain:

- summary metric cards
- summary donut range months
- summary donut data by month
- summary month cards

Should not contain:

- account health pills if they are expensive and independently useful
- entries lists
- month workspace rows

Cache class:

- `Class B`

### `summaryAccountPills`

Params:

- `viewId`
- optionally `selectedMonth` if month-relative trust data is needed

Response should contain:

- account pills only

Cache class:

- `Class B`

### `summaryMonthNote`

This should not be its own fetch if notes are already embedded in
`summaryPage`, but the mutation should invalidate only the affected summary
range and the corresponding month data.

## Month Slice Queries

### `monthPage`

Params:

- `viewId`
- `month`
- `scope`

Response should contain:

- month metric inputs
- income rows
- plan sections
- month note
- linked month entries needed for plan linking or drill-down

Should not contain:

- summary range payload
- entries for unrelated months

Cache class:

- `Class C`

### `monthPlanLinkCandidates`

Params:

- `viewId`
- `month`
- `scope`
- `rowId`

Optional query.

If candidate-building stays cheap and deterministic from `monthPage`, keep it
derived client-side. If it remains heavy or couples month to large entry lists,
split it into this focused query.

Cache class:

- `Class C`

## Entries Slice Queries

### `entriesPage`

Params:

- `viewId`
- `month`
- `scope`
- filter params such as category, account, person, type

Response should contain:

- filtered entries list
- totals strip inputs
- filter option metadata needed for the page
- split-group choices needed by `Add to splits`

Should not contain:

- full month planning data
- summary data

Cache class:

- `Class C`

### `entryDeepLinkContext`

Params:

- `entryId`

Optional query for robust cross-page opening of an entry editor from summary,
month, or splits.

Cache class:

- short-lived `Class C`

### `entryFilterMetadata`

Optional query if filter metadata becomes too expensive or too broad inside
`entriesPage`.

Cache class:

- `Class B`

## Imports Slice Queries

### `importsPage`

Purpose:

- load only imports screen metadata and history

Response should contain:

- recent import history
- rollback policy
- import-related reference metadata if needed

Should not contain:

- preview results
- settings page payloads

Cache class:

- `Class B`

### `importPreview`

Params:

- draft signature fields such as source type, account context, file hash,
  mapping signature, ownership defaults, category mode

Response should contain:

- preview rows
- preview counts
- account mapping warnings
- overlap imports
- reconciliation decisions
- statement checkpoints
- statement reconciliation summaries

Cache class:

- `Class C`

Notes:

- use draft-signature keys so stable previews can be reused briefly
- statement preview auto-refresh remains explicit and throttled by draft key

### `importRecentHistory`

This can stay inside `importsPage` unless the list becomes independently useful.

## Splits Slice Queries

### `splitsPage`

Params:

- `viewId`
- `month`
- `groupId`
- `mode`

Response should contain:

- split groups
- selected group summary
- visible activity
- visible matches
- archived-batch metadata

Should not contain:

- entries-page payload
- month planning payload

Cache class:

- `Class C`

### `splitArchiveBatch`

Params:

- `batchId`

Optional query if archive payloads are expensive. Otherwise keep archives inside
`splitsPage`.

Cache class:

- `Class B`

## Settings Slice Queries

### `settingsPage`

Response should contain:

- people
- accounts details needed by settings
- categories
- category match rules
- category match rule suggestions
- unresolved transfers
- reconciliation exceptions
- recent audit events
- demo settings where applicable

Should not contain:

- summary payload
- month page payload
- entries payload

Cache class:

- mostly `Class B`, but trust/reconciliation sub-panels behave like `Class C`

### `settingsAccountTrust`

Params:

- `accountId`

Optional query for reconciliation and checkpoint-heavy account detail.

Reason:

- trust/reconciliation data is a good candidate to split out if settings-page
  becomes too large.

Cache class:

- `Class C`

## Query Key Strategy

The current shared key manager is too broad. The future shape should be:

- shared low-level key normalization utilities
- slice-owned key builders

Target examples:

- `summaryKeys.page(...)`
- `summaryKeys.accountPills(...)`
- `monthKeys.page(...)`
- `entriesKeys.page(...)`
- `importsKeys.page(...)`
- `importsKeys.preview(...)`
- `splitsKeys.page(...)`
- `settingsKeys.page(...)`

This keeps invalidation policy close to the slice that understands the
consequences.

## Cache Freshness Plan

These are behavioral targets, not exact library options yet.

## App shell freshness

- do not refetch aggressively on every tab switch
- invalidate on:
  - login identity registration changes
  - settings changes that rename people/accounts/categories shown globally
  - explicit demo reseed or reload

## Summary freshness

- invalidate after:
  - entry create/edit/delete that affects the summary range
  - month plan row create/edit/delete
  - import commit or rollback affecting the range
  - split mutation that changes linked entry ownership or totals included in the
    summary

Do not invalidate after:

- settings changes unrelated to visible summary labels
- splits-only changes with no linked ledger effect

## Month freshness

- invalidate after:
  - month row edits
  - month note changes
  - plan-link changes
  - entry create/edit/delete in the same month and view
  - import commit or rollback in the same month
  - split mutations that change linked ledger behavior in the same month

## Entries freshness

- invalidate after:
  - entry create/edit/delete
  - transfer linking or settlement
  - import commit or rollback in the same month
  - split linking/unlinking that changes entry ownership or linked split state

Special rule:

- filtered editing must preserve the active edit session until save settles,
  even if the saved row falls out of the query result afterward
- quick-entry and mobile-sheet flows must preserve the active draft even if
  same-tab or cross-tab invalidation fires underneath them

## Imports freshness

- invalidate imports history after:
  - import commit
  - import rollback

- invalidate import preview only when:
  - draft signature changes
  - explicit preview refresh is triggered
  - statement auto-refresh throttle permits it

## Splits freshness

- invalidate after:
  - split expense create/edit/delete
  - split settlement create/delete
  - split match link actions
  - group create/edit actions

Also invalidate:

- entries page for the affected month/view when a linked entry changes
- month page for the affected month/view when a linked entry affects month
  totals
- summary page for the affected range/view when ownership or totals contributing
  to summary change

## Settings freshness

- invalidate relevant settings queries after settings CRUD
- selectively invalidate app shell reference data after:
  - person rename
  - account create/edit/archive
  - category create/edit/delete
  - category rule changes that affect imports later

Do not burst everything after every settings save.

## Workflow Locks

To prevent repeats of past auto-refresh regressions, the TanStack design should
model workflow locks explicitly.

Workflow lock means:

- a query may become stale
- invalidation may be recorded immediately
- but visible refetch or destructive state replacement is deferred until the
  lock clears

Examples of lock-worthy workflows:

- quick entry opened from URL or external shortcut
- active mobile entry edit sheet
- active month add/edit sheet
- active import preview draft under user review

### Lock behavior

- allow background invalidation bookkeeping
- allow non-destructive cache writes that do not overwrite the active draft
- block destructive refetch application that would close, reset, or replace the
  active editor surface
- once the lock clears, refetch or reconcile the stale queries promptly

### Lock scope

Locks should be as narrow as possible.

Good:

- lock `entriesPage` replacement while entry draft is open
- still allow unrelated reference-data queries to update

Bad:

- freezing the whole app because one mobile sheet is open

## Same-Tab And Cross-Tab Freshness

The app should distinguish:

- same-tab return after a mutation
- cross-tab invalidation from a separate tab
- passive stale marking versus active visible refetch

### Same-tab return

Preferred behavior:

- invalidate immediately after mutation
- refetch in background where safe
- when the user returns to the originating page, show fresh or settling data
  without a jarring reset

### Cross-tab invalidation

Preferred behavior:

- broadcast invalidation metadata promptly
- if the target tab has no protected workflow open, allow background refetch or
  refetch on focus
- if the target tab has a protected workflow open, keep it intact and delay
  destructive refresh until the workflow ends

### Mobile caution

Mobile quick-entry and sheet-based editing must be treated as especially
fragile:

- they are easier to disrupt with route-param cleanup, focus events, and full
  page replacement
- therefore mobile editing flows should default to stronger workflow-lock
  behavior than passive desktop read states

## Bootstrap Reduction Plan

This is the migration target for replacing the heavy bootstrap request.

### Current

`bootstrap`

- shell data
- summary data
- month data
- entries data
- placeholder imports data
- placeholder settings data

### Target

`appShell`

- shell-only

Then route-owned fetches:

- `summaryPage`
- `summaryAccountPills`
- `monthPage`
- `entriesPage`
- `importsPage`
- `splitsPage`
- `settingsPage`

### Transitional rule

During migration, bootstrap may temporarily continue serving `summary` and
`month` only for initial load fallback, but it must stop being the primary data
source once route-owned queries exist.

The app should treat bootstrap-backed route rendering as compatibility mode, not
as the destination architecture.

## Request Efficiency Rules

### Keep params narrow

- do not send unused filters
- scope queries by `viewId`, `month`, `scope`, and only the active filter set
- avoid one endpoint that returns both range data and row-level data

### Keep payloads narrow

- do not return reference data repeatedly inside page payloads unless needed
- avoid embedding unrelated slice data
- avoid returning all views when only one active view is needed

### Prefer aggregation endpoints for aggregate screens

- summary should fetch summary-shaped aggregates, not raw entries
- month should fetch month-shaped rows and derived totals, not whole-range data

### Preserve freshness with explicit invalidation, not giant refetches

- use burst invalidation of exactly affected queries
- avoid `invalidateQueries(["route-page"])` as a long-term default

## Prefetch Strategy

Prefetch should remain conservative.

Allowed:

- prefetch likely next route module code
- prefetch next likely page query on hover or idle
- prefetch adjacent month page when the user is actively navigating by month

Avoid:

- prefetching all slices after bootstrap
- prefetching heavy summary and month data for inactive views by default

## Warmup Strategy

The current app feels snappy partly because it warms adjacent screens after the
main page is usable. That behavior should be retained, but formalized.

Rules:

- the active page query always has priority over warmup queries
- warmup starts only after the active page reaches a usable state
- warmup must never block first render of the active page
- warmup should target likely next navigation, not every possible page
- warmup should be cancellable when route intent changes

### Primary-first loading contract

For each route:

1. load the shell query
2. load the active page query
3. render usable content
4. then warm adjacent queries in the background

Examples:

- on `Summary`, warm:
  - current `Month` for the same `viewId`, `scope`, and selected month
  - `Entries` for the focused month and same `viewId` if the user is likely to
    drill down
- on `Month`, warm:
  - adjacent month pages for the same `viewId` and `scope`
  - `Entries` for the same `viewId` and month
- on `Entries`, warm:
  - current `Month` for the same `viewId` and scope
  - `Splits` for the same month and likely split view when the current view is
    person-scoped
- on `Splits`, warm:
  - `Entries` for the same month and `viewId`
- on `Imports`, warm:
  - imports history only, not unrelated page data
- on `Settings`, avoid broad warmup by default

### Warmup priority order

Use a strict order:

1. same-route data needed for immediate interaction
2. likely next screen in the same workflow
3. adjacent month or focused drill-down destinations

Do not warm low-probability routes before higher-probability ones.

## Cancelling Warmup Gracefully

Yes, this should be supported and planned for explicitly.

Warmup queries should be treated as disposable work:

- if the user changes tab, month, view, or scope, stale warmup should be
  cancelled where possible
- if the user triggers a hard refresh or explicit mutation burst, stale warmup
  should not keep competing with active queries
- if the fetch already reached the server and cannot be truly stopped, its
  result should still be ignored or deprioritized if the query key is no longer
  relevant

### Practical mechanism

Use TanStack Query plus fetch abort signals:

- warmup fetches should receive an `AbortSignal`
- route changes should cancel warmup queries by key
- refresh flows should cancel lower-priority warmup queries before starting the
  active refetch when contention matters
- warmup keys should be specific enough that active-query cancellation does not
  accidentally cancel the visible page

### Important nuance

Cancelling is best-effort:

- browser-side fetch can often be aborted cleanly
- once server work is already far along, cancellation may not save all backend
  work
- even then, cancellation still matters because it prevents stale warmup
  results from competing for UI attention and client resources

That is good enough. The goal is not perfect server interruption. The goal is
to preserve responsiveness for the screen the user is actually interacting with.

## Snappiness Rules

These rules are part of the target behavior.

- use warmup only after the active page is interactive
- prefer cached adjacent queries when the user moves predictably between nearby
  screens or months
- keep stale-but-usable data visible during background refetch when route
  intent has not fundamentally changed
- cancel irrelevant warmup quickly when route intent changes
- never let warmup refetches outrank explicit user-triggered refreshes

## Placeholder And Transition Policy

To keep navigation feeling instant without hiding freshness problems:

- use previous-query placeholder data only for semantically adjacent navigation
  such as:
  - same page, next month
  - same page, same month, different category filter
  - same person view, same slice, nearby drill-down
- do not reuse placeholder data across meaningfully different contexts such as:
  - household versus person
  - summary versus entries
  - unrelated months after a large route jump

This keeps transitions smooth while still letting real data settle quickly.

## Refresh And Tab-Change Rules

### Explicit refresh

When the user explicitly refreshes a page:

- cancel in-flight warmup for unrelated queries when useful
- prioritize the active page refetch
- keep warmup paused until the refreshed active page is usable again

### Tab change

When the user changes tabs:

- the next tab's primary query becomes highest priority
- previous-tab warmup should be cancelled or deprioritized
- same-key cached results may still be reused if they remain valid

### Month or scope change

When the user changes month or scope:

- cancel warmup for the old month or scope where possible
- keep only warmup that still matches the new likely-navigation neighborhood

## Implementation Guidance For Later Stages

When this is implemented:

- give warmup queries their own helper layer per slice, rather than scattering
  prefetch logic through large page components
- keep warmup orchestration in the shell or in slice route helpers, not in leaf
  UI components
- log active-query versus warmup-query timings separately so performance work
  does not hide the difference between required and optional requests

## Risks To Watch

### Risk: stale derived totals

Mitigation:

- keep month, entries, summary invalidation rules explicit per mutation class

### Risk: route flicker during migration

Mitigation:

- use placeholder data from previous query only when the route parameters remain
  semantically close

### Risk: hidden dependence on bootstrap data

Mitigation:

- for each slice migration, list exactly which current props are still coming
  from bootstrap and eliminate them deliberately

### Risk: cache over-busting

Mitigation:

- move invalidation ownership into slice mutation helpers
- stop invalidating all route-page queries as a blanket fallback

## Stage 3 Exit Criteria

Stage 3 is complete when:

- bootstrap has a shell-only target definition
- each slice has an explicit page-query contract
- cache classes are defined by data type
- invalidation rules are defined per mutation family
- the migration can reduce payload size without regressing freshness
