# Slice Inventory

This document is the Stage 2 vertical-slice inventory for Monies Map.

It maps the current files into target slices, identifies what should remain
shared, and calls out what should move behind slice-level deep modules.

The target slices are:

- `summary`
- `months`
- `entries`
- `imports`
- `splits`
- `settings`

Supporting areas that remain outside a slice:

- `app shell`
- `shared client UI`
- `shared client utilities`
- `server and DTO contracts`
- `domain and repository internals`
- `bank parsing and low-level libraries`

## Classification Labels

- `Own`: this file should live conceptually inside one slice
- `Shared`: this file should remain cross-slice
- `Bridge`: this file currently crosses boundaries and should be split or
  narrowed

## Target Slice Public Surfaces

Each slice should eventually expose a small public surface.

### Summary slice

Target public surface:

- summary query options
- summary route helpers
- summary selectors and drill-down helpers
- summary note mutation helpers
- summary display components

### Months slice

Target public surface:

- month query options
- month route helpers
- month plan-row selectors and edit helpers
- month note and plan-link mutation helpers
- month display components

### Entries slice

Target public surface:

- entries query options
- entries route helpers and filter contract
- entry editor/composer helpers
- entry mutations
- entry display components

### Imports slice

Target public surface:

- import draft helpers
- import preview query/mutation helpers
- import commit and rollback helpers
- import review selectors
- import workflow components

### Splits slice

Target public surface:

- splits query options
- split route helpers
- split draft and validation helpers
- split mutation helpers
- split display components

### Settings slice

Target public surface:

- settings query options
- settings section routing helpers
- settings CRUD and reconciliation mutation helpers
- settings display components

## App Shell

These files should stay outside feature slices because they own app-level
composition, routing, or environment setup.

### Shared app shell files

- `src/client/App.jsx` — `Shared`
  - Keep as the route shell and top-level composition layer.
  - Long-term change: stop embedding slice data-fetch orchestration here beyond
    route selection and shell controls.
- `src/client/main.jsx` — `Shared`
  - Keep as React bootstrap entry point.
- `src/client/query-client.js` — `Shared`
  - Keep as TanStack Query client setup.
- `src/client/app-sync.js` — `Shared`
  - Keep as cross-tab sync infrastructure.
  - Long-term change: slices should call this through narrow helpers, not
    import all app-sync details directly.
- `src/client/mobile-focus-visibility.js` — `Shared`
  - Keep as app-level mobile UX utility.
- `src/client/request-errors.js` — `Shared`
  - Keep as shared error formatting until slices earn their own wrappers.
- `src/client/faq-panel.jsx` — `Shared`
  - Keep outside the main product slices.
- `src/client/copy/en-SG.js` — `Shared`
  - Keep as shared UI copy source.

## Summary Slice

### Own now

- `src/client/summary-panel.jsx` — `Own`
- `src/client/spending-mix-recharts.jsx` — `Own`

### Should move behind the summary deep module

- summary focus and drill-down helpers currently inside `summary-panel.jsx`
- summary note save workflow currently inline in `summary-panel.jsx`
- category-card route-contract logic from summary to entries

### Shared dependencies summary should consume, not own

- `src/client/category-visuals.jsx`
- `src/client/ui-components.jsx`
- `src/client/formatters.js`
- `src/client/category-utils.js`

### Target note

`summary-panel.jsx` should shrink into orchestration plus rendering. Route
construction, focus derivation, donut shaping, and note-save behavior should
move behind a summary slice API.

## Months Slice

### Own now

- `src/client/month-panel.jsx` — `Own`
- `src/client/month-overview.jsx` — `Own`
- `src/client/month-plan-tables.jsx` — `Own`
- `src/client/month-row-editing.js` — `Own`
- `src/client/month-helpers.js` — `Own`, but should become internal to the
  month slice deep module

### Bridge files

- `src/client/entry-mobile-sheet.jsx` — `Bridge`
  - Used by both month and entries.
  - Decision: keep shared only if the mobile sheet stays truly generic.
  - Otherwise split into `month` and `entries` mobile editors.
