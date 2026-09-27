# Tenth Slice Prompt

Use this prompt for the next implementation slice after the entries workflow
boundary slice is in place.

This slice is intentionally focused:

- month workspace boundary hardening
- month page query ownership and helper cleanup
- month metrics, notes, and plan-link continuity
- inline row editing and save freshness
- month handoff behavior that depends on entry and split state
- exact downstream freshness when month changes affect visible ledger data

It is not a rewrite of summary, imports, settings, entries, or splits. It is
also not an excuse to broaden App.jsx or app-sync again.

```text
Implement the month workspace boundary slice.

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
- month page query boundary
- month deep workflow module
- month metrics and note continuity
- month plan-row editing and save orchestration
- month plan-link candidate continuity
- month handoff behavior that depends on entries state
- split-linked month freshness after entry and split changes

Target scenarios:
- M1 Review one month by view and scope
- M2 Change month scope without losing the month workspace
- M3 Edit a month note and keep the row state settled
- M4 Save a plan row without stale refresh replacement
- M5 Link plan rows without breaking month continuity
- M6 Drill from month to entries and return with fresh month data
- M7 Mobile month sheet survives background refreshes and route returns
- X4a Same-tab month return uses settled fresh data, not destructive reload
- X4b Cross-tab month return does not clobber active mobile workflows
- X6 Month to Entries changes both views
- X7 Entry or split changes settle back into month metrics

Target coupling rows:
- src/client/month-panel.jsx return-flow freshness and inline-edit coupling
- src/client/month-overview.jsx month metric and note coupling
- src/client/month-plan-tables.jsx plan-row save coupling
- src/client/month-row-editing.js row draft and commit coupling
- src/client/month-helpers.js month workspace helper coupling
- src/client/entry-mobile-sheet.jsx mobile continuity coupling
- src/client/query-mutations.js narrow invalidation coupling
- src/client/app-sync.js cross-tab freshness and workflow-lock coupling
- src/client/entries-panel.jsx month handoff freshness coupling

Target query contract:
- monthPage
- entriesPage
- summaryPage
- splitsPage
- invalidate only the exact slice keys named in docs/query-map.md
- keep month query keys stable across filters and route returns
- invalidate month, entries, and summary only when month changes actually
  affect those views
- keep plan-link and plan-row continuity under the month workflow rather than
  pushing it into the shell
- keep the mobile month sheet and inline edit flows protected from background
  refreshes
- do not use generic route fallback behavior for month once the dedicated
  month key exists

Legacy month paths inventory:
- file
- current caller
- replacement path
- test proving replacement
- safe to remove now? yes/no

Current retained exceptions:
- `routePage` fallback remains only for unsupported surfaces without a
  dedicated month query key
- named `refreshShell: true` exceptions remain only where a current workflow
  still requires shell-level metadata refresh

## Month State / Semantics Guardrail

Do not reinterpret month metrics, plan row meaning, note semantics, or
split-linked month behavior during this slice.

The goal is workflow ownership and freshness, not accounting behavior changes.

If a month save/link behavior appears wrong, first add a regression test
proving the current behavior is broken before changing semantics.

## Month Plan Semantics Guardrail

Do not reinterpret planned budget item meaning, linked-ledger matching,
shared-expense allocation, or planned-vs-actual calculations during this
slice.

The goal is month workflow ownership and freshness, not changing how
budget/planning math works.

If planned-vs-actual behavior appears wrong, first add a regression test
proving the current behavior is broken before changing semantics.

## Month Must Not Become A Cross-Page Coordinator

Month may consume entries/splits/summary freshness signals, but it must not
become the owner of entries, splits, or summary invalidation policy.

Entry-owned changes should stay entry-owned.
Split-owned changes should stay split-owned.
Summary-owned changes should stay summary-owned.
Month should only own month workspace decisions and month-visible freshness.

## Month Freshness Matrix

Add tests for:

- month note save refreshes month + summary and preserves the workspace
- plan-row edit refreshes month + summary and keeps the active row stable
- plan-link save refreshes month + entries + summary only when visible ledger
  evidence changes
- month-to-entries drilldown and return uses settled fresh data
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
- do not broaden app-shell or app-sync responsibilities to solve month
  problems
- do not redesign accounting semantics, plan semantics, or budgeting rules
- do not let workflow snapshots become competing route state
- do not let workflow snapshots become hidden app-shell state
- do not let route refreshes become workflow resets
- keep month as a deep workflow module with explicit refresh rules, not a
  monolith
- commit in small readable batches as the slice progresses
- finish with a closure audit before considering the slice complete

Implementation rules:
- preserve explicit state ownership between:
  - browser route state
  - query-backed server state
  - month workflow state
  - transient UI state
- keep browser location as the source of truth for route state
- keep TanStack Query as the source of truth for server-backed state
- keep app shell as global metadata only
- keep route DTO ownership route-owned
- keep month page lightweight: current route month, plan rows, note state,
  and workflow-specific action state only
- preserve active draft state while invalidation and background refresh logic
  decide whether a rerun is safe
- preserve workflow state across invalidation, background refreshes, route
  transitions, and query replacement
- keep same-tab return behavior settled but non-destructive
- keep cross-tab freshness exact and scoped to the affected page data
- move return-flow decisions into slice helpers where the code proves the
  current assumptions wrong

Deliverables:
- tests for month workflow continuity, return freshness, and cross-page
  effects
- code changes that move month-specific decisions behind the slice boundary
- doc updates only if a month assumption proved wrong
```

## Why This Prompt

- It keeps the next unresolved high-value slice focused on month rather than
  reopening entries work.
- It names the remaining month workspace risks explicitly.
- It keeps month from drifting back into shell-owned refresh behavior.
- It gives the next implementer a concrete closure target with the same
  incremental test-first pattern as the earlier slices.
