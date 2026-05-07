# Implementation Order

This document is the Stage 4 execution order for the Monies Map refactor.

It answers a narrower question than `docs/architecture.md`:

- in what order should implementation happen
- which tests should come first
- which slice should move first
- what should wait until the foundation exists

Read this after [`docs/code-spec.md`](./code-spec.md) and before starting any
non-trivial refactor.

## Core Rule

Do not try to complete the entire scenario catalog before refactoring.

That would lock too many tests to the current architecture and slow the
foundational work. Instead:

1. build the foundation and its contract tests first
2. migrate one slice at a time
3. expand scenario coverage as each slice moves

The scenario catalog is the behavior map. It is not a mandate to finish every
scenario before Stage 4 begins.

## What Must Exist Before Slice Refactors

These artifacts should be treated as required input:

- [`AGENTS.md`](../AGENTS.md)
- [`DOMAIN.md`](../DOMAIN.md)
- [`docs/architecture.md`](./architecture.md)
- [`docs/code-spec.md`](./code-spec.md)
- [`docs/query-map.md`](./query-map.md)
- [`docs/slice-inventory.md`](./slice-inventory.md)
- [`docs/existing-behavior-guardrails.md`](./existing-behavior-guardrails.md)

These define:

- vocabulary
- query ownership
- cache and invalidation rules
- workflow-lock behavior
- target slice boundaries
- code shape and performance budgets

## Stage 4 Goals

Stage 4 should produce four things:

- slice-owned query boundaries
- narrow invalidation behavior
- deep modules with small public APIs
- scenario coverage that grows with each migrated slice

It should not try to:

- finish all product scenarios first
- redesign all backend boundaries at once
- make every page perfect before the first slice lands

## Test Order

Use this order for tests.

### First: foundational contract tests

Start with tests that protect the refactor foundation:

- route params map to the correct query keys
- invalidation hits the correct slices after mutation
- workflow locks prevent destructive refresh replacement
- warmup stops on route change, hide, refresh, or active editing
- cross-tab invalidation reaches stale pages without full reload

These are the tests that let the TanStack migration happen safely.

### Second: brittle workflow tests

Then add or tighten tests for workflows most likely to regress during the move:

- imports preview refresh and commit/rollback flows
- entries edit, filter, quick-entry, and add-to-splits flows
- mobile sheet and quick-entry protection behavior
- same-tab return freshness and cross-tab freshness

### Third: metric and aggregate tests

Then tighten calculation-facing scenarios:

- summary head metrics by scope
- month panel metrics by scope
- entries totals strip by scope
- account-pill refresh after imports, entry edits, and settings changes

### Fourth: remaining slice scenarios

After a slice is stable on the new foundation, complete the rest of its scenario
coverage from `docs/scenario-catalog.md`.

## Slice Order

Use this slice order unless implementation discovers a blocker.

### 1. App shell and query infrastructure

Build first:

- `appShell` query contract
- shared query client rules
- shared query keys/query option patterns
- shared workflow-lock primitives
- cross-tab invalidation primitives

Why first:

- every slice depends on this
- this is where the worker-instability risk starts to drop
- broad bootstrap dependence must shrink before slice work pays off fully

Tests first:

- shell cache rules
- visible-query budget assumptions
- warmup cancellation and route-change cancellation
- cross-tab signal handling

### 2. Imports

Build second:

- imports page query boundary
- import preview workflow boundary
- commit/rollback invalidation map
- parser robustness coverage

Why next:

- imports already have relatively strong scenario coverage
- imports are operationally critical
- imports are one of the biggest sources of freshness and invalidation pressure

Tests first:

- preview refresh rules
- commit invalidation
- rollback invalidation
- fixture-backed parser regression tests

### 3. Entries

Build third:

- entries page query contract
- route/filter contract
- quick-entry workflow boundary
- entry save and invalidation boundary
- save-first add-to-splits behavior

Why here:

- entries is central to the app
- entries carries many workflow-lock and freshness concerns
- summary/month correctness depends heavily on entry mutation behavior

Tests first:

- quick-entry one-shot behavior
- mobile edit-sheet protection
- category-filter recategorization stability
- add-to-splits group selection and save-first behavior
- totals strip scope weighting

### 4. Month

Build fourth:

- month page query contract
- month workspace deep module
- month-plan save invalidation
- month note and plan-link mutation boundaries

Why after entries:

- month depends on the same freshness foundation
- month and entries share some editor mechanics
- month metrics and notes should settle on the refactored invalidation model

Tests first:

- month metrics by scope
- note save and return freshness
- plan-row editing and link save
- month drilldown round trips

### 5. Summary

Build fifth:

- summary page query contract
- summary account pills query
- summary drilldown route helpers
- summary note invalidation

Why after month and entries:

- summary is mostly downstream of entry and month mutations
- it becomes easier to validate once those mutation sources are stable

Tests first:

- head metrics by scope
- category drilldown route contract
- account-pill freshness
- same-tab and cross-tab return freshness

### 6. Splits

Build sixth:

- keep existing strong behavior while narrowing query ownership
- split draft and optimistic-refresh guards
- split invalidation map into entries and summary/month dependents

Why later:

- splits is already one of the stronger slices structurally
- it benefits from the shared query and invalidation foundation

Tests first:

- stale-refresh guard behavior
- cross-tab refresh
- match/create/delete flows

### 7. Settings

Build last among feature slices:

- settings page query boundary
- CRUD invalidation into downstream slices
- account/category/person change propagation

Why last:

- settings changes are broad fan-out changes
- it is easier to wire correctly once the consuming slices are already owned

Tests first:

- account creation affects imports and summary
- category changes affect later entries/imports workflows
- downstream account-pill and filter refresh

## Per-Slice Execution Pattern

For each slice, use this pattern:

1. choose the first scenario subset for the slice
2. write or tighten contract tests for that subset
3. introduce the slice query options and mutation boundary
4. move helper logic behind the slice deep module
5. connect invalidation and workflow-lock behavior
6. verify same-tab and cross-tab freshness
7. then widen scenario coverage

Do not:

- migrate all helpers first without tests
- rewrite all components before query ownership is clear
- keep bootstrap as a hidden fallback dependency once a slice is migrated

## First Practical Milestone

The first milestone should be:

- shell query foundation in place
- imports on slice-owned queries
- entries on slice-owned queries for its main page path
- foundational invalidation and workflow-lock tests passing

At that point the refactor has real leverage:

- worker-risk starts to drop
- bootstrap dependence shrinks materially
- later month and summary work can move faster

## Definition Of Done For Stage 4

Stage 4 is done when:

- each major slice owns its query and mutation boundary
- page components mostly orchestrate and render
- invalidation rules are explicit and narrow
- foundational freshness and workflow-lock tests are in place
- scenario coverage expanded with each migrated slice, not postponed to the end
