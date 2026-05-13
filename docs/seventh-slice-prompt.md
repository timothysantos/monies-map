# Seventh Slice Prompt

Use this prompt for the next implementation slice after the splits query and
workflow slice is in place.

This slice is intentionally focused:

- same-tab and cross-tab freshness after drilldowns
- workflow-lock protection for active mobile editors and quick-entry flows
- entries, month, summary, splits, and settings handoff boundaries
- exact invalidation behavior for cross-page return flows
- app-shell coordination only where the shell is still the routing bridge
- explicit coverage for the remaining cross-page scenario set

It is not a broad rewrite of entries, month, summary, splits, or settings. It
is also not a redesign of the app shell or cross-tab infrastructure.

```text
Implement the cross-page freshness and workflow-lock coordination slice.

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
- docs/route-data-code-flow.md
- docs/responsive-behavior.md if the work touches mobile/desktop behavior
- docs/interaction-guidelines.md if the workflow touches buttons, dismissals,
  staged controls, or dialog flow

Target slice:
- cross-page freshness and return behavior
- workflow-lock protection for mobile edit surfaces
- same-tab return and cross-tab return coordination
- app-shell bridge behavior only where route selection still depends on it
- downstream invalidation for entries, month, summary, splits, and settings
  return flows

Target scenarios:
- X5a Same-tab return uses settled fresh data, not destructive reload
- X5b Cross-tab return does not clobber active mobile workflows
- X6 Entries to Splits changes both views
- X7 Split match changes Entries
- X8 Settings reference-data change affects later workflows

Target coupling rows:
- src/client/App.jsx shell-level route return and cross-tab restore coupling
- src/client/app-sync.js cross-tab freshness and workflow-lock coupling
- src/client/query-mutations.js narrow invalidation coupling
- src/client/entry-mobile-sheet.jsx active mobile workflow protection coupling
- src/client/entries-panel.jsx return-flow freshness and linked-entry coupling
- src/client/summary-panel.jsx same-tab return freshness coupling
- src/client/month-panel.jsx same-tab return freshness coupling
- src/client/splits-panel.jsx linked-entry return flow coupling
- src/client/settings-panel.jsx reference-data refresh coupling

Target query contract:
- invalidate the exact slice keys needed by the originating mutation
- keep same-tab return fresh without destructive reload
- keep cross-tab refresh subordinate to any active workflow lock
- preserve active mobile draft, sheet, or editor state during background
  refreshes
- refresh the affected page data exactly when a save changes visible state
- do not broaden app-shell invalidation beyond the documented bridge behavior
- do not turn app-sync into a hidden workflow owner

Constraints:
- keep code within docs/code-spec.md limits
- preserve docs/existing-behavior-guardrails.md
- keep the slice narrow and do not refactor unrelated slices
- update or add tests before moving implementation logic
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen invalidation beyond the documented contract
- do not redesign accounting semantics, transfer semantics, or budgeting rules
- do not let mobile workflow protection become a global reload gate
- do not broaden app-sync ownership during this slice
- keep the shell bridge narrow and explicit
- remove the old path in the same slice once the new behavior is verified and
  covered by tests
- commit in small readable batches as the slice progresses
- finish with a cross-page closure audit before considering the slice complete

Implementation rules:
- preserve explicit state ownership between:
  - browser route state
  - query-backed server state
  - active workflow state
  - transient UI state
- keep browser location as the source of truth for route state
- keep TanStack Query as the source of truth for server-backed state
- keep workflow state alive across invalidation, focus events, and same-tab
  returns when the UI contract requires continuity
- keep workflow locks explicit and named so background refresh can be deferred
  instead of clobbering active editors
- preserve optimistic or in-progress state against older refresh replacements
- keep same-tab return behavior settled but non-destructive
- keep cross-tab freshness exact and scoped to the affected page data
- move return-flow decisions into slice helpers where the code proves the
  current assumptions wrong

Deliverables:
- tests for X5a, X5b, X6, X7, and X8
- tests for:
  - same-tab return that stays fresh without jarring reload behavior
  - cross-tab return that marks stale but does not clobber active workflows
  - entries to splits that refresh both views exactly
  - split match that refreshes the linked entry state exactly
  - settings reference-data changes that flow into later workflows
- explicit invalidation updates only where the cross-page contract demands them
- docs updates only if a documented cross-page assumption proves wrong
```

## Ownership Model

Use these definitions during the slice so state does not drift across layers.

### Route state

Derived from browser location.

Examples:

- active page
- active view or month
- return targets after drilldown

The browser URL remains the source of truth.

### Server state

Query-backed server data managed by TanStack Query.

Examples:

- page data for entries, month, summary, splits, and settings
- cross-page aggregates
- linked-entry metadata

TanStack Query remains the source of truth.

### Workflow state

Long-lived user interaction continuity.

Examples:

- active mobile edit sheet
- active quick-entry draft
- return focus after drilldown
- pending cross-page refresh acknowledgment

Workflow state must survive invalidation and background refreshes when the
workflow contract requires it.

### UI state

Purely local or transient rendering state.

Examples:

- hover state
- modal visibility
- expanded rows
- focused input

UI state must never become authoritative business state.

## Core Architectural Win

The measurable payoff for this slice is not just “navigation feels better.”

The win is:

- same-tab drilldown return stays fresh without destructive reloads
- cross-tab refresh stays subordinate to active mobile workflows
- entries, month, summary, splits, and settings coordinate through exact
  invalidation instead of broad shell behavior
- `app-sync` remains infrastructure instead of becoming a hidden workflow
  owner

## Why This Prompt

- It follows the same level of specificity as the imports, settings, summary,
  and splits slice prompts.
- It names the remaining cross-page scenarios instead of saying “fix stale
  navigation.”
- It keeps the slice focused on freshness, workflow locks, and exact
  invalidation.
- It keeps the app shell and cross-tab bridge from turning into a hidden
  global refresh service.
- It captures the lesson from earlier slices that same-tab and cross-tab
  behavior must stay explicit, named, and test-backed.
