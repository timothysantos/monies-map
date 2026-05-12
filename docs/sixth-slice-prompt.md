# Sixth Slice Prompt

Use this prompt for the next implementation slice after the summary query and
workflow slice is in place.

This slice is intentionally focused:

- splits as the shared-expense and settlement workspace
- splits page query boundary
- split draft and optimistic-refresh guards
- split match and linked-entry workflows
- narrow downstream freshness into entries, month, and summary only where the
  split change truly affects them
- regression coverage for stale-refresh guards, cross-tab refresh, and linked
  ledger effects
- explicit splits-panel thinness and ownership boundaries
- documentation updates only where splits assumptions prove wrong

It is not a broad rewrite of entries, month, summary, imports, or settings.
It is also not a redesign of the household finance domain.

```text
Implement the splits query and workflow slice.

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
- docs/responsive-behavior.md if the work touches mobile/desktop behavior
- docs/interaction-guidelines.md if the workflow touches buttons, dismissals,
  staged controls, or dialog flow
- docs/route-data-code-flow.md

Target slice:
- splits page query boundary
- split workspace deep module
- split draft and optimistic-refresh guards
- split match and linked-entry workflows
- split mutation invalidation into entries, month, and summary only where the
  split change actually affects them
- cross-tab freshness for split-driven changes

Target scenarios:
- SP1 Review split workspace for a person or household
- SP2 Create a split expense
- SP3 Edit a split expense
- SP3a Replace split amount fields by typing without select-all
- SP4 Delete a split expense
- SP5 Record a settlement and archive a closed batch
- SP6 Review match queue and link a split expense to an entry
- SP7 Review match queue and link a settlement to an entry
- SP8 Open linked entry from live or archived split history
- SP8a Split workspace amount editing follows the same typing contract as entries
- SP8b Link a previously manual split to an entry later
- X6 Split changes affect later entries, month, and summary workflows only when
  linked ledger behavior changes

Target coupling rows:
- src/client/splits-panel.jsx splits query and orchestration coupling
- src/client/splits-dialogs.jsx amount focus/select behavior
- src/client/splits-linked-entry-dialog.jsx linked-entry search and save coupling
- src/client/splits-optimistic.js optimistic reconciliation coupling
- src/client/query-mutations.js broad invalidation
- src/client/app-sync.js cross-tab split refresh coupling
- src/client/entries-panel.jsx dependency on split-driven freshness and linked-entry return flow

Target query contract:
- splitsPage
- splitArchiveBatch only if archive payload cost justifies splitting it out
- invalidate only the exact slice keys named in docs/query-map.md
- invalidate splits queries after split expense create/edit/delete
- invalidate splits queries after settlement create/delete
- invalidate splits queries after split match link actions
- invalidate entries, month, and summary only when:
  - split linking/unlinking changes ledger ownership or linked split state
  - split mutations change totals included in month or summary views
  - settlement linking changes visible transfer evidence
- do not burst unrelated queries after every split save
- keep cross-page freshness exact for entries, month, and summary only when the
  split mutation actually changes their visible data

Constraints:
- keep code within docs/code-spec.md limits
- preserve docs/existing-behavior-guardrails.md
- keep the slice narrow and do not refactor unrelated slices
- update or add tests before moving implementation logic
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen invalidation beyond the documented contract
- do not turn splits into a hidden global refresh service
- do not let split workflow state leak into app-shell ownership
- do not let broad shell refresh become the default answer for split CRUD
- do not redesign accounting semantics, transfer semantics, or budgeting rules
- do not move entries or month logic into split helpers just because splits
  consume linked ledger state
- keep the workflow narrow and shared-expense driven
- remove the old split mutation/query path in the same slice once the new path
  is verified and covered by tests; do not leave compatibility fallbacks behind
- commit in small readable batches as the slice progresses
- keep code comments above every important block, hook, branch, and helper in
  any refactored file
- keep regression coverage for stale-refresh guards, cross-tab refresh, and
  linked ledger effects
- keep splits as a deep module with explicit refresh rules, not a monolith
- finish with a splits closure audit before considering the slice complete

Implementation rules:
- preserve explicit state ownership between:
  - browser route state
  - query-backed server state
  - splits workflow state
  - transient UI state
- keep browser location as the source of truth for route state
- keep TanStack Query as the source of truth for server-backed state
- keep app shell as global metadata only
- keep splits page lightweight: group navigation, activity, matches, archive
  access, and workflow-specific actions only
- keep the splits panel mostly as rendering and event wiring; move remaining
  workflow decisions into the splits deep module
- keep split draft state and optimistic merge details out of app-shell bootstrap
- use slice-owned key builders and selectors for splits data
- preserve freshness across:
  - split invalidation
  - background refreshes
  - route transitions
  - query replacement
  - explicit split expense, settlement, and match mutations
- preserve active draft, match, archive, and link-entry state while invalidation
  decides whether a rerender or refetch is safe
- keep shell refresh as a narrow exception only where shared metadata changes
  truly require it
- invalidate exact downstream queries for the specific split change instead of
  falling back to broad shell reloads
- keep split-driven downstream effects exact and documented
- move boundary decisions into docs if the code proves the current assumptions
  wrong

Deliverables:
- tests for the target scenarios and coupling rows
- splits page and splits workflow code changes only for this slice
- exact invalidation updates for split expense, settlement, match, and linked-entry
  freshness
- doc updates only if a documented splits assumption proves wrong
```

