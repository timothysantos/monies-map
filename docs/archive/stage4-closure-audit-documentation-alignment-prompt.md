# Stage 4 Closure Audit + Documentation Alignment Prompt

Use this prompt when the implementation slices are complete and the remaining
work is documentation alignment, flow mapping, and closure auditing.

This prompt is intentionally focused:

- start from the parent flow
- link to one flow doc per page
- require route flow, state flow, and data flow in every doc
- audit the docs against the current implementation
- update the docs and tests together when the audit finds drift

It is not a product-slice implementation prompt. It is a closure and
documentation-alignment prompt.

## Required Document Set

Before closing Stage 4, keep these docs aligned:

- `docs/stage4-flow-index.md`
- `docs/flows/stage4-parent-flow.md`
- `docs/flows/summary-flow.md`
- `docs/flows/month-flow.md`
- `docs/flows/entries-flow.md`
- `docs/flows/imports-flow.md`
- `docs/flows/splits-flow.md`
- `docs/flows/settings-flow.md`

Each page-flow doc must include:

- route flow
- state flow
- data flow
- ownership notes
- visible user contract
- persisted/query contract
- known exceptions / watch areas
- audit status

## Closure Audit Rules

Before marking the documentation work complete, verify all of the following:

- the parent flow links to every page-flow doc
- each page-flow doc starts from the parent flow and then narrows to the page
- route flow matches the current browser route behavior
- state flow matches the current ownership boundaries
- data flow matches the current API/query contract
- the docs do not reintroduce broad shell ownership or legacy bootstrap
- the docs do not describe stale behaviors that tests no longer prove
- the docs do not omit known exception paths such as explicit shell refresh or
  other named escape hatches

## Update Discipline

If a flow doc changes the expected contract, the same change must also update:

- the relevant test file or scenario coverage
- the implementation note or audit if the behavior changed
- the slice prompt if the closure criteria changed

Do not treat the documentation pass as cosmetic. Treat it as a contract
alignment task.

## Closure Target

This documentation phase is complete only when:

- the parent flow and all page-flow docs are current
- the flow docs agree with the code and tests
- the closure audit is honest about remaining risks
- the repo has a single navigation entry point for Stage 4 flow behavior
- each page-flow doc includes its known exception / watch area section
