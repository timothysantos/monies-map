# Twelfth Slice Prompt

Use this prompt for the next implementation slice after the summary hardening
slice is in place.

This slice is intentionally focused:

- splits page query boundary hardening
- split draft and optimistic-refresh protection
- split activity and settlement continuity
- split create/edit/delete invalidation
- split review-matches freshness
- exact downstream freshness when split changes affect entries, month, or
  summary views
- continuity
- exact freshness
- stale-refresh protection
- review-match hardening
- remaining legacy cleanup

It is not a rewrite of imports, settings, entries, months, or summary. It is
also not an excuse to broaden App.jsx or app-sync again.

## Clarify This Is Splits Hardening

This slice assumes the earlier splits query split already exists.

Do not rebuild `splitsPage` or `splitsBreakdown` from scratch unless the
existing implementation fails a regression test.

When hardening or refactoring this slice, ensure existing regression tests are
present first so behavior can be checked continuously.

Focus on:
- workflow continuity
- draft state
- settlement and review-matches freshness
- stale-refresh protection
- removing remaining splits-specific legacy paths

## Splits Must Not Become A Refresh Coordinator

Do not reinterpret split matching, shared-expense settlement, linked-entry
promotion, or split allocation semantics during this slice.

The goal is workflow ownership and freshness, not changing split math or
matching behavior.

If a split number or link behavior appears wrong, first add a regression test
proving the current behavior is broken before changing semantics.

## Splits Legacy Path Inventory

Before closing this slice, confirm there are no remaining competing splits
save/refresh paths beyond the intentionally retained splits refresh behavior
required by the slice:

- old split-save refresh calls
- old match-review refresh calls
- duplicate split refresh-plan helpers
- direct shell refresh from split code
- splits-specific invalidation decisions inside `App.jsx`

## Splits Freshness Matrix

Add tests for:

- split create refreshes splits + affected month + summary
- split edit that changes allocation or linked entry refreshes splits + month +
  summary
- split edit that only changes note/details refreshes splits only unless
  summary/month visibly depends on it
- settlement refreshes splits + month + summary without changing settlement
  semantics
- match review refreshes splits + entries only when visible ledger evidence
  changes
- filter-only changes do not invalidate server data
- mobile-sheet open/close changes do not invalidate server data

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
- do not broaden app-shell or app-sync responsibilities to solve splits
  problems
- do not redesign split matching or settlement rules
- do not let workflow snapshots become competing route state
- do not let workflow snapshots become hidden app-shell state
- do not let route refreshes become workflow resets
- keep splits as a deep workflow module with explicit refresh rules, not a
  monolith
- commit in small readable batches as the slice progresses
- finish with a closure audit before considering the slice complete

Implementation rules:
- preserve explicit state ownership between:
  - browser route state
  - query-backed server state
  - splits workflow state
  - transient UI state
- keep browser location as the source of truth for route state
- keep TanStack Query as the source of truth for server-backed state
- keep app shell as global metadata only
- keep route DTO ownership route-owned
- keep splits page lightweight: current route range, draft state, and
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
- tests for splits workflow continuity, return freshness, and cross-page
  effects
- code changes that move splits-specific decisions behind the slice boundary
- doc updates only if a splits assumption proved wrong

## Why This Prompt

- It keeps the next unresolved high-value slice focused on splits rather than
  reopening month or entries work.
- It names the remaining splits workflow risks explicitly.
- It keeps splits from drifting back into shell-owned refresh behavior.
- It gives the next implementer a concrete closure target with the same
  incremental test-first pattern as the earlier slices.
