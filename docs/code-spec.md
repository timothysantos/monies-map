# Code Spec

This document is the compact implementation spec for Monies Map.

Read it after [`docs/architecture.md`](./architecture.md) and before touching
query wiring, slice modules, or page workflows. It exists to keep the
implementation phase constrained enough for humans and smaller coding models.

## Reading Order

Use this order for implementation work:

1. `AGENTS.md`
2. [`docs/architecture.md`](./architecture.md)
3. [`DOMAIN.md`](../DOMAIN.md)
4. one or two task-specific docs only:
   - behavior: [`docs/scenario-catalog.md`](./scenario-catalog.md)
   - boundaries: [`docs/slice-inventory.md`](./slice-inventory.md)
   - queries: [`docs/query-map.md`](./query-map.md)
   - current guardrails:
     [`docs/existing-behavior-guardrails.md`](./existing-behavior-guardrails.md)
   - responsive behavior:
     [`docs/responsive-behavior.md`](./responsive-behavior.md)
   - CTA semantics:
     [`docs/interaction-guidelines.md`](./interaction-guidelines.md)
5. this file for implementation shape and performance limits

Prompting rule for implementation:

- name the target slice
- name the target scenarios
- name the target query contract
- name the target responsive/interaction docs only if the workflow touches them

## Why The Worker Sometimes Goes 503

The current app already shows the main risk:

- broad first-load requests can still be slow if they pull too much data
- `src/index.ts` logs API pages as slow at `750ms`
- `src/client/App.jsx` still owns the shell and route orchestration
- E2E tests already defend against "worker restarted mid-request"

The likely failure mode is:

1. a broad request ties up too much worker time or memory
2. the worker restarts, stalls, or gets temporarily throttled upstream
3. the client retries while the worker is still unhealthy
4. many routes fail together until the isolate recovers

This refactor should reduce that risk by:

- replacing broad bootstrap hydration with smaller slice-owned requests
- removing old paths in the same slice once a replacement passes tests
- avoiding eager prefetch storms
- keeping warmup cancellable and low priority
- invalidating narrowly instead of reloading the world after each write

## Performance Budgets

These are target budgets, not platform guarantees.

The current slow-log threshold is `750ms`. New visible page queries should aim
to stay well below that.

| Query / workflow | Target server time | Stretch limit | Notes |
| --- | --- | --- | --- |
| `appShell` | `<= 200ms` | `350ms` | no page payloads |
| `summaryPage` | `<= 300ms` | `500ms` | aggregates only |
| `summaryAccountPills` | `<= 200ms` | `350ms` | keep separate if costly |
| `monthPage` | `<= 350ms` | `600ms` | month rows and metrics only |
| `entriesPage` | `<= 400ms` | `650ms` | paged or filtered, not full world |
| `importsPage` | `<= 250ms` | `400ms` | list and lightweight metadata |
| `importPreview` | `<= 700ms` | `1200ms` | heavy but draft-sensitive |
| `splitsPage` | `<= 300ms` | `500ms` | slice-owned |
| `settingsPage` | `<= 250ms` | `400ms` | reference data |
| warmup / prefetch | `<= 250ms` | `400ms` | must yield to visible work |

Budget rules:

- visible page queries over `750ms` are a design smell
- warmup must stop before it competes with the active page
- one slow query is acceptable temporarily; broad slow dependency chains are not
- mutations may take longer, but their follow-up invalidation should stay narrow

## Query State Chart

```text
Route intent
  -> Resolve route params
  -> Start primary query only
  -> Render shell / keep previous safe data
  -> Primary query settles
  -> Render active page
  -> If page is stable, maybe start one warmup query

Mutation intent
  -> Check for active workflow lock
  -> Save mutation
  -> Apply optimistic or immediate local state if needed
  -> Invalidate exact affected queries
  -> Cross-tab notify if data changed
  -> Reconcile stale queries when safe to replace
```

## Query Ownership Contract

Each slice owns:

- route-to-query param mapping
- query key builder
- query option builder
- mutation invalidation map
- selectors that shape query data for UI
- tests for route contract and invalidation behavior

Each slice must not own:

- another slice's hidden query dependencies
- broad bootstrap reads as a shortcut
- compatibility fallbacks that outlive the slice that introduced them
- global refresh side effects that ignore workflow locks

## Invalidation Contract

Use this shape for each mutation:

```text
Entry save
  -> invalidate entriesPage for current route
  -> invalidate monthPage for affected month/view/scope
  -> invalidate summaryPage for affected summary range(s)
  -> invalidate summaryAccountPills if account balances can change
  -> notify cross-tab listeners
```

