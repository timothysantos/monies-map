# Architecture Plan

This document is the human-readable architecture plan for Monies Map.

It is not the primary always-loaded AI instruction file. `AGENTS.md` is the
repository rule file that Codex reads each prompt. This document exists to give
humans and coding agents one durable technical plan to follow when changing the
system.

## Document Roles

- `AGENTS.md`: mandatory repository working rules and prompt-time behavior
- [`DOMAIN.md`](../DOMAIN.md): canonical ubiquitous language
- [`design.md`](../design.md): implementation boundaries and deep-module rules
- `docs/architecture.md`: target architecture, migration strategy, and staged
  delivery plan
- [`docs/scenario-catalog.md`](./scenario-catalog.md): Stage 1 TDD scenario map
- [`docs/slice-inventory.md`](./slice-inventory.md): Stage 2 slice ownership map
- [`docs/query-map.md`](./query-map.md): Stage 3 query and cache map
- [`docs/route-data-code-flow.md`](./route-data-code-flow.md): detailed
  three-lane explanation of route flow, data flow, code/rendering flow, and
  their current boundary rules
- [`docs/code-spec.md`](./code-spec.md): compact implementation spec, query
  budgets, invalidation contract, and code-shape rules
- [`docs/implementation-order.md`](./implementation-order.md): Stage 4
  execution order, test priority, and slice migration sequence
- [`docs/preimplementation-checklist.md`](./preimplementation-checklist.md):
  reusable pre-change audit checklist and stop conditions
- [`docs/known-coupling-targets.md`](./known-coupling-targets.md): audit
  findings that should become explicit tests or contract checks
- [`docs/implementation-prompt-template.md`](./implementation-prompt-template.md):
  exact prompt shape for slice work and bug fixes
- [`docs/refactor-decisions.md`](./refactor-decisions.md): intended answers to
  the remaining shell, helper, mobile, money-editing, bootstrap, and
  invalidation shape questions
- [`docs/first-slice-prompt.md`](./first-slice-prompt.md): ready-to-run prompt
  for the app shell and query infrastructure foundation slice
- [`docs/existing-behavior-guardrails.md`](./existing-behavior-guardrails.md): current-app behaviors that must survive refactors
- [`docs/responsive-behavior.md`](./responsive-behavior.md): responsive UX and form-factor contract
- [`docs/interaction-guidelines.md`](./interaction-guidelines.md): button, CTA, and dismissal semantics
- [`docs/import-summary-code-glossary.md`](./import-summary-code-glossary.md):
  page-local reading glossary, not a second domain source

## Current Problem

The app works, but the code is hard to follow because too much behavior is
spread across broad client helpers, page components, query wiring, and implicit
state flow. The main problems are:

- data flow is not obvious from screen to query to domain logic to storage
- feature code is not consistently organized as vertical slices
- the current client bootstrap is carrying too much responsibility
- slice migrations must cut over cleanly instead of preserving old and new
  paths side by side
- deep modules are present in intent but not yet enforced as the dominant shape
- tests exist, but the development process is not yet consistently TDD-first at
  the scenario level

## Target Principles

### Ubiquitous language

Ubiquitous language means the same business concept uses the same name in docs,
tests, DTOs, API contracts, and UI copy. Monies Map should have one canonical
term for each important finance concept.

Rules:

- `DOMAIN.md` is the canonical vocabulary
- new feature names must extend existing terms before inventing new ones
- page copy, test names, DTOs, and module names should prefer canonical terms
- narrow code glossaries may exist, but they must defer to `DOMAIN.md`

### Vertical slices

Vertical slices mean the codebase is organized around end-to-end user workflows
instead of around technical layers alone. A slice owns its UI, query options,
workflow orchestration, and tests for one product area.

Target slices:

- `summary`
- `months`
- `entries`
- `imports`
- `splits`
- `settings`

Rules:

- each slice should expose a small public surface
- cross-slice dependencies should be rare and explicit
- shared code should move to a shared module only when at least two slices need
  the same abstraction and the name is stable

### TDD by scenarios

TDD here does not mean writing one test per button. It means defining the user
scenarios that matter on each page and across pages, writing those tests first,
then implementing or refactoring to satisfy them.

