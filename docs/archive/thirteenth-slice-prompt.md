# Thirteenth Slice Prompt

Use this prompt for the next implementation slice after the splits hardening
slice is in place.

This slice is intentionally focused:

- settings page query boundary hardening
- settings CRUD and reconciliation invalidation
- account, category, person, and rule propagation
- settings-driven downstream freshness for imports, entries, month, summary,
  and splits where relevant
- settings workflow continuity
- exact freshness
- stale-refresh protection
- remaining settings-specific legacy cleanup

It is not a rewrite of imports, entries, months, summary, or splits. It is
also not an excuse to broaden App.jsx or app-sync again.

## Settings Shell Refresh Exception Guardrail

Settings is one of the few places where shell refresh may still be justified
because account, category, and person metadata can be global.

Before adding or keeping `refreshShell: true`, prove:

- the setting change updates global metadata used outside the settings page
- exact query invalidation is insufficient
- the shell refresh path is named in `settings-refresh-plan`
- the behavior is test-backed
- the exception is documented with an exit condition if temporary

## Clarify This Is Settings Hardening

This slice assumes the earlier settings query boundary already exists.

Do not rebuild `settingsPage` from scratch unless the existing implementation
fails a regression test.

When hardening or refactoring this slice, ensure existing regression tests are
present first so behavior can be checked continuously.

Focus on:
- workflow continuity
- settings CRUD
- reconciliation and reference-data freshness
- stale-refresh protection
- removing remaining settings-specific legacy paths

## Settings Must Not Become A Refresh Coordinator

Do not reinterpret account ownership, category rules, reconciliation
exceptions, or person naming semantics during this slice.

The goal is workflow ownership and freshness, not changing settings meaning.

If a settings rule appears wrong, first add a regression test proving the
current behavior is broken before changing semantics.

## Settings Legacy Path Inventory

Before closing this slice, confirm there are no remaining competing settings
save/refresh paths beyond the intentionally retained settings refresh behavior
required by the slice:

- old settings-save refresh calls
- duplicate settings refresh-plan helpers
- direct shell refresh from settings code
- settings-specific invalidation decisions inside `App.jsx`
- legacy bridge paths that still let settings own downstream freshness from
  multiple places

## Settings Freshness Matrix

Add tests for:

- reference-data changes:
  - account create/edit/archive refreshes settings + downstream imports/entries
    and only the affected query families
  - category create/edit/archive refreshes settings + affected downstream
    entries/imports/month/summary queries
  - person create/edit/archive refreshes settings + affected downstream query
    families
  - category rules refreshes only the affected downstream query families
- account create/edit/archive refreshes settings + downstream imports/entries
- workflow/reconciliation changes:
  - reconciliation exception changes refresh only the visible ledger evidence
    they actually affect
  - statement-review changes refresh only the visible ledger evidence they
    actually affect
  - settings form draft changes do not invalidate server data
  - filter-only changes do not invalidate server data
  - mobile-sheet open/close changes do not invalidate server data
  - cross-tab settings mutation refreshes correct queries without broad app
    refresh

Before closing, map each freshness-matrix case to a test or mark it not
applicable with a reason.

Constraints:
- keep code within docs/code-spec.md limits
- preserve docs/existing-behavior-guardrails.md
- keep the slice narrow and do not refactor unrelated slices
- update or add tests before moving implementation logic
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen invalidation beyond the documented contract
- do not broaden app-shell or app-sync responsibilities to solve settings
  problems
- do not reinterpret settings semantics
- do not let workflow snapshots become competing route state
- do not let workflow snapshots become hidden app-shell state
- do not let route refreshes become workflow resets
- keep settings as a deep workflow module with explicit refresh rules, not a
  monolith
- commit in small readable batches as the slice progresses
- finish with a closure audit before considering the slice complete

Implementation rules:
- preserve explicit state ownership between:
  - browser route state
  - query-backed server state
  - settings workflow state
  - transient UI state
- keep browser location as the source of truth for route state
- keep TanStack Query as the source of truth for server-backed state
- keep app shell as global metadata only
- keep route DTO ownership route-owned
- keep settings page lightweight: current section, draft state, and
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
- tests for settings workflow continuity, return freshness, and cross-page
  effects
- code changes that move settings-specific decisions behind the slice boundary
- doc updates only if a settings assumption proved wrong

## Why This Prompt

- It keeps the next unresolved high-value slice focused on settings rather
  than reopening month, entries, or splits work.
- It names the remaining settings workflow risks explicitly.
- It keeps settings from drifting back into shell-owned refresh behavior.
- It gives the next implementer a concrete closure target with the same
  incremental test-first pattern as the earlier slices.
