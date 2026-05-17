# Fourteenth Slice Prompt

Use this prompt for the next implementation slice after the settings hardening
slice and the smoke stabilization pass are in place.

This slice is intentionally focused:

- cross-slice infrastructure cleanup
- narrowing shared query invalidation helpers
- thinning app-shell orchestration
- reducing broad bridge behavior in shared client infrastructure
- preserving exact freshness and workflow continuity while removing remaining
  broad coordination paths

It is not a rewrite of imports, entries, months, summary, splits, or settings.
It is also not an excuse to broaden `App.jsx` or `app-sync` again.

## Explicit Non-Goals

- no new global event bus
- no new app-wide refresh abstraction
- no query cache orchestration registry
- no centralized workflow persistence layer
- no route shadow state
- no sync abstraction that spans unrelated slices
- no new broad shell refresh path
- no silent behavior change to accounting, reconciliation, or import semantics

## Cross-Slice Infrastructure Guardrail

Some shared infrastructure may still exist because multiple slices depend on it.
Before keeping or expanding a shared bridge path, prove:

- the path is genuinely cross-slice, not just convenient
- narrower slice-owned helpers are insufficient
- the behavior is named in the relevant slice prompt or audit
- the behavior is test-backed
- the shared path has a clear exit condition if temporary
- the change can be described as a concrete contract, not only as an
  architectural preference

## Clarify This Is Infrastructure Cleanup

This slice assumes the earlier slice-owned query boundaries already exist.

Do not rebuild the app shell, query client, or sync infrastructure from
scratch unless an existing regression test proves the current behavior is
broken.

When hardening or refactoring this slice, ensure existing regression tests are
present first so behavior can be checked continuously.

Focus on:

- thin app-shell orchestration
- narrow shared query helpers
- slice-owned invalidation boundaries
- cross-tab freshness without broad app refresh
- removing remaining infrastructure-specific legacy paths

## Do Not Reinterpret Product Semantics

Do not change accounting, reconciliation, transfer, or import semantics during
this slice.

The goal is infrastructure ownership and query shape, not changing what the
product means.

If a semantics rule appears wrong, first add a regression test proving the
current behavior is broken before changing it.

## Infrastructure Legacy Path Inventory

Before closing this slice, confirm there are no remaining competing
cross-slice infrastructure paths beyond the intentionally retained shared
helpers required by the slice:

- broad invalidation logic still living in shared mutation helpers
- direct shell refresh from slice code where exact invalidation is enough
- route/page orchestration that still owns business decisions instead of thin
  coordination
- shared sync helpers that still expose more than the slice needs
- bridge paths that keep the old broad behavior alive after the slice-owned
  replacement is verified

## Infrastructure Freshness Matrix

Add tests for:

- query ownership:
  - route params map to the correct query keys
  - slice-owned query boundaries remain narrow and deterministic
- invalidation:
  - entry, month, summary, imports, splits, and settings mutations refresh only
    the affected query families
  - cross-tab mutation refreshes the correct queries without broad app refresh
  - stale refreshes do not overwrite newer state
- shell and sync behavior:
  - route changes do not trigger destructive refresh replacement
  - active editing preserves state across invalidation and background refreshes
  - same-tab return behavior remains settled but non-destructive
  - cross-tab freshness remains exact and scoped
- mobile and visibility behavior:
  - mobile open/close transitions do not invalidate server data
  - filter-only changes do not invalidate server data
  - route-only changes remain query-shape changes, not data-reset changes

Before closing, map each freshness-matrix case to a test or mark it not
applicable with a reason.

## Closure Checks

Before this slice can close, all of the following must be true:

- `App.jsx` does not gain new long-lived server-state ownership beyond the
  existing route and shell composition responsibilities.
- no shared invalidation helper invalidates more query families than the
  relevant slice contract requires.
- no mutation path introduces a full-shell refresh when exact invalidation is
  sufficient.
- no helper mutates workflow state directly from shared infrastructure.
- any bridge path kept temporarily has a documented exit condition and at
  least one regression test proving the temporary path is still necessary.
- tests verify observable freshness and continuity behavior, not just internal
  query topology.

Constraints:

- keep code within docs/code-spec.md limits
- preserve docs/existing-behavior-guardrails.md
- keep the slice narrow and do not refactor unrelated slices
- update or add tests before moving implementation logic
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen invalidation beyond the documented contract
- do not broaden app-shell or sync responsibilities to solve slice problems
- do not let workflow snapshots become competing route state
- do not let workflow snapshots become hidden app-shell state
- do not let route refreshes become workflow resets
- keep shared infrastructure small and explicit, not monolithic
- commit in small readable batches as the slice progresses
- finish with a closure audit before considering the slice complete
- prefer concrete contracts over architectural adjectives when describing
  success

Implementation rules:

- preserve explicit state ownership between:
  - browser route state
  - query-backed server state
  - workflow state
  - transient UI state
- keep browser location as the source of truth for route state
- keep TanStack Query as the source of truth for server-backed state
- keep app shell as global composition only
- keep shared route DTO ownership narrow and route-owned
- preserve active state while invalidation and background refresh logic decide
  whether a rerun is safe
- preserve workflow state across invalidation, background refreshes, route
  transitions, and query replacement
- keep same-tab return behavior settled but non-destructive
- keep cross-tab freshness exact and scoped to the affected page data
- move return-flow decisions into slice helpers where the code proves the
  current assumptions wrong

Deliverables:

- tests for query ownership, invalidation, and cross-tab freshness
- code changes that move shared infrastructure decisions behind narrower slice
  boundaries
- doc updates only if an infrastructure assumption proved wrong

## Why This Prompt

- It keeps the next unresolved high-value slice focused on infrastructure
  cleanup rather than reopening product semantics.
- It names the remaining cross-slice risks explicitly.
- It keeps shared infrastructure from drifting back into broad refresh behavior.
- It gives the next implementer a concrete closure target with the same
  incremental test-first pattern as the earlier slices.
