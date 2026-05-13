# Eleventh Slice Prompt

Use this prompt for the next implementation slice after the month workspace
boundary slice is in place.

This slice is intentionally focused:

- summary query boundary hardening
- summary page ownership and helper cleanup
- summary focus, metrics, and account-pill continuity
- summary note save and drilldown freshness
- same-tab and cross-tab summary return behavior
- exact downstream freshness when summary changes affect visible ledger data

It is not a rewrite of imports, settings, entries, months, or splits. It is
also not an excuse to broaden App.jsx or app-sync again.

## Clarify This Is Summary Hardening

This slice assumes the earlier summary query split already exists.

Do not rebuild `summaryPage` or `summaryAccountPills` from scratch unless the
existing implementation fails a regression test.

Focus on:
- workflow continuity
- focus state
- drilldown/return freshness
- note-save orchestration
- stale-refresh protection
- removing remaining summary-specific legacy paths

## Summary Must Not Become A Reporting Engine Rewrite

Do not reinterpret savings target, realized savings, category share, account
pill, month range, or reporting calculations during this slice.

If a summary number looks wrong, first add a regression test proving the
current behavior is wrong before changing calculation semantics.

```text
Implement the summary slice.

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
- summary page query boundary
- summary deep workflow module
- summary focus and metric continuity
- summary note save orchestration
- summary account-pill continuity
- summary drilldown route helpers
- summary return freshness after month and entries drilldowns

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

Target coupling rows:
- src/client/summary-panel.jsx focus, note, and drill-down coupling
- src/client/summary-query.js summary range and pills coupling
- src/client/summary-overview.jsx summary metric and pill coupling
- src/client/spending-mix-recharts.jsx chart state coupling
- src/client/query-mutations.js narrow invalidation coupling
- src/client/app-sync.js cross-tab freshness and workflow-lock coupling
- src/client/month-panel.jsx summary handoff freshness coupling
- src/client/entries-panel.jsx summary return freshness coupling

Target query contract:
- summaryPage
- summaryAccountPills
- monthPage
- entriesPage
- invalidate only the exact slice keys named in docs/query-map.md
- keep summary query keys stable across focus changes and route returns
- invalidate summary, month, and entries only when summary changes actually
  affect those views
- keep category-card and account-pill continuity under the summary workflow
  rather than pushing it into the shell
- keep summary focus state and drilldown flows protected from background
  refreshes
- do not use generic route fallback behavior for summary once the dedicated
  summary key exists

## Summary Semantics Guardrail

Do not reinterpret savings target meaning, realized savings meaning, category
share meaning, account-pill meaning, or summary range calculations during this
slice.

The goal is workflow ownership and freshness, not changing how summary math
works.

If a summary metric or drilldown behavior appears wrong, first add a regression
test proving the current behavior is broken before changing semantics.

## Summary Freshness Matrix

Add tests for:

- summary note save refreshes summary + affected month and preserves the
  workspace
- category-share or account-pill drilldown refreshes summary + entries only
  when visible ledger evidence changes
- month return from summary uses settled fresh data
- entry return from summary uses settled fresh data
- filter-only changes do not invalidate server data
- mobile-sheet open/close changes do not invalidate server data

Constraints:
- keep code within docs/code-spec.md limits
- preserve docs/existing-behavior-guardrails.md
- keep the slice narrow and do not refactor unrelated slices
- update or add tests before moving implementation logic
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen invalidation beyond the documented contract
- do not broaden app-shell or app-sync responsibilities to solve summary
  problems
- do not redesign savings, planning, or reporting rules
- do not let workflow snapshots become competing route state
- do not let workflow snapshots become hidden app-shell state
- do not let route refreshes become workflow resets
- keep summary as a deep workflow module with explicit refresh rules, not a
  monolith
- commit in small readable batches as the slice progresses
- finish with a closure audit before considering the slice complete

Implementation rules:
- preserve explicit state ownership between:
  - browser route state
  - query-backed server state
  - summary workflow state
  - transient UI state
- keep browser location as the source of truth for route state
- keep TanStack Query as the source of truth for server-backed state
- keep app shell as global metadata only
- keep route DTO ownership route-owned
- keep summary page lightweight: current route range, focus state, pills, and
  workflow-specific action state only
- preserve active state while invalidation and background refresh logic decide
  whether a rerun is safe
- preserve workflow state across invalidation, background refreshes, route
  transitions, and query replacement
- keep same-tab return behavior settled but non-destructive
- keep cross-tab freshness exact and scoped to the affected page data
- move return-flow decisions into slice helpers where the code proves the
  current assumptions wrong

Deliverables:
- tests for summary workflow continuity, return freshness, and cross-page
  effects
- code changes that move summary-specific decisions behind the slice boundary
- doc updates only if a summary assumption proved wrong
```

## Why This Prompt

- It keeps the next unresolved high-value slice focused on summary rather than
  reopening month or entries work.
- It names the remaining summary workspace risks explicitly.
- It keeps summary from drifting back into shell-owned refresh behavior.
- It gives the next implementer a concrete closure target with the same
  incremental test-first pattern as the earlier slices.
