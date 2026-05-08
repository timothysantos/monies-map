# Pre-Implementation Checklist

Use this checklist before any non-trivial refactor or feature update.

It is meant to be reusable across the current refactor and future work.
Keep it short. If a change needs a larger audit, split the audit by slice.

## 1. Confirm The Contract

- Identify the slice, workflow, or shared boundary being changed.
- Read `AGENTS.md` and the smallest set of task docs that apply.
- Confirm the relevant scenarios exist in `docs/scenario-catalog.md`.
- Confirm the relevant query and invalidation rules exist in `docs/query-map.md`
  or, if the change is not query-related, in the appropriate specialist doc.

## 2. Check For Hidden Coupling

- Find whether the current code path depends on `bootstrap` directly.
- Find whether helpers are truly slice-local or only pretending to be shared.
- Find whether a shared helper is mixing query, formatting, and mutation logic.
- Find whether a mobile sheet is a wrapper around the desktop flow or a
  separate workflow.
- Find whether money formatting is stored as display state, draft state, or
  normalized minor state.

## 3. Verify Behavior Risk

- Check whether the change can clobber an active workflow.
- Check whether the change can widen invalidation more than the docs intend.
- Check whether the change can trigger visible reload churn during save, focus,
  or tab sync.
- Check whether the change affects the amount-edit typing contract.

## 4. Decide The First Slice Move

- Prefer the slice with the clearest scenarios and the fewest hidden
  dependencies.
- Prefer the slice whose query boundary most reduces bootstrap dependence.
- Prefer contract tests before moving helper code.

## 5. Stop Conditions

- Stop and update docs if the code proves a documented boundary is wrong.
- Stop and split the work if one slice really contains two workflows.
- Stop and add a scenario if a user-visible behavior exists but is not captured.
- Stop and widen the audit only if the first targeted pass reveals a repeated
  coupling pattern.

## 6. Output Of The Audit

When the checklist is used, record:

- what was verified
- what was still hidden or ambiguous
- what doc changed
- what slice should move first