- `src/client/table-helpers.js` — `Bridge`
  - Some table behavior is generic, but month-specific row handling should move
    back into the month slice.

### Should move behind the month deep module

- section-open state defaults and persistence
- month metric-card derivation
- plan-link candidate building
- inline editing state transitions
- current-month versus derived-row translation rules

### Target note

The month slice should own a single “month workspace” API that hides row merge
logic, inline edit flows, plan-link selection, and downstream refresh rules.

## Entries Slice

### Own now

- `src/client/entries-panel.jsx` — `Own`
- `src/client/entries-list.jsx` — `Own`
- `src/client/entries-overview.jsx` — `Own`
- `src/client/entry-actions.js` — `Own`
- `src/client/entry-composer-section.jsx` — `Own`
- `src/client/entry-editor.jsx` — `Own`
- `src/client/entry-helpers.js` — `Own`, but should become internal to the
  entries deep module
- `src/client/entry-selectors.js` — `Own`

### Bridge files

- `src/client/entry-mobile-sheet.jsx` — `Bridge`
  - Shared with month right now.
- `src/client/category-edit-dialog.jsx` — `Bridge`
  - If it is entries-specific in behavior, fold it into entries; otherwise keep
    as shared category UI.
- `src/client/query-mutations.js` — `Bridge`
  - Current invalidation logic is cross-slice and broad. Future invalidation
    should be narrowed by each slice.

### Should move behind the entries deep module

- entries route/filter state parsing
- quick-expense draft persistence
- created-split follow-up state
- “filtered row disappears mid-edit” protection rules
- transfer-linking orchestration
- invalidation rules after entry mutations

### Target note

The entries slice should expose one coherent editor workflow API. Components
should not need to understand URL search params, optimistic edit state,
transfer matching, split linkage, and filter semantics independently.

## Imports Slice

### Own now

- `src/client/imports-panel.jsx` — `Own`
- `src/client/import-api.js` — `Own`
- `src/client/import-helpers.js` — `Own`, but should become internal to the
  imports deep module
- `src/client/import-history-model.js` — `Own`
- `src/client/import-history.jsx` — `Own`
- `src/client/import-mapping-stage.jsx` — `Own`
- `src/client/import-preview-auto-refresh.js` — `Own`
- `src/client/import-preview-model.js` — `Own`
- `src/client/import-preview-review.jsx` — `Own`
- `src/client/import-preview-rows-table.jsx` — `Own`
- `src/client/import-select-file-stage.jsx` — `Own`

### Bridge files

- `src/client/settings-dialogs.jsx` — `Bridge`
  - Imports currently opens account creation via settings dialogs.
  - Decision: extract a shared account-form component or create an imports-owned
    statement-account creation dialog.
- `src/client/settings-api.js` — `Bridge`
  - Imports should not depend on broad settings mutations just to create a
    statement-mapped account.

### Should move behind the imports deep module

- source-file detection and parser selection orchestration
- draft metadata defaults by account/view
- preview readiness rules
- statement preview refresh throttling
- recent-import filtering and pagination state
- “create account from statement mapping” workflow

### Target note

The imports slice is already close to a vertical workflow. The main cleanup is
to stop reaching into settings concerns and to hide more of the draft-preview-
commit state graph behind one imports API.

## Splits Slice

### Own now

- `src/client/splits-panel.jsx` — `Own`
- `src/client/split-editing.js` — `Own`
- `src/client/split-helpers.js` — `Own`, but should become internal to the
  splits deep module
- `src/client/split-share-state.js` — `Own`
- `src/client/splits-activity-section.jsx` — `Own`
- `src/client/splits-activity.jsx` — `Own`
- `src/client/splits-api.js` — `Own`
- `src/client/splits-archive-dialog.jsx` — `Own`
- `src/client/splits-breakdown-section.jsx` — `Own`
- `src/client/splits-dialogs.jsx` — `Own`
- `src/client/splits-drafts.js` — `Own`
- `src/client/splits-groups-nav.jsx` — `Own`
- `src/client/splits-linked-entry-dialog.jsx` — `Own`
- `src/client/splits-main-section.jsx` — `Own`
- `src/client/splits-matches.jsx` — `Own`
- `src/client/splits-optimistic.js` — `Own`
- `src/client/splits-selectors.js` — `Own`

