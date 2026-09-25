# Second Slice Prompt

Use this prompt for the next implementation slice after the app shell and
query foundation are in place.

This slice is intentionally focused:

- route transition behavior
- route affordance behavior
- parallel shell/page fetching where safe
- visible-screen continuity during navigation
- DDD boundary tightening for the app shell / page orchestration layer
- documentation updates that explain the new flow

It is not a broad refactor of every screen.

```text
Implement the route-transition and domain-boundary slice.

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
- docs/tanstack-query-language.md
- docs/app-shell-flow.md
- docs/existing-behavior-guardrails.md
- docs/responsive-behavior.md if the workflow touches mobile/desktop behavior
- docs/interaction-guidelines.md if the workflow touches buttons, dismissals,
  or staged controls

Target slice:
- route transition, page hydration, route affordance, and DDD boundary tightening
- retain the last settled screen only as a hydration fallback, not as a second
  source of truth for route selection

Target scenarios:
- S7 Summary reflects month edits when returning from a drilldown
- S8 Summary reflects entry edits when returning from a drilldown
- S9 Summary tab refreshes after related changes in another tab
- X5a Same-tab return uses settled fresh data, not destructive reload
- X5b Cross-tab return does not clobber active mobile workflows
- M1 Review one month by view and scope
- E1 Entries page stays stable while a new route page is fetched

Target coupling rows:
- src/client/App.jsx app-shell coupling
- src/client/App.jsx route transition and loading-state coupling
- src/client/query-mutations.js broad invalidation
- src/client/monies-client-service.js helper facade boundaries
- mobile sheets versus desktop editors
- app-shell dependencies that still leak across slice boundaries

Target query contract:
- appShell
- routePage
- summaryPage
- monthPage
- entriesPage
- splitsPage
- importsPage
- settingsPage
- invalidate only the exact slice keys named in docs/query-map.md
- keep the previous screen visible while a safe route-page request is in flight
- allow shell and route-page fetches to start together when the route-page does
  not need shell data to begin safely
- keep the route affordance inside the routed region, not as a full-app blank
  state

Constraints:
- keep code within docs/code-spec.md limits
- preserve docs/existing-behavior-guardrails.md
- keep the slice narrow and do not refactor unrelated slices
- update or add tests before moving implementation logic
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen app-shell dependence
- do not widen invalidation beyond the documented contract
- keep mobile workflow locks intact
- keep the previous screen visible when route hydration is pending, unless auth
  or session state is actually broken
- never blank the whole app just because a new route-page request is still
  loading
- prefer small route-page loading affordances over global loading screens
- commit in small readable batches as the slice progresses
- keep code comments above every important block, hook, branch, and helper in
  any refactored file
- update or create markdown flow docs for the new fetch/render sequence
- keep the files split so no new handwritten module grows into a long monolith

Implementation rules:
- if the new route can safely start its page request before the shell is ready,
  start both requests together
- if the route-page request needs shell-derived inputs, derive only those inputs
  first and keep the rest of the page request independent
- preserve the current screen until the next route page is ready enough to
  replace it
- use a small loading state only for the region that is still pending
- define the route affordance as the small pending region-state, not the whole
  page shell
- reuse the persisted app-shell cache when possible
- treat full blank-state rendering as an auth/session failure state, not a
  normal navigation state
- split route hydration from visible-page replacement so stale data cannot
  clobber an active screen
- keep the retained settled screen in a ref-backed hydration fallback, while
  TanStack and the browser location remain the route source of truth
- keep query invalidation exact and route-scoped
- move DDD boundary decisions into docs if the code proves the existing
  boundary assumptions wrong

Deliverables:
- tests for the target scenarios and coupling rows
- route-transition code changes only for this slice
- DDD boundary updates in docs and small helper splits where needed
- markdown flow docs describing the route/shell/page sequence
- doc updates only if a documented assumption proves wrong
```

## Why This Prompt

- It is the next slice, not a continuation of the first slice prompt.
- It names the route-transition contract explicitly.
- It tells the model to keep the previous screen visible while route data
  resolves.
- It keeps the work small enough for a focused implementation pass.
- It gives the DDD boundary pass a concrete scope instead of turning it into a
  vague rewrite.

## How This Relates To The First Slice

The first slice established the shell and query foundation.

This second slice builds on that foundation by changing how route navigation is
hydrated and by tightening the boundary between:

- shell metadata
- route-page data
- visible page state
- domain logic
- client orchestration

In other words:

- the first slice built the query plumbing
- the second slice changes how the app uses that plumbing during navigation
- later slices can then move deeper into slice-owned domain and UI modules