Rules:

- every feature change starts with a failing or intentionally updated test
- page workflows should be described as scenarios, not implementation trivia
- cross-page flows are first-class because this app is a finance workflow, not
  a set of isolated screens
- tests should describe outcomes in domain terms

### Deep modules

Deep modules have small public APIs and substantial internal logic. A caller
should get a simple entry point without needing to understand the whole helper
graph behind it.

Rules:

- prefer small, intention-revealing public APIs
- hide formatting, shaping, reconciliation, and view-derivation internals
- avoid utility sprawl where every file imports every other helper directly
- a component should depend on a slice API, not on a web of helper files

## Target System Shape

### Server-state strategy

The app should move toward TanStack Query as the main server-state boundary.

Rules:

- stop treating bootstrap as the default source for all screens
- fetch the minimum data needed per screen
- keep separate queries for separate concerns such as:
  - month list
  - month detail
  - entries list
  - entry detail when needed
  - aggregates
  - imports preview state
  - splits workspace state
  - settings reference data
- let each slice own its query keys and query option builders
- invalidate narrowly after mutations

### Client state strategy

- route state should select the active screen and screen parameters
- server state should live in TanStack Query
- transient form state should stay local to the relevant feature
- derived view state should come from selectors or pure helpers, not effect
  chains

### Backend shape

The backend should remain explicit about boundaries:

- repository/storage logic
- domain logic and calculations
- DTO mapping
- route handlers

The existing domain richness is an asset. The redesign should not flatten the
domain model just to simplify the client.

### Savings model

The app should treat `savings target` as a first-class monthly planning input.

Rules:

- `savings target` is explicit monthly intent
- `savings target` is not inferred from a row label such as `Savings`
- `savings target` does not need to match a ledger entry
- `realized savings` is a derived outcome from actual ledger activity
- optional planned savings movements may still exist as matchable `month plan
  rows`, but those are not the same concept as the top-level `savings target`

## Documentation Standard

When changing architecture:

- update `AGENTS.md` if the rule must be followed every prompt
- update `DOMAIN.md` if the vocabulary changes
- update `design.md` if client boundaries or deep-module rules change
- update `docs/code-spec.md` if implementation rules, query budgets, or code
  shape constraints change
- update this file if the target structure, delivery stages, or technical
  direction changes

## Delivery Plan

The plan is TDD-first and no large rewrite should begin without stage-level
tests and acceptance criteria.

### Stage 0: Freeze vocabulary and rules

Goal:
- establish one source of truth for terms and repo guidance before moving code

Actions:
- keep `AGENTS.md` as the prompt-time instruction file
- keep `DOMAIN.md` as the canonical vocabulary
- keep page-specific glossaries subordinate to `DOMAIN.md`
- define vertical slices, TDD, and deep modules explicitly in the docs

Exit criteria:
- a contributor can answer where repo rules live
- a contributor can answer where domain terms live
- a contributor can answer what counts as a slice, scenario test, and deep
  module in this repo

### Stage 1: Define the scenario test map

Goal:
- turn each page and each cross-page workflow into a readable scenario catalog

Actions:
- list core scenarios for `Summary`, `Month`, `Entries`, `Imports`, `Splits`,
  and `Settings`
- list cross-page scenarios such as:
  - import affects entries
  - import affects month actuals
  - entries edits affect summaries
  - split matching affects entries and splits views
  - settings reference-data changes affect later imports and edits
- classify each scenario by test level:
  - domain/unit
  - integration/API
  - end-to-end
- include desktop/mobile interaction contracts when the same feature uses
  different containers, such as inline filter bars versus mobile filter sheets

Exit criteria:
- each page has a scenario list
- each cross-page workflow has at least one acceptance scenario
- new work can start from scenarios instead of from component internals

Artifact:
- [`docs/scenario-catalog.md`](./scenario-catalog.md)

### Stage 2: Define the target slice boundaries

Goal:
- decide where code should live before moving it

Actions:
- define the public boundary of each slice:
  - routes/screens
  - query surface
  - selectors/view helpers
  - mutations/workflow actions
  - test surface
- identify current files that belong to each slice
- identify shared modules that should remain shared versus code that should move
  back into a slice

