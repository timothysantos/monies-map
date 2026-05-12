# Fifth Slice Prompt

Use this prompt for the next implementation slice after the settings query and
workflow slice is in place.

This slice is intentionally focused:

- summary as the range-review and drill-down workspace
- summary page query boundary
- summary account pills freshness and invalidation
- summary note and drill-down workflows
- narrow downstream freshness from entries, month, imports, and settings only
  where the summary view truly depends on them
- fixture-backed regression coverage for summary-driven cross-page effects
- explicit summary-panel thinness and ownership boundaries
- documentation updates only where summary assumptions prove wrong

It is not a broad rewrite of imports, entries, month, settings, or splits.
It is also not a redesign of the household finance domain.

```text
Implement the summary query and workflow slice.

Read and follow:
- AGENTS.md
- docs/architecture.md
- docs/code-spec.md
- docs/implementation-order.md
- docs/preimplementation-checklist.md
- docs/known-coupling-targets.md
- docs/refactor-decisions.md
- docs/scenario-catalog.md
- docs/query-map.md
- docs/slice-inventory.md
- docs/existing-behavior-guardrails.md
- docs/responsive-behavior.md if the work touches mobile/desktop behavior
- docs/interaction-guidelines.md if the workflow touches buttons, dismissals,
  staged controls, or dialog flow
- docs/route-data-code-flow.md

Target slice:
- summary page query boundary
- summary range review workflow
- summary account-pill freshness
- summary drill-down route helpers
- summary note mutation and invalidation
- downstream freshness for entries, month, imports, and settings only where
  the summary view truly depends on them

Target scenarios:
- S1 Review range-level financial picture
- S1a Summary savings target and realized savings use distinct semantics
- S2 Change spending-mix focus month
- S2a Summary head metrics respect the selected scope
- S3 Drill from category share to entries
- S3a Category card drill-down preserves route context
- S4 Drill from account pill to entries
- S5 Open a month from intent-vs-outcome
- S6 Edit a summary month note
- S7 Summary reflects month edits when returning from a drilldown
- S8 Summary reflects entry edits when returning from a drilldown
- S9 Summary tab refreshes after related changes in another tab
- X4 Summary reference-data change affects later workflows

Target coupling rows:
- src/client/summary-panel.jsx summary query and orchestration coupling
- src/client/spending-mix-recharts.jsx summary chart shaping coupling
- src/client/query-mutations.js broad invalidation
- src/client/entries-panel.jsx dependency on summary drill-down route contract
- src/client/month-panel.jsx dependency on summary note and drill-down freshness
- src/client/settings-panel.jsx dependency on summary account-pill freshness
- src/client/app-shell-query.js shell-refresh and cache boundary coupling

Target query contract:
- summaryPage
- summaryAccountPills
- invalidate only the exact slice keys named in docs/query-map.md
- invalidate summary queries after summary note edits and summary-driven
  drill-down changes
- invalidate summary account pills after account, person, or category changes
  that alter visible summary labels or pills
- keep cross-page freshness exact for entries and month only when summary
  mutations actually change their visible data

Constraints:
- keep code within docs/code-spec.md limits
- preserve docs/existing-behavior-guardrails.md
- keep the slice narrow and do not refactor unrelated slices
- update or add tests before moving implementation logic
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen invalidation beyond the documented contract
- do not turn summary into a hidden global refresh service
- do not let summary workflow state leak into app-shell ownership
- do not let broad shell reload become the default answer for summary CRUD
- do not redesign accounting semantics, transfer semantics, or budgeting rules
- do not move entries or month logic into summary helpers just because summary
  consumes them
- keep the workflow narrow and range-review driven
- remove the old summary mutation/query path in the same slice once the new
  path is verified and covered by tests; do not leave compatibility fallbacks
  behind
- commit in small readable batches as the slice progresses
- keep code comments above every important block, hook, branch, and helper in
  any refactored file
- use fixture-backed coverage for downstream effects when a summary change
  alters another workflow
- keep summary as a deep module with explicit refresh rules, not a monolith
- finish with a summary closure audit before considering the slice complete

Implementation rules:
- preserve explicit state ownership between:
  - browser route state
  - query-backed server state
  - summary workflow state
  - transient UI state
- keep browser location as the source of truth for route state
- keep TanStack Query as the source of truth for server-backed state
- keep app shell as global metadata only
- keep summary page lightweight: range review, account pills, drill-down links,
  and summary note actions only
- keep summary panel mostly as rendering and event wiring; move remaining
  workflow decisions into the summary deep module
- keep summary focus and drill-down details out of app-shell bootstrap
- use slice-owned key builders and selectors for summary data
- preserve freshness across:
  - summary invalidation
  - background refreshes
  - route transitions
  - query replacement
  - explicit month and entry mutations that affect summary
- preserve active drill-down or note-edit state while invalidation decides
  whether a rerender or refetch is safe
- keep shell refresh as a narrow exception only where shared metadata changes
  truly require it
- invalidate exact downstream queries for the specific summary change instead
  of falling back to broad shell reloads
- keep summary-driven downstream effects exact and documented
- move boundary decisions into docs if the code proves the current assumptions
  wrong

Deliverables:
- tests for the target scenarios and coupling rows
- summary page and summary workflow code changes only for this slice
- exact invalidation updates for summary note and drill-down freshness
- doc updates only if a documented summary assumption proves wrong
```

