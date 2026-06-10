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
- build domain-first before UI when the slice introduces new business behavior
- keep distinct semantics distinct when multiple projections or review surfaces
- keep route/page orchestration thin and extract services or view-models when a
  page starts carrying too many responsibilities
- use runtime proof for user-facing behavior, not source inspection alone
- do not keep the old path alive once the new path is verified in the same
  slice
- do not widen bootstrap dependence
- do not widen invalidation beyond the documented contract
- commit the work in small readable batches as the slice progresses
- keep that commit rhythm for later slices unless a slice is explicitly
  reserved for one atomic change
- finish with a closure audit for the slice before declaring it complete
- never mark a slice complete unless tests and runtime behavior prove the slice
  contract
- if the slice includes a deliberate exception, name it, test it, and keep it
  isolated instead of letting it become the new default path

Deliverables:
- code changes for the target slice only
- tests for the target scenarios and coupling rows
- doc updates if a rule proved wrong

## Post-Slice Audit Checklist

After each slice, the audit must answer all of the following:

1. Did the implementation match the slice contract?
- State clearly whether the intended slice goal is complete, partial, or not met.

2. Was the runtime behavior verified?
- Confirm whether the user-visible behavior was checked in the real runtime, not
  only in source or mocks.

3. Are the projections consistent?
- Verify whether all visible surfaces that represent the same reality stay
  synchronized.

4. Are corrections or review behaviors consistent?
- If the slice introduces edits, deletes, merges, restores, or review flows,
  confirm they work across every relevant surface.

5. Were the tests added or updated?
- List the test files that prove the slice behavior.
- Call out any missing coverage as a weakness.

6. Were docs updated?
- Confirm whether user docs, in-app help, repo rules, or slice audits were
  updated.

7. What remains incomplete?
- State the exact remaining gap, not just a general risk.

8. What should the next slice not take on?
- Preserve slice boundaries so future work does not blur into the current slice.

9. Is there any orchestration pressure?
- Call out large routes, monolithic pages, or growing coordination layers that
  should be extracted later.

10. Is the final verdict honest?
- Mark the slice complete only if the contract is proven.
- Otherwise mark it incomplete and explain why.
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