Exit criteria:
- each existing client file has an intended future home
- shared modules are justified, not accidental
- slice boundaries are readable without opening many files

Artifact:
- [`docs/slice-inventory.md`](./slice-inventory.md)

### Stage 3: Replace bootstrap-heavy loading with TanStack query slices

Goal:
- move from broad bootstrap hydration to minimal, screen-owned data fetching
- remove the old path in the same slice once the replacement passes the slice
  tests

Actions:
- inventory current refresh, prefetch, quick-entry, and cross-tab behaviors
  before replacing them
- define query contracts for summary, month, entries, imports, splits, and
  settings
- separate aggregates from row-level queries
- separate month list queries from month detail queries
- keep invalidation narrow and predictable
- remove hidden data dependencies on one giant bootstrap payload
- do not leave a compatibility path alive after the slice owns its new query
  boundary

Exit criteria:
- each screen can describe which query powers it
- loading one screen does not require hydrating unrelated screens
- mutations invalidate only the affected slices

Artifact:
- [`docs/query-map.md`](./query-map.md)
- [`docs/existing-behavior-guardrails.md`](./existing-behavior-guardrails.md)

### Stage 4: Refactor into deep modules inside each slice

Goal:
- hide slice complexity behind small, readable APIs

Actions:
- create or reinforce slice-level deep modules
- move low-level helper graphs behind those boundaries
- keep public APIs short and intention-revealing
- reduce direct component imports from many helper files
- start with the slice that has the clearest scenario coverage and the fewest
  hidden cross-slice dependencies
- keep Stage 3 as the foundation for this stage; do not start deep-module
  refactors before the query map is in place

Exit criteria:
- page components read as orchestration and rendering, not helper plumbing
- a new contributor can follow one slice without reading the whole app
- helper sprawl is reduced measurably

Artifact:
- [`docs/implementation-order.md`](./implementation-order.md)

Before implementation work, also use:

- [`docs/preimplementation-checklist.md`](./preimplementation-checklist.md)
- [`docs/known-coupling-targets.md`](./known-coupling-targets.md)
- [`docs/implementation-prompt-template.md`](./implementation-prompt-template.md)
- [`docs/refactor-decisions.md`](./refactor-decisions.md)
- [`docs/first-slice-prompt.md`](./first-slice-prompt.md)

### Stage 5: Tighten backend boundaries to match the slices

Goal:
- keep the client cleanup matched by explicit backend seams

Actions:
- verify DTO boundaries for each slice
- keep domain calculations pure where possible
- separate route handlers from repository internals
- align backend query shapes with the TanStack slice contracts

Exit criteria:
- API responses match slice needs cleanly
- route handlers are not mixing domain and persistence concerns
- DTO naming aligns with `DOMAIN.md`

### Stage 6: Simplify for readability

Goal:
- make the code feel standard, short, and obvious to follow

Actions:
- rename modules and functions toward domain terms
- remove unnecessary abstractions and duplicated indirection
- prefer short files when a split increases clarity
- prefer slightly duplicated simple code over premature shared complexity

Exit criteria:
- the common data flow of a feature is visible in a few files
- module names match user workflows
- average changes touch one slice more often than many unrelated helpers

## Scenario Planning Standard

Every new feature or refactor stage should define scenarios in this shape:

1. User intent
2. Starting state
3. Action
4. Expected visible result
5. Expected persisted or queried result

Examples of scenario families to define:

- Imports:
  - import a known file
  - review preview rows
  - commit rows
  - see imported effects in entries and month views
- Entries:
  - edit category, owner, note, transfer, or split behavior
  - see aggregate changes where relevant
- Month:
  - review plan versus actual
  - inspect drill-downs
- Splits:
  - create expense
  - match ledger entries
  - settle balances
- Settings:
  - change categories, people, or accounts
  - confirm later flows use the changed reference data

## Non-Goals

This plan does not aim to:

- rewrite the domain model from scratch
- replace D1 or Workers
- chase abstract purity over readable product code
- force one test type to cover all behavior

## Immediate Next Planning Artifacts

Before implementation, the next useful planning documents are:

- a migration order that reduces risk and preserves working behavior
