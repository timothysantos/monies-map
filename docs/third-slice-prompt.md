# Third Slice Prompt

Use this prompt for the next implementation slice after the route-transition
and domain-boundary work is in place.

This slice is intentionally focused:

- deliberate imports-system rewrite onto the new architecture
- imports page query boundary
- import preview workflow boundary
- import commit and rollback invalidation
- parser robustness and preview guardrails
- workflow-lock behavior for active import review
- documentation updates only where imports assumptions prove wrong

It is not a broad rewrite of entries, month, summary, or settings.
It is also not a redesign of the accounting domain.

```text
Implement the imports query and workflow slice.

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
- docs/responsive-behavior.md
- docs/interaction-guidelines.md if the work touches buttons, dismissals, or
  staged review controls
- docs/route-data-code-flow.md

Target slice:
- imports page, import preview, commit/rollback invalidation, and parser
  robustness

Target scenarios:
- I5 Review preview guardrails
- I6 Commit a generic import
- I7 Reconcile provisional rows instead of duplicating them
- I8 Save statement checkpoints and reconciliation evidence
- I9 Auto-refresh a stale statement preview safely
- I10 Review and rollback recent imports
- X5b Cross-tab return does not clobber active mobile workflows

Target coupling rows:
- src/client/query-mutations.js broad invalidation
- src/client/import-preview-review.jsx and statement compare amount editing
- mobile sheets versus desktop editors
- imports page and preview refresh behavior that can still leak across route
  boundaries

Target query contract:
- importsPage
- importPreview
- keep importRecentHistory inside importsPage unless the work proves it must
  split
- invalidate only the exact slice keys named in docs/query-map.md
- invalidate imports history after commit or rollback
- invalidate import preview only when:
  - draft signature changes
  - explicit preview refresh is triggered
  - statement auto-refresh throttle permits it
- keep import preview draft review under a workflow lock so destructive refresh
  does not clobber active review state

Constraints:
- keep code within docs/code-spec.md limits
- preserve docs/existing-behavior-guardrails.md
- keep the slice narrow and do not refactor unrelated slices
- update or add tests before moving implementation logic
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen invalidation beyond the documented contract
- do not collapse preview freshness into generic global focus-refresh behavior
- do not move parser recognition logic into thin UI helpers
- do not widen app shell or route-context responsibilities to solve imports
  problems
- do not let workflow snapshots become competing route state
- do not let imports workflow state leak into app-shell ownership
- do not let parser logic become a universal accounting engine
- do not let route refreshes become workflow resets
- keep import preview as a deep workflow module with explicit refresh rules
- commit in small readable batches as the slice progresses
- keep code comments above every important block, hook, branch, and helper in
  any refactored file
- keep route-context and page-labels boundary tests passing
- update docs only if a documented imports assumption proves wrong

Implementation rules:
- preserve explicit state ownership between:
  - browser route state
  - query-backed server state
  - imports workflow state
  - transient UI state
- keep browser location as the source of truth for route state
- keep TanStack Query as the source of truth for server-backed state
- keep app shell as global metadata only
- keep route DTO ownership route-owned
- keep imports page lightweight: recent import history, rollback policy, and
  import-related reference metadata only
- keep preview results out of importsPage and inside importPreview
- use draft-signature query identity for preview reuse
- preserve reconciliation metadata, overlap imports, checkpoint summaries, and
  commit-status decisions in preview responses
- preserve active draft state while preview refresh logic decides whether a
  rerun is safe
- preserve workflow state across:
  - invalidation
  - background refreshes
  - route transitions
  - query replacement
  - commit/rollback refreshes
- keep commit/rollback downstream invalidation exact for:
  - importsPage
  - affected entriesPage keys
  - affected monthPage keys
  - affected summaryPage keys
  - affected account/trust queries only if the current code path truly needs
    them
- parser fixes should prefer fixture-backed coverage for structural variants
  from the same source
- treat preview auto-refresh and parser robustness as first-class imports
  concerns, not generic app-shell concerns

Deliverables:
- tests for the target scenarios and coupling rows
- imports page and import preview query-boundary changes only for this slice
- exact commit/rollback invalidation updates
- parser/preview guardrail fixes only where tests prove they are needed
- doc updates only if a documented imports assumption proves wrong
```

## Ownership Model

Use these definitions during the slice so state does not drift across layers.

### Route state

Derived from browser location.

Examples:

- active tab
- active route
- active month
- active person view

The browser URL remains the source of truth.

### Server state

Query-backed server data managed by TanStack Query.

Examples:

- imports history
- parsed previews
- duplicate detection results
- reconciliation visibility
- downstream ledger effects after commit or rollback

TanStack Query remains the source of truth.

### Workflow state

Long-lived imports workflow continuity.

Examples:

- uploaded file
- parser progress
- row mappings
- duplicate decisions
- staged fixes
- draft review selections
- preview scroll state
- mobile sheet or dialog state

Workflow state is not route state and is not server state. It must survive:

- invalidation
- background refreshes
- route transitions
- query replacement
- commit/rollback refreshes

### UI state

Purely local or transient rendering state.

Examples:

- hover state
- modal visibility
- expanded rows
- focused input

UI state must never become authoritative business state.

## Why This Prompt

- It follows the same level of specificity as the second-slice prompt.
- It names the actual imports scenarios instead of saying "work on imports."
- It keeps the slice focused on query ownership, workflow locks, invalidation,
  and parser guardrails.
- It keeps imports from turning into a backdoor rewrite of app shell, route
  context, or unrelated feature slices.
- It makes the imports rewrite explicit while still constraining the rewrite to
  workflow ownership and query boundaries instead of accounting-domain redesign.

## Why This Is Next

The route-transition and shared-boundary slice is now in place.

That means the next highest-value slice is the one already called out in
[`docs/implementation-order.md`](./implementation-order.md):

- imports are operationally critical
- imports already have strong scenario coverage
- imports create freshness and invalidation pressure across entries, month, and
  summary

In other words:

- the first slice built shell/query foundations
- the second slice fixed navigation hydration and boundary shape
- this third slice should move the imports workflow onto those tighter
  contracts
