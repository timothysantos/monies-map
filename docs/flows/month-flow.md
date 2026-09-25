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

The mobile edit, add and match sheets are modal dialogs (`EntryMobileSheet`).
Focus moves into the sheet on open and stays inside it. Escape or a backdrop
tap closes it and discards the draft, as the desktop dialogs do. Focus then
returns to the row button or "+ Add planned item". While a save is in flight,
Escape is ignored, so a failed save keeps the sheet and its draft.

"Save matches" in the match dialog (desktop) or sheet (mobile) shows
"Saving...", takes one submit, and ignores Escape and Cancel until the save
settles. A failed save keeps the dialog or sheet open with the draft and an
inline error. Only a successful save closes it and refreshes the month.
Saving a category from inside a Month sheet saves only the category.

If the Month page fails to load after navigation, it shows the page error
panel with "Try loading again" instead of the previous page. An empty
match picker says "No matching expense entries fit the current filters."

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