```text
Month plan save
  -> invalidate monthPage for affected month/view/scope
  -> invalidate summaryPage for affected range
  -> keep open editor stable until save settles
```

```text
Import commit / rollback
  -> invalidate importsPage
  -> invalidate entriesPage for affected months/accounts
  -> invalidate monthPage for affected months
  -> invalidate summaryPage for affected ranges
  -> invalidate summaryAccountPills for affected accounts
  -> clear persisted shell cache
  -> broadcast cross-tab refresh
```

Invalidation rules:

- invalidate the smallest key set that can be defended clearly
- do not use "invalidate everything" as the default
- stale is allowed immediately; visible replacement is not allowed if it would
  clobber an active workflow

## Workflow Lock Contract

Protected workflows include:

- quick entry opened from URL
- mobile entry edit sheet
- mobile filter sheet with in-progress state
- month add/edit sheet
- import preview draft
- split-group selection flow

Protected workflow pseudocode:

```text
if workflowLock.isActive(slice, workflowId):
  markQueriesStale()
  deferVisibleReplacement()
else:
  refetchAndReconcile()
```

## Data Flow Pseudocode

Keep slice code close to this shape:

```text
route params
  -> slice query options
  -> fetch DTO
  -> slice selector
  -> presentational component
  -> user action
  -> slice mutation action
  -> repository / API
  -> narrow invalidation
  -> selector recomputes
  -> UI settles
```

Do not skip from route or component directly into scattered helper calls.

## Stress Tests

Each implemented slice should have at least one stress-oriented test from this
list when relevant:

- same-tab return after drilldown edit shows fresh values
- cross-tab mutation refreshes stale page on focus
- mobile workflow does not get clobbered by background freshness
- manual refresh during an open workflow does not lose the draft
- rapid route changes cancel or ignore stale warmup work
- two quick saves do not let the older refresh overwrite the newer state
- slow query or restart does not break persisted app-shell cache
- import parser accepts structural variants from the same bank source

## Code Shape Rules

These are defaults, not excuses for clever golfing.

- target `80-120` characters per line
- target `20-50` lines per function
- split earlier if one function mixes orchestration, shaping, and rendering
- keep one main responsibility per file when practical
- prefer one exported slice entry point over many wide helpers
- keep public APIs small and intention-revealing
- target `200-500` lines per handwritten module
- treat `800+` line handwritten modules as mandatory extraction work, not a
  normal steady-state shape
- if `App.jsx`, `app-shell.ts`, or a page module grows large during migration,
  move page logic into slice deep modules instead of letting the file keep
  accumulating responsibilities
- `src/domain/app-shell.ts` is for shell orchestration and shell-shared DTO
  builders; keep route-page fragments out of that layer
- if several route modules repeat the same route-context or month-selection
  logic, extract that logic into `src/domain/page-shared.ts` or another shared
  domain fragment before the duplication spreads
- `src/domain/page-shared.ts` is only for shared route-page/domain fragments;
  do not park formatting helpers, UI labels, parsing helpers, or React-only
  logic there

Good function split:

- `buildEntriesPageQueryOptions`
- `selectEntriesTotalsStrip`
- `saveEntryAndInvalidate`

Bad function split:

- giant one-file page helper with fetch, normalize, totals, filters, and UI
  branching mixed together

Refactor rule:

- old compatibility code and new replacement code should not both remain once
  the replacement passes the slice tests
- large legacy files are migration targets, not permission to keep adding more
  responsibilities to the same file
- split the file by slice boundary first, then by helper depth inside the slice

## Comment Rules

Comments are required when the code hides one of these:

- business rule
- persistence contract
- cache invalidation reason
- workflow lock reason
- non-obvious fallback behavior

Comment rules:

- explain why, not the obvious what
- keep comments short and local
- add a short contract comment above dense selectors or mutation orchestration
- do not narrate every line

## Refactor Cutover Rule

When a slice migrates to a new query, route, or workflow boundary:

- the new path should replace the old path in the same change whenever
  possible
- if the old path must exist temporarily, it must be deleted before the slice
  is declared complete
- do not leave hidden compatibility branches behind for future slices to
  discover later

## Documentation Output Rule

When implementing a non-trivial change, update only the narrowest docs needed:

- vocabulary change: `DOMAIN.md`
- global repo rule: `AGENTS.md`
- architecture or migration change: `docs/architecture.md`
- behavior change: `docs/scenario-catalog.md`
- query or invalidation change: `docs/query-map.md`
- current-product lesson to preserve: `docs/existing-behavior-guardrails.md`
- code-shape or implementation rule change: this file

Keep docs compact. Prefer one sharp update to one right file over repeating the
same rule in five places.
