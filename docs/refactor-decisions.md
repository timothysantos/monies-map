# Refactor Decisions

This document records the current intended answers to the remaining design
questions before the first slice refactor lands.

It is narrower than `docs/architecture.md`, `docs/code-spec.md`, and
`docs/implementation-order.md`. Those docs define the plan. This one answers
the open shape questions that are still likely to cause drift if left implicit.

Use this document with:

- [`docs/preimplementation-checklist.md`](./preimplementation-checklist.md)
- [`docs/known-coupling-targets.md`](./known-coupling-targets.md)
- [`docs/implementation-prompt-template.md`](./implementation-prompt-template.md)

## 1. App Shell Shape

Current intended shape:

- `App.jsx` remains the route shell, top-level composition layer, and
  migration bridge.
- `App.jsx` should own route selection, shell-level loading, and cross-tab
  coordination.
- if a slice introduces a replacement path, the old path must be removed in
  the same slice once the new path passes the slice tests; compatibility
  fallbacks are not allowed to linger as hidden debt.
- Slice-specific query orchestration, data shaping, and invalidation should move
  out of `App.jsx` as each slice gets its own query boundary.

Do not keep:

- page-specific shaping logic that belongs to a slice
- mutation invalidation rules that only one slice needs
- derived state graphs that can live in selectors or slice helpers

Exit signal:

- `App.jsx` reads like shell composition, not like a hidden dashboard service.

## 2. Shared Helpers

Current intended rule:

- a helper stays shared only if at least two slices need the same stable
  concept and the public API stays small.
- otherwise the helper belongs behind a slice deep module.

Shared helper candidates should be judged by:

- whether the helper is truly domain-stable
- whether the helper hides query, state, and mutation details cleanly
- whether the helper can be named in `DOMAIN.md`
- whether the helper is still used without becoming a dependency knot

Do not keep shared:

- logic that only looks shared because the current app is still monolithic
- helpers that mix formatting with persistence or invalidation

Exit signal:

- `monies-client-service.js` stays thin and intentional, not a dumping ground.

## 3. Mobile Flows

Current intended rule:

- a mobile flow is a distinct workflow only when the container, workflow lock,
  or save/dismiss behavior materially differs from desktop.
- a mobile flow is a wrapper when it is only a responsive container around the
  same underlying workflow state and contract.

Decision rule:

- if the workflow must survive refresh, broadcast invalidation, or sheet close
  differently on mobile, treat it as a separate workflow.
- if only layout changes, treat it as the same workflow with a responsive
  wrapper.

Practical targets:

- entries quick entry and entry edit are protected workflows on mobile.
- month and split dialogs are separate only where their save, dismiss, or
  focus contracts differ in behavior, not merely in layout.

Exit signal:

- mobile-specific code is present only where the workflow behavior actually
  differs.

## 4. Money Editing Primitive

Current intended rule:

- money editing should converge on one shared draft contract for the common
  behavior: type a replacement value, preserve the draft while editing, and
  normalize on blur.
- the primitive should track both visible draft text and minor-value state.

Required behavior:

- replacement typing should not require select-all.
- backspace and overwrite should work naturally.
- blur should normalize the visible string.
- shared behavior should work across entries, month budgets, splits, and import
  reconciliation fields.

Do not keep:

- ad hoc money-input behavior that resets the draft differently in each slice
- focus handling that forces select-all as the default interaction

Exit signal:

- money fields behave consistently across core workflows, even if the container
  differs.

## 5. Bootstrap Dependencies

Current intended rule:

- bootstrap is compatibility only, not the target architecture.
- slice work should cut over to the new path in the same change whenever
  possible instead of keeping both old and new paths alive.
- any bootstrap dependency that survives a slice move is a bug unless the same
  slice explicitly documents why the old path must remain and removes it before
  the slice is considered complete.

Migration rule:

- the first slice should reduce bootstrap usage, not add a new hidden fallback.
- after a slice has a query boundary, that slice should own its route data and
  invalidation.
- if a page still needs bootstrap during migration, the fallback must be narrow
  and obvious in the code, and it must be deleted in the same slice once the
  replacement passes the slice tests.

Exit signal:

- `bootstrap` no longer acts as the default source for unrelated screens.

## 6. Invalidation Shape

Current intended rule:

- use the narrowest exact query key set that can be defended by the scenario
  catalog and current behavior guardrails.
- broad query buckets are migration scaffolding, not the final contract.

Decision rule:

- if a mutation only affects one slice, invalidate that slice and only the
  dependent slices named in the query map.
- if the mutation affects a shared aggregate, invalidate the aggregate query
  explicitly rather than falling back to a broad bucket.
- if a workflow lock is active, mark stale first and defer visible replacement.

Exit signal:

- invalidation is readable from the mutation site without guessing which other
  page happened to depend on it.

## 7. What This Means For The First Slice

For the first slice refactor:

- keep the shell and compatibility shape in `App.jsx` only as long as needed
- move slice-specific query and mutation work behind the slice boundary
- use the shared money primitive where it exists; otherwise add it as a small
  shared helper with explicit tests
- remove hidden broad invalidation as soon as the slice owns its query contract

## 8. Stop Condition

If the code proves one of these decisions wrong, update this document before
continuing the refactor.
