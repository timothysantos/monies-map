# First Slice Prompt

Use this prompt to start the first implementation slice.

It is intentionally narrow: app shell and query infrastructure only.

```text
Implement the app shell and query infrastructure foundation.

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
- docs/existing-behavior-guardrails.md
- docs/responsive-behavior.md if the work touches mobile behavior
- docs/interaction-guidelines.md if the work touches filter surfaces or
  dismissal semantics

Target slice:
- app shell and query infrastructure

Target scenarios:
- X5a Same-tab return uses settled fresh data, not destructive reload
- X5b Cross-tab return does not clobber active mobile workflows
- S9 Summary tab refreshes after related changes in another tab
- M2 Switch scope without corrupting planned values

Target coupling rows:
- src/client/App.jsx bootstrap coupling
- src/client/query-mutations.js broad invalidation
- mobile sheets versus desktop editors

Target query contract:
- appShell
- summaryPage
- monthPage
- entriesPage
- invalidate only the exact slice keys named in docs/query-map.md

Constraints:
- keep code within docs/code-spec.md limits
- preserve docs/existing-behavior-guardrails.md
- keep the slice narrow and do not refactor unrelated slices
- update or add tests before moving implementation logic
- do not widen bootstrap dependence
- do not widen invalidation beyond the documented contract
- keep mobile workflow locks intact

Deliverables:
- tests for the target scenarios and coupling rows
- query boundary and shell changes only for the foundation slice
- doc updates only if a documented assumption proves wrong
```

## Why This Prompt

- It points the model at the exact docs.
- It names only the first foundational slice.
- It makes the current risk areas explicit.
- It keeps the work small enough for a mini model to execute cleanly.