## Ownership Model

Use these definitions during the slice so state does not drift across layers.

### Route state

Derived from browser location.

Examples:

- active summary range
- active route
- drill-down route affordance when applicable

The browser URL remains the source of truth.

### Server state

Query-backed server data managed by TanStack Query.

Examples:

- summary page data
- summary account pills
- range aggregates
- drill-down supporting DTOs

TanStack Query remains the source of truth.

If a drill-down artifact is local-first, dialog-oriented, or not yet persisted
into the query-backed response path, treat that artifact as workflow state
instead of server state.

### Workflow state

Long-lived summary workflow continuity.

Examples:

- active focus month
- active drill-down target
- summary note editor state
- pending category-card navigation

Workflow state is not route state and is not server state. It must survive:

- invalidation
- background refreshes
- route transitions
- query replacement
- save/close refreshes

### UI state

Purely local or transient rendering state.

Examples:

- hover state
- modal visibility
- expanded rows
- focused input

UI state must never become authoritative business state.

## Core Architectural Win

The measurable payoff for this slice is not just "summary is cleaner."

The win is:

- summary changes invalidate only the data that actually depends on them
- entries, month, settings, and imports stay fresh without broad shell reloads
- summary drill-down workflows keep their continuity while data refreshes
- account-pill and note changes do not silently become global reload behavior

## Why This Prompt

- It follows the same level of specificity as the imports and settings slice
  prompts.
- It names the actual summary scenarios instead of saying "work on summary."
- It keeps the slice focused on query ownership, invalidation, drill-downs,
  and reference-data propagation.
- It keeps summary from turning into a backdoor rewrite of app shell, route
  context, imports, or unrelated feature slices.
- It captures the lesson from the settings slice that special-case shell
  refresh must stay isolated, named, and test-backed.
- It makes the summary rewrite explicit while still constraining the rewrite
  to range-review ownership and query boundaries instead of domain redesign.

## Why This Is Next

The settings slice is now closed.

That means the next highest-value slice is the one already called out in
[`docs/implementation-order.md`](./implementation-order.md):

- summary is the main downstream range-review workspace
- summary consumes month and entry freshness
- summary account pills and drill-downs are a visible, high-value contract
- summary already has scenario coverage and coupling targets worth tightening

In other words:

- the first slice built shell/query foundations
- the second slice fixed navigation hydration and boundary shape
- the third slice moved imports onto the tighter contracts
- the fourth slice tightened settings reference-data ownership
- this fifth slice should move summary onto those tighter contracts
```
