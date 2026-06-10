# Stage 4 Flow Index

This is the parent entry point for the Stage 4 route, state, and data flow
docs.

Start here, then open the page-specific flow doc that matches the route you are
auditing. This is a navigation index, not a mega-doc.

## Parent Flow

- [`docs/flows/stage4-parent-flow.md`](./flows/stage4-parent-flow.md)

## Page Flows

- [`docs/flows/summary-flow.md`](./flows/summary-flow.md)
- [`docs/flows/month-flow.md`](./flows/month-flow.md)
- [`docs/flows/entries-flow.md`](./flows/entries-flow.md)
- [`docs/flows/imports-flow.md`](./flows/imports-flow.md)
- [`docs/flows/splits-flow.md`](./flows/splits-flow.md)
- [`docs/flows/settings-flow.md`](./flows/settings-flow.md)

## Audit Rule

Every page-flow doc must contain:

- route flow
- state flow
- data flow
- ownership notes
- the visible user contract
- the persisted/query contract
- known exceptions / watch areas
- audit status

If any of those sections are missing or stale, update the doc and the matching
test coverage before considering the Stage 4 doc set complete.
