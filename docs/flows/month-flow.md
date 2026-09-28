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

"Mobile" here means the Month sheet layout (`MONTH_SHEET_LAYOUT_QUERY`): a
phone, or a portrait tablet up to 1024 px wide. On a portrait tablet the
rest of the page keeps its desktop layout, and the sheet still opens as a
bottom sheet over a dimmed backdrop, inside the visible viewport, with its
Save and Cancel buttons in reach. Saving a new item keeps the sheet open
with a fresh item. `tests/e2e/mobile-sheet-focus.spec.js` ("Month sheet on a
portrait tablet") checks this at 900×1200 and 820×1180 with touch, and that
Entries keeps its desktop editor at those sizes.

From 761 to 1,099 px wide (tablets in either orientation, small laptops)
the Month page fits the screen and never scrolls sideways. The plan tables
fit whole from about 900 px (notes wrap to two lines); narrower than that,
the Account and Note columns scroll inside the table while Category, Item,
Planned, Actual and Variance stay on screen. "+ Add planned item", the row
open buttons, the header tabs and the period controls stay on screen and
uncovered, and inline Save and Cancel stay at the visible edge of the table.
From 1,100 to 1,199 px the plan tables and summary cards tighten a
little (narrower cell padding, notes cut off earlier on one line) so the
full tables fit whole, also with wider fonts, and every note's edit icon
stays on screen. The phone layout and 1,200 px and wider are unchanged.
`tests/e2e/month-mid-width-layout.spec.js` checks 820×1180 (full mobile
emulation, sheet layout) and 1024×768 (inline editing).

"Save matches" in the match dialog (desktop) or sheet (mobile) shows
"Saving...", takes one submit, and ignores Escape and Cancel until the save
settles. A failed save keeps the dialog or sheet open with the draft and an
inline error. Only a successful save closes it and refreshes the month.
Saving a category from inside a Month sheet saves only the category.

Every other Month write also waits for the server. Deleting a plan or income
row, saving a row note or the month note, and duplicating, resetting or
deleting the month each show that they are working, send one request, and on
failure keep the row, draft, popover or dialog open with an inline error.
Totals and the table never show a change the server did not accept. Reset
month and delete month open their confirmation dialogs from the Actions menu
(before this fix the dialogs closed with the menu and could not be used).

After a plan row save (the mobile edit sheet, desktop inline editing, or a row
note) the row shows the saved values while the month reloads in the
background. Reopening the row before that reload lands opens its editor on
the amount and note just saved, not the values from before the save
(`buildSavedMonthPlanFields` in `month-state.js` writes both the shown and the
source fields). `month-save-checks.spec.js` holds the reload to check this on
both layouts.

If the Month page fails to load after navigation, it shows the page error
panel with "Try loading again" instead of the previous page. An empty
match picker says "No matching expense entries fit the current filters."

## Data Flow

Month data comes from:

- `GET /api/month-page`
- `GET /api/summary-account-pills` for the view, fetched beside it: the
  Accounts section's balances and statement health and the money check-in's
  statement-gap Quick fix (a statement that does not match). The query and
  its cache are shared with Summary's "Wallets in view".

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