## Ownership Model

Use these definitions during the slice so state does not drift across layers.

### Route state

Derived from browser location.

Examples:

- active split group
- active split mode
- linked-entry route affordance when applicable

The browser URL remains the source of truth.

### Server state

Query-backed server data managed by TanStack Query.

Examples:

- splits page data
- visible split groups
- visible activity
- visible match queue
- archive metadata

TanStack Query remains the source of truth.

If a split draft, match candidate picker, or archive selection artifact is
local-first, dialog-oriented, or not yet persisted into the query-backed
response path, treat that artifact as workflow state instead of server state.

### Workflow state

Long-lived splits workflow continuity.

Examples:

- active draft expense editor
- pending archive selection
- linked-entry picker state
- active match queue selection

Workflow state is not route state and is not server state. It must survive:

- invalidation
- background refreshes
- route transitions
- query replacement
- save/close refreshes

### UI state

Purely local or transient rendering state.

Examples:

- hover state
- modal visibility
- expanded rows
- focused input

UI state must never become authoritative business state.

## Core Architectural Win

The measurable payoff for this slice is not just "splits are cleaner."

The win is:

- split mutations invalidate only the data that actually depends on them
- entries, month, and summary stay fresh without broad shell reloads
- split draft and match workflows keep their continuity while data refreshes
- linked-entry actions and settlements do not silently become global reload
  behavior

## Why This Prompt

- It follows the same level of specificity as the imports, settings, and
  summary slice prompts.
- It names the actual splits scenarios instead of saying "work on splits."
- It keeps the slice focused on query ownership, optimistic refresh guards,
  match flows, and linked ledger freshness.
- It keeps splits from turning into a backdoor rewrite of app shell, entries,
  month, or unrelated feature slices.
- It captures the lesson from earlier slices that cross-tab refresh and
  optimistic workflows must stay explicit, named, and test-backed.
- It makes the splits rewrite explicit while still constraining the rewrite to
  shared-expense workflow ownership and query boundaries instead of domain
  redesign.

## Why This Is Next

The summary slice is now closed.

That means the next highest-value slice is the one already called out in
[`docs/implementation-order.md`](./implementation-order.md):

- splits already has strong behavior and now needs narrower query ownership
- splits is the heaviest current consumer of cross-tab refresh and optimistic
  workflow rules
- splits mutations can affect entries, month, and summary, so the downstream
  invalidation contract is visible and high-risk
- splits already has scenario coverage and coupling targets worth tightening

In other words:

- the first slice built shell/query foundations
- the second slice fixed navigation hydration and boundary shape
- the third slice moved imports onto the tighter contracts
- the fourth slice tightened settings reference-data ownership
- the fifth slice moved summary onto slice-owned queries and invalidation
- this sixth slice should move splits onto those tighter contracts
