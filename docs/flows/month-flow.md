# Month Flow

This doc describes the Month page flow in three parts:

- route flow
- state flow
- data flow

## Route Flow

Route entry:

- `/month`

The route state carries the selected view, month, and scope. The browser URL
remains the source of truth.

## State Flow

Month state is split between:

- route state for month and scope
- server state for the month page DTO
- workflow state for plan-row editing, notes, and drilldown return
- transient UI state for sheets and dialogs

The page must preserve active edits while background freshness catches up.

Opening a plan row (income, planned items, budget buckets) starts the same
edit on both layouts: inline editing on desktop, the edit sheet on mobile. A
row opens from a click anywhere on the row outside its own controls, or from
the "Edit <label> row" button in the item cell, which is the keyboard path
(Tab, then Enter or Space). One click opens the row once; only the `<tr>`
carries the click handler. The scope pills and match filter chips are toggle
buttons and expose their state with `aria-pressed`.

## Data Flow

Month data comes from:

- `GET /api/month-page`

Month mutations may also cause targeted refreshes in:

- `entries`
- `summary`
- `splits`

when the mutation semantics require it.

## Ownership Notes

Month owns:

- month planning and budgeting
- note editing
- plan-link editing
- drilldown return behavior

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep route returns settled but non-destructive

## Known Exceptions / Watch Areas

- drilldown return behavior intentionally preserves the active workflow instead
  of hard-resetting the page
- month refresh may still fan out to dependent slices when the mutation touches
  real ledger evidence