### Bridge files

- `src/client/query-mutations.js` — `Bridge`
  - Split mutations currently trigger broad invalidation semantics affecting
    entries, month, and summary.
- `src/client/app-sync.js` — `Shared`, but splits is currently its heaviest
  consumer and should get a slice wrapper.

### Should move behind the splits deep module

- split route-state parsing
- optimistic split activity reconciliation
- archive dialog selection logic
- match-queue dismissal and linking logic
- derived refresh strategy after split mutations

### Target note

Splits is the strongest existing vertical slice. The main change is to isolate
its app-sync and invalidation behavior behind a smaller slice API.

## Settings Slice

### Own now

- `src/client/settings-panel.jsx` — `Own`
- `src/client/settings-accounts-section.jsx` — `Own`
- `src/client/settings-api.js` — `Own`
- `src/client/settings-dialogs.jsx` — `Own`
- `src/client/settings-panel.jsx` — `Own`
- `src/client/settings-reconciliation-dialog.jsx` — `Own`
- `src/client/settings-sections.jsx` — `Own`
- `src/client/statement-compare.jsx` — `Own`

### Bridge files

- `src/client/category-edit-dialog.jsx` — `Bridge`
  - May belong with settings category management if reused there.
- `src/client/imports-panel.jsx` dependency on `settings-dialogs.jsx` and
  `settings-api.js` — `Bridge`

### Should move behind the settings deep module

- settings section-open route and UI state
- account dialog and reconciliation workflow orchestration
- demo/local environment action flows
- category-rule suggestion actions
- unresolved-transfer review actions

### Target note

Settings should become the single reference-data and trust workspace. Other
features should consume its outputs, not reuse its broad APIs directly.

## Shared Client UI

These should remain shared because they are truly presentation-level and not
business-workflow owners.

- `src/client/ui-components.jsx` — `Shared`
- `src/client/ui-options.jsx` — `Shared`
- `src/client/responsive-select.jsx` — `Shared`
- `src/client/category-visuals.jsx` — `Shared`
- `src/client/account-display.js` — `Shared`
- `src/client/formatters.js` — `Shared`

These are shared for now but should stay small:

- `src/client/table-helpers.js` — `Bridge`
- `src/client/category-utils.js` — `Shared`

## Shared Query And Utility Layer

These files should remain shared, but their APIs should get narrower.

- `src/client/query-keys.js` — `Bridge`
  - Keep shared normalization utilities.
  - Future direction: export slice-owned key builders from slice modules, with
    only low-level normalization shared centrally.
- `src/client/query-mutations.js` — `Bridge`
  - Current invalidation helpers are too broad and encode cross-slice policy in
    one file.
  - Future direction: move invalidation ownership into slice-specific mutation
    helpers.
- `src/client/monies-client-service.js` — `Bridge`
  - Current role: one broad client deep module.
  - Future direction: replace with slice deep modules plus a very small shared
    helper layer.

## Server And DTO Contracts

These should remain shared and cross-slice because they define transport
contracts.

- `src/server/json.ts` — `Shared`
- `src/types/dto.ts` — `Shared`

But the DTO file should be organized by slice sections over time:

- summary DTOs
- month DTOs
- entries DTOs
- imports DTOs
- splits DTOs
- settings DTOs
- shared primitives

## Domain And Repository Internals

These are backend internals. They should stay outside client slices but align
to the same vertical language.

### Shared repository entry points

- `src/domain/app-repository.ts` — `Shared`
- `src/domain/app-repository-helpers.ts` — `Shared`
- `src/domain/app-repository-constants.ts` — `Shared`
- `src/domain/app-repository-lookups.ts` — `Shared`
- `src/domain/bootstrap.ts` — `Bridge`
  - Important for app shell and current loading strategy.
  - Future direction: reduce bootstrap responsibility as slice queries grow.

