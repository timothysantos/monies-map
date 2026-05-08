# Known Coupling Targets

This document records the audit findings that should become explicit tests or
contract checks before and during the Stage 4 refactor.

Use it together with:

- [`docs/preimplementation-checklist.md`](./preimplementation-checklist.md)
- [`docs/implementation-order.md`](./implementation-order.md)
- [`docs/scenario-catalog.md`](./scenario-catalog.md)
- [`docs/query-map.md`](./query-map.md)

## Target List

| Risk area | What should be tested | Primary slice | Test level |
| --- | --- | --- | --- |
| `src/client/App.jsx` bootstrap coupling | Shell state, route fallback, cache reset, and cross-tab restore stay coherent while bootstrap is being retired | `app shell` then `summary`, `month`, `entries` | `Integration` and `E2E` |
| `src/client/query-mutations.js` broad invalidation | Mutation invalidation hits only the affected queries and does not fan out to broad buckets unless the docs allow it | `entries`, `month`, `summary`, `imports`, `settings` | `Integration` |
| `src/client/splits-dialogs.jsx` amount focus/select behavior | Amount inputs do not force select-all just to replace a value; focus should not create a keyboard trap | `splits` | `E2E` |
| `src/client/entry-editor.jsx` amount typing contract | Editable amount fields preserve typed draft state and normalize on blur without requiring select-all | `entries` | `E2E` |
| `src/client/month-panel.jsx` month amount editing | Month budget and planned amount fields accept replacement typing naturally and normalize after blur | `months` | `E2E` |
| `src/client/import-preview-review.jsx` and statement compare amount editing | Import and reconciliation money fields follow the same typing and normalization contract as entries | `imports` | `E2E` |
| Mobile sheets versus desktop editors | Same workflow versus separate workflow is deliberate, and workflow locks protect active sheets from background freshness | `entries`, `months`, `imports` | `E2E` |
| `src/client/monies-client-service.js` helper facade boundaries | Shared helper APIs stay small, and slice-specific logic does not leak back into the facade | all slices, especially `entries` and `months` | `Integration` |

## How To Use This List

- Treat each row as a test target, not just a note.
- If a row affects a user-visible workflow, add or tighten a scenario first.
- If a row is mostly a boundary or cache issue, add or tighten a contract test.
- If a row spans multiple slices, start with the slice most likely to own the
  workflow lock or query boundary.

## Stop Condition

If a new refactor uncovers another repeated coupling pattern, add a row here
before moving more code.
