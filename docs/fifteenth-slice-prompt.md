# Fifteenth Slice Prompt

Use this prompt for the next import workflow slice after the dialog and smoke
cleanup work is in place.

This slice is intentionally focused:

- recent imports loading state after commit/import finalization
- inline import completion confirmation in the recent imports section
- auto-refresh of recent imports after a successful import commit
- consistent loading language with the rest of the app
- desktop and mobile import flows

It is not a rewrite of the import parser, preview model, or statement
classification rules. It is also not an excuse to broaden route ownership or
rework the import commit payload.
It is not a retrofit of every save/edit/delete workflow in the app.

## Clarify The User-Facing Goal

When the user clicks the final import action for CSV, XLS, or PDF imports, the
recent imports section should immediately show a visible loading state while
the commit is in flight. Use the app's existing loading language and styling
instead of inventing a new one:

- `app-spinner`
- `messages.common.loading`
- `messages.common.loadingLatest`
- `messages.common.saving`
- `messages.common.working`

Once the import finishes successfully, the recent imports section should show
an inline completion confirmation for that committed batch and then refresh to
show the latest import history without requiring a manual reload.

The user-visible behavior should remain stable across desktop and mobile, and
the loading state should be visible in the same workflow context where the
commit was triggered.

## Loading-State Interpretation

Use local mutation feedback as the default.

For a user-triggered save/edit/delete/restore/import action:

- the action button should show a pending state and be disabled while the
  mutation is in flight
- the surrounding section should show scoped loading only when that section is
  refreshing
- successful completion should be confirmed near the workflow context
- background refresh must not erase active workflow state
- do not use a global top loading bar as the only mutation feedback

For this slice, apply the rule only to the final import commit and
recent-imports refresh path.

Do not retrofit all entry, split, month, summary, or settings actions in this
slice.

## Focus Of The Slice

Keep the work narrow:

- show a clear loading affordance in the recent imports section while the final
  import commit is running
- surface an inline success state for the committed import batch
- refresh the recent imports section automatically after a successful commit
- preserve the existing preview and commit flow semantics
- preserve the existing import ledger, summary, and month refresh behavior
- keep recent-imports loading state local to the imports workflow, not route or
  app-shell loading state

## What Not To Change

Do not reinterpret import matching, reconciliation, certification, or commit
semantics during this slice.

Do not broaden the import parser or the preview model to solve a presentation
problem.

Do not convert unrelated workflows into this same loading pattern unless the
current import commit path proves they need the same contract.

Do not widen app-shell loading, route loading, or background refresh behavior
to solve this import-specific UX.

Do not add a new loading package in this slice.
Do not clear recent imports while refreshing if stale content can stay visible.
Do not turn the final import action into a global page loading state.

## Read First

Read and follow:

- `AGENTS.md`
- `docs/architecture.md`
- `docs/code-spec.md`
- `docs/implementation-order.md`
- `docs/preimplementation-checklist.md`
- `docs/known-coupling-targets.md`
- `docs/scenario-catalog.md`
- `docs/query-map.md`
- `docs/existing-behavior-guardrails.md`
- `docs/responsive-behavior.md` if the workflow touches mobile/desktop layout
- `docs/interaction-guidelines.md` if the workflow changes buttons or staged
  import controls
- `docs/tanstack-query-language.md`

## Target Scenarios

Add or update tests that prove:

- the final import action shows a loading state in the recent imports section
- a successful import commit shows an inline confirmation before refresh
- the recent imports section refreshes automatically after commit
- the import flow behaves the same on mobile and desktop
- the behavior works for at least one tabular import path and one PDF import
  path without re-testing parser semantics

## Target Coupling Rows

Watch for coupling between:

- import commit completion and recent-import list refresh
- inline confirmation state and background refresh timing
- preview commit state and recent-import history state
- desktop import page and mobile import page shared behavior

## Query Contract

If the slice changes query ownership or invalidation, keep it precise:

- import commit should invalidate only the data needed for recent imports and
  any directly affected workflow surfaces
- avoid widening invalidation to unrelated routes
- preserve the existing shell and route loading contracts

## Constraints

- keep code within the code-spec rules
- preserve the current behavior guardrails
- update or add tests first
- use runtime proof for user-facing behavior, not source inspection alone
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen bootstrap dependence
- do not widen invalidation beyond the documented contract
- commit the work in small readable batches as the slice progresses
- finish with a closure audit for the slice before declaring it complete
- never mark a slice complete unless tests and runtime behavior prove the slice
  contract

## Deliverables

- code changes for the recent-import loading and confirmation flow only
- tests for the target scenarios and coupling rows
- doc updates only if a rule proved wrong

## Post-Slice Audit Checklist

After the slice, the audit must answer all of the following:

1. Did the recent imports section show a loading state during commit?
2. Did a successful commit surface an inline confirmation before refresh?
3. Did the recent imports section refresh automatically after commit?
4. Were both desktop and mobile flows verified in runtime?
5. Were the tests added or updated?
6. Did the implementation stay within the import workflow boundary?
7. What remains incomplete?
8. What should the next slice not take on?
9. Is the final verdict honest?
10. Did the final import button enter a disabled/pending state during commit?
11. Did the recent imports section show scoped loading without blanking
    unrelated page content?
12. Did the implementation avoid global route/app-shell loading for this local
    mutation?
13. Did the slice define the broader mutation-loading rule without retrofitting
    unrelated workflows?
14. Was any new loading package added? If yes, why was existing app loading
    language insufficient?
