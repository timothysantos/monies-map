# Implementation Prompt Template

Use this template when starting a slice refactor or any non-trivial change.

The goal is to make the prompt specific enough that a smaller model can work
without guessing the architecture.

## Required Prompt Shape

```text
Implement <slice/workflow>.

Read and follow:
- AGENTS.md
- docs/architecture.md
- docs/code-spec.md
- docs/implementation-order.md
- docs/preimplementation-checklist.md
- docs/known-coupling-targets.md
- docs/scenario-catalog.md
- docs/query-map.md
- docs/existing-behavior-guardrails.md
- docs/responsive-behavior.md if the workflow touches mobile/desktop behavior
- docs/interaction-guidelines.md if the workflow touches buttons, dismissals,
  or staged controls

Target slice:
- <slice name>

Target scenarios:
- <scenario ids and short names>

Target coupling rows:
- <known coupling target rows that apply>

Target query contract:
- <query names and invalidation rules>

Constraints:
- keep code within the code-spec rules
- preserve the current behavior guardrails
- update or add tests first
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen bootstrap dependence
- do not widen invalidation beyond the documented contract
- commit the work in small readable batches as the slice progresses
- keep that commit rhythm for later slices unless a slice is explicitly
  reserved for one atomic change

Deliverables:
- code changes for the target slice only
- tests for the target scenarios and coupling rows
- doc updates if a rule proved wrong
```

## When To Use It

- Start of a new slice migration.
- Start of a bug fix that touches query state or money editing.
- Start of any change that could affect mobile workflows or background
  freshness.
- Start of any work that is likely to tempt the model into broad refactors.

## What Makes This Work

- It names the exact docs to read, so the model does not have to discover them.
- It names the scenarios, so behavior stays test-driven.
- It names the coupling rows, so hidden risks are not forgotten.
- It keeps the work inside one slice unless the docs say otherwise.
