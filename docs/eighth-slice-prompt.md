# Eighth Slice Prompt

Use this prompt for the next implementation slice after the cross-page
freshness and workflow-lock coordination slice is in place.

This slice is intentionally focused:

- app-shell retirement and legacy bridge cleanup
- removal of compatibility fallbacks that survived earlier slice cutovers
- shell-only route coordination that no longer acts like a hidden bootstrap
  payload
- exact cleanup of old route-page and refresh plumbing where the new slice
  owners already exist
- documentation and test coverage for the final shell-bridge assumptions

It is not a redesign of entries, month, summary, splits, settings, or imports.
It is also not an excuse to broaden App.jsx back into a domain coordinator.

```text
Implement the app-shell retirement and legacy-bridge cleanup slice.

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
- docs/app-shell-flow.md
- docs/tanstack-query-language.md
- docs/responsive-behavior.md if the work touches mobile/desktop behavior
- docs/interaction-guidelines.md if the workflow touches buttons, dismissals,
  staged controls, or dialog flow

Target slice:
- app-shell retirement and bridge cleanup
- final removal of compatibility fallbacks that shadow slice-owned queries
- shell-only route and refresh coordination
- legacy bootstrap or route-page compatibility paths that are now redundant
- shell-level invalidation and restore behavior where the shell is still a
  required bridge

Target scenarios:
- app shell request stays shell-only
- route transitions keep the previous screen visible until the next page
  settles
- same-tab return still uses settled fresh data without destructive reload
- cross-tab freshness still respects active workflow locks
- old compatibility paths do not survive after the verified replacement path
  exists

Target coupling rows:
- src/client/App.jsx app-shell coupling
- src/client/App.jsx route fallback and cross-tab restore coupling
- src/client/app-sync.js shell-bridge transport coupling
- src/client/query-mutations.js broad invalidation coupling
- src/client/query-keys.js stale route-key compatibility coupling
- src/client/monies-client-service.js helper facade boundaries
- docs/app-shell-flow.md shell-bridge contract coupling

Target query contract:
- appShell
- routePage
- summaryPage
- monthPage
- entriesPage
- importsPage
- splitsPage
- settingsPage
- routePage may remain only for pages and surfaces that do not yet have verified
  slice-owned query boundaries
- do not use routePage as a fallback for slices that already have dedicated
  query keys
- remove compatibility fallbacks only after the replacement path is verified
  and test-covered
- keep the shell bridge narrow and explicit
- invalidate only the exact slice keys named in docs/query-map.md
- do not reintroduce hidden bootstrap dependence
- do not centralize all shell cleanup into App.jsx if slice-owned helpers can
  make the decision

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
- keep the shell bridge narrow and explicit
- remove legacy paths in the same slice once the replacement is verified
- commit in small readable batches as the slice progresses
- finish with a closure audit before considering the slice complete

Implementation rules:
- App.jsx may execute shell and refresh plans, but must not become the owner of
  slice-specific decisions
- if a branch requires domain knowledge, move that decision into the slice
  helper first
- keep route selection in the browser/router and keep server state in TanStack
  Query
- keep compatibility branches visibly temporary and delete them in the same
  slice after verification
- prefer small, named helpers for shell cleanup decisions instead of adding a
  larger global coordinator
- preserve same-tab and cross-tab freshness behavior while removing the last
  old paths
- keep any shell refresh exception narrow, named, and test-backed

Deliverables:
- tests covering the remaining shell-bridge assumptions and compatibility
  cleanup
- a legacy-path inventory before any deletions:
  - file
  - current caller
  - replacement path
  - test proving replacement
  - safe to remove now? yes/no
- a table of every remaining `refreshShell: true` path:
  - why shell refresh is still required
  - whether it is named
  - whether it is test-backed
  - exit condition for removing it
- code changes that remove the verified legacy paths
- doc updates only if the shell contract changed
```

## Why This Prompt

- It follows the same prompt shape as the earlier slice prompts.
- It turns the remaining shell debt into a concrete cleanup slice instead of a
  vague “finish the refactor” task.
- It keeps the work focused on deleting compatibility paths after the
  replacement paths are already proven.
- It preserves the rule that App.jsx remains a shell, not a hidden domain
  service.
- It gives the next implementer a narrow closure target instead of opening a
  new feature area.

No additional legacy bridge/fallback paths were found beyond the intentionally
retained routePage fallback for unsupported surfaces and the named
refreshShell: true exceptions.

The eighth slice is now closed.
