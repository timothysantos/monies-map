# Ninth Slice Prompt

Use this prompt for the next implementation slice after the app-shell
retirement and legacy-bridge cleanup slice is in place.

This slice is intentionally focused:

- entries workflow boundary hardening
- entries page query ownership and helper cleanup
- quick-entry, edit, filter, and add-to-splits continuity
- return-flow freshness after drilldowns back into entries
- remaining month handoff behavior that depends on entries state
- explicit invalidation for entries-driven cross-page updates

It is not a rewrite of summary, imports, settings, or splits. It is also not
an excuse to broaden App.jsx or app-sync again.

```text
Implement the entries workflow boundary slice.

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
- entries page query boundary
- entries deep workflow module
- quick-entry draft continuity
- entry edit and filter stability
- add-to-splits orchestration
- transfer-linking and linked-entry return flow
- month handoff behavior that still depends on entries state

Target scenarios:
- E1 Entries page stays stable while a new route page is fetched
- E2 Create a quick entry without losing draft state
- E3 Edit an entry without select-all dependence
- E4 Filter and recategorize entries without losing the active view
- E5 Add an entry to splits and return to entries with settled freshness
- E6 Link or settle a transfer from entries and preserve linked state
- E7 Mobile entry sheet survives background refreshes and route returns
- X5a Same-tab return uses settled fresh data, not destructive reload
- X5b Cross-tab return does not clobber active mobile workflows
- X6 Entries to Splits changes both views
- X7 Split match changes Entries

Target coupling rows:
- src/client/entries-panel.jsx return-flow freshness and linked-entry coupling
- src/client/entry-actions.js draft/edit/save orchestration coupling
- src/client/entry-mobile-sheet.jsx mobile continuity coupling
- src/client/entry-editor.jsx amount typing contract coupling
- src/client/query-mutations.js narrow invalidation coupling
- src/client/app-sync.js cross-tab freshness and workflow-lock coupling
- src/client/month-panel.jsx handoff freshness coupling

Target query contract:
- entriesPage
- monthPage
- summaryPage
- splitsPage
- invalidate only the exact slice keys named in docs/query-map.md
- keep entries query keys stable across filters and route returns
- invalidate entries, month, and summary only when entry changes actually
  affect those views
- keep add-to-splits and transfer-linking continuity under the entries
  workflow rather than pushing it into the shell
- keep the mobile entry sheet and quick-entry flows protected from background
  refreshes
- do not use generic route fallback behavior for entries once the dedicated
  entries key exists

Constraints:
- keep code within docs/code-spec.md limits
- preserve docs/existing-behavior-guardrails.md
- keep the slice narrow and do not refactor unrelated slices
- update or add tests before moving implementation logic
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen invalidation beyond the documented contract
- do not broaden app-shell or app-sync responsibilities to solve entries
  problems
- do not redesign accounting semantics, transfer semantics, or budgeting rules
- do not let workflow snapshots become competing route state
- do not let workflow snapshots become hidden app-shell state
- do not let route refreshes become workflow resets
- keep entries as a deep workflow module with explicit refresh rules, not a
  monolith
- commit in small readable batches as the slice progresses
- finish with a closure audit before considering the slice complete

Implementation rules:
- preserve explicit state ownership between:
  - browser route state
  - query-backed server state
  - entries workflow state
  - transient UI state
- keep browser location as the source of truth for route state
- keep TanStack Query as the source of truth for server-backed state
- keep app shell as global metadata only
- keep route DTO ownership route-owned
- keep entries page lightweight: current route month, filtered rows, linked
  entry metadata, and workflow-specific action state only
- preserve active draft state while invalidation and background refresh logic
  decide whether a rerun is safe
- preserve workflow state across invalidation, background refreshes, route
  transitions, and query replacement
- keep same-tab return behavior settled but non-destructive
- keep cross-tab freshness exact and scoped to the affected page data
- move return-flow decisions into slice helpers where the code proves the
  current assumptions wrong

Deliverables:
- tests for entries workflow continuity, return freshness, and cross-page
  effects
- code changes that move entries-specific decisions behind the slice boundary
- doc updates only if an entries assumption proved wrong
```

## Why This Prompt

- It follows the same level of specificity as the earlier slice prompts.
- It keeps the next unresolved high-value slice focused on entries rather than
  reopening shell cleanup.
- It names the remaining workflow continuity risks explicitly.
- It keeps entries from drifting back into shell-owned refresh behavior.
- It gives the next implementer a concrete closure target with the same
  incremental test-first pattern as the earlier slices.