### Summary and month aligned

- `src/domain/app-repository-months.ts` — aligns to `months` and `summary`

### Entries aligned

- `src/domain/app-repository-entries.ts` — aligns to `entries`

### Imports aligned

- `src/domain/app-repository-import-preview.ts` — aligns to `imports`
- `src/domain/app-repository-import-history.ts` — aligns to `imports`
- `src/domain/category-match-defaults.ts` — aligns to `imports` and `settings`

### Splits aligned

- `src/domain/app-repository-splits.ts` — aligns to `splits`
- `src/domain/app-repository-split-batches.ts` — aligns to `splits`
- `src/domain/app-repository-split-sync.ts` — aligns to `splits`
- `src/domain/split-allocation.ts` — aligns to `splits`

### Settings aligned

- `src/domain/app-repository-settings.ts` — aligns to `settings`
- `src/domain/app-repository-categories.ts` — aligns to `settings`
- `src/domain/app-repository-category-match-rules.ts` — aligns to `settings`
- `src/domain/app-repository-checkpoints.ts` — aligns to `settings`
- `src/domain/app-repository-reconciliation-exceptions.ts` — aligns to
  `settings`
- `src/domain/app-repository-audit.ts` — aligns to `settings`

### Demo and environment aligned

- `src/domain/demo-data.ts` — `Shared`
- `src/domain/demo-settings.ts` — `Shared`

## Low-Level Libraries

These stay outside slices because they are low-level parsing or date/csv
utilities.

- `src/lib/csv.ts` — `Shared`
- `src/lib/month.ts` — `Shared`
- `src/lib/statement-import.ts` — `Shared`, import-oriented
- `src/lib/statement-import/uob.ts` — `Shared`, import-oriented
- `src/lib/statement-import/citibank.ts` — `Shared`, import-oriented
- `src/lib/statement-import/ocbc.ts` — `Shared`, import-oriented
- `src/lib/statement-import/xls.ts` — `Shared`, import-oriented
- `src/lib/statement-import/shared.ts` — `Shared`, import-oriented
- `src/lib/statement-import/citibank-activity-csv.ts` — `Shared`,
  import-oriented
- `src/lib/statement-import/ocbc-activity-csv.ts` — `Shared`,
  import-oriented

## Deep-Module Migration Decisions

### Keep shared

- app shell routing and environment setup
- generic UI primitives
- DTO contracts
- low-level csv/month/parser libraries
- narrow error and formatting helpers

### Move behind slice deep modules

- route-state parsing for summary, month, entries, imports, and splits
- slice query key builders
- slice invalidation rules
- slice selectors and derived-view helpers
- slice mutation orchestration
- optimistic update logic owned by a slice
- workflow-specific dialog state and save flows

### Split or narrow soon

- `monies-client-service.js`
- `query-keys.js`
- `query-mutations.js`
- `entry-mobile-sheet.jsx`
- `settings-dialogs.jsx` as used by imports
- `settings-api.js` as used by imports
- `table-helpers.js`

## Recommended Next Refactor Order

This is still planning-only, but the slice inventory suggests the safest order:

1. `Imports`
   - already reads like an orchestrated workflow
   - can be isolated from settings dependencies
2. `Entries`
   - high user impact and has the filtered-row editing edge case
3. `Summary`
   - comparatively small slice with clear drill-down contracts
4. `Months`
   - important but stateful; cleaner after entries and summary contracts settle
5. `Splits`
   - already strong; mostly needs narrowing, not redesign
6. `Settings`
   - broad workspace; easier once other slices stop reaching into it

## Stage 2 Exit Criteria

Stage 2 is complete when:

- every major current file has a target slice or shared classification
- shared code is intentional instead of accidental
- bridge files are explicitly named
- future refactors can move one slice at a time without re-arguing file
  ownership
