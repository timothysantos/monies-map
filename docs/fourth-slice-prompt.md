# Fourth Slice Prompt

Use this prompt for the next implementation slice after the imports workflow
rewrite is in place.

This slice is intentionally focused:

- settings as the reference-data and trust workspace
- settings page query boundary
- settings CRUD and invalidation
- category-rule and reconciliation workflows
- narrow shell-level refresh only where shared reference metadata truly needs it
- fixture-backed regression coverage for settings-driven downstream effects
- explicit settings-panel thinness and ownership boundaries
- documentation updates only where settings assumptions prove wrong

It is not a broad rewrite of imports, entries, month, summary, or splits.
It is also not a redesign of the household finance domain.

```text
Implement the settings query and workflow slice.

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
- settings page query boundary
- settings reference-data workflows
- settings trust and reconciliation workflows
- settings CRUD invalidation
- downstream freshness for summary, month, entries, imports, and splits where
  the settings change truly affects them

Target scenarios:
- ST1 Review household reference data
- ST2 Create or edit a person
- ST3 Create, edit, or archive an account
- ST3a New or edited account refreshes Summary account pills
- ST4 Create or edit a category
- ST5 Manage category match rules and suggestions
- ST6 Manage statement checkpoints and reconciliation review
- ST7 Review and dismiss unresolved transfers
- ST8 Run demo and local environment controls safely
- X8 Settings reference-data change affects later workflows

Target coupling rows:
- src/client/query-mutations.js broad invalidation
- src/client/monies-client-service.js helper facade boundaries
- src/client/settings-panel.jsx settings query and orchestration coupling
- src/client/settings-dialogs.jsx account and category dialog coupling
- src/client/settings-api.js broad settings mutation coupling
- src/client/settings-reconciliation-dialog.jsx trust and checkpoint coupling
- src/client/imports-panel.jsx dependency on settings dialogs and settings API

Target query contract:
- settingsPage
- settingsAccountTrust only if the reconciliation/checkpoint detail truly
  needs to split out
- invalidate only the exact slice keys named in docs/query-map.md
- invalidate settings queries after settings CRUD
- invalidate app-shell reference data only for:
  - person rename
  - account create/edit/archive
  - category create/edit/delete
  - category-rule changes that alter import behavior later
- do not burst unrelated queries after every settings save
- keep cross-page freshness exact for summary, month, entries, imports, and
  splits only when the settings mutation actually changes their visible data

Constraints:
- keep code within docs/code-spec.md limits
- preserve docs/existing-behavior-guardrails.md
- keep the slice narrow and do not refactor unrelated slices
- update or add tests before moving implementation logic
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen app-shell dependence
- do not widen invalidation beyond the documented contract
- do not turn settings into a hidden global refresh service
- do not let settings workflow state leak into app-shell ownership
- do not let broad shell refresh become the default answer for settings CRUD
- do not redesign accounting semantics, transfer semantics, or budgeting rules
- do not move imports or entries logic into settings helpers just because they
  consume the same reference data
- keep the workflow narrow and reference-data driven
- remove the old settings mutation/query path in the same slice once the new
  path is verified and covered by tests; do not leave compatibility fallbacks
  behind
- commit in small readable batches as the slice progresses
- keep code comments above every important block, hook, branch, and helper in
  any refactored file
- use fixture-backed coverage for downstream effects when a settings change
  alters another workflow
- keep settings as a deep module with explicit refresh rules, not a monolith
- finish with a settings closure audit before considering the slice complete

Implementation rules:
- preserve explicit state ownership between:
  - browser route state
  - query-backed server state
  - settings workflow state
  - transient UI state
- keep browser location as the source of truth for route state
- keep TanStack Query as the source of truth for server-backed state
- keep app shell as global metadata only
- keep settings page lightweight: reference data, trust panels, reconciliation,
  and workflow-specific actions only
- keep the settings panel mostly as rendering and event wiring; move remaining
  workflow decisions into the settings deep module
- keep trust and reconciliation details out of app-shell bootstrap
- use slice-owned key builders and selectors for settings data
- preserve reference-data freshness across:
  - settings invalidation
  - background refreshes
  - route transitions
  - query replacement
  - explicit account/category/person mutations
- preserve active dialog state while invalidation decides whether a rerender or
  refetch is safe
- keep shell refresh as a narrow exception only where shared metadata changes
  truly require it
- invalidate exact downstream queries for the specific settings change instead
  of falling back to broad shell reloads
- keep settings-driven downstream effects exact and documented
- move boundary decisions into docs if the code proves the current assumptions
  wrong

Deliverables:
- tests for the target scenarios and coupling rows
- settings page and settings workflow code changes only for this slice
- exact invalidation updates for settings CRUD and downstream reference-data
  freshness
- doc updates only if a documented settings assumption proves wrong
```

## Ownership Model

Use these definitions during the slice so state does not drift across layers.

### Route state

Derived from browser location.

Examples:

- active settings section
- active route
- dialog route affordance when applicable

The browser URL remains the source of truth.

### Server state

Query-backed server data managed by TanStack Query.

Examples:

- people
- accounts
- categories
- category rules and suggestions
- unresolved transfers
- reconciliation checkpoints and exceptions
- settings page payload

TanStack Query remains the source of truth.

If a trust or reconciliation artifact is local-first, dialog-oriented, or not
yet persisted into the query-backed response path, treat that artifact as
workflow state instead of server state.

### Workflow state

Long-lived settings workflow continuity.

Examples:

- open section
- active dialog selection
- reconciliation review state
- pending category-rule review
- demo/local environment action flow

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

The measurable payoff for this slice is not just "settings are cleaner."

The win is:

- reference data changes invalidate exactly the queries that depend on them
- summary, month, entries, imports, and splits stay fresh without broad shell
  reloads
- trust and reconciliation workflows keep their continuity while data refreshes
- account/category/person changes do not silently become global reload
  behavior

## Why This Prompt

- It follows the same level of specificity as the first, second, and third
  slice prompts.
- It names the actual settings scenarios instead of saying "work on settings."
- It keeps the slice focused on query ownership, invalidation, trust,
  reconciliation, and reference-data propagation.
- It keeps settings from turning into a backdoor rewrite of app shell, route
  context, imports, or unrelated feature slices.
- It captures the lesson from the imports slice that special-case shell refresh
  must stay isolated, named, and test-backed.
- It makes the settings rewrite explicit while still constraining the rewrite
  to reference-data ownership and query boundaries instead of domain redesign.

## Why This Is Next

The imports slice is now closed.

That means the next highest-value slice is the one already called out in
[`docs/implementation-order.md`](./implementation-order.md):

- settings is the last major feature slice
- settings controls household reference data used by every other workflow
- settings changes affect summary, month, entries, imports, and splits
- settings already has scenario coverage and coupling targets worth tightening

In other words:

- the first slice built shell/query foundations
- the second slice fixed navigation hydration and boundary shape
- the third slice moved imports onto the new workflow/query contracts
- this fourth slice should move settings onto those same tight contracts
