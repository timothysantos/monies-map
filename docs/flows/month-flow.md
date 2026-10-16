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

Month has no tab of its own: it is the `Summary` tab with one month of the
header's range picked (`summary-flow.md`). `/month?month=YYYY-MM` deep links
(bookmarks, the Shortcut, guide links) open the Summary tab, marked active,
with that month picked. The header keeps the range (start and end pickers,
arrows that move the range); a range change moves a month the new range no
longer has to the nearest month it has. The month is changed in the phone's
floating island (`‹ Sep 2026 ›`: the arrows step through the range's months
and stop at its ends; the middle opens the "Pick a month" sheet, whose All
months card returns to `/summary`) or in the desktop month row. Every month
choice keeps the range pinned in the URL (`summary_start`, `summary_end`).
The Summary tab link opens All months.

## State Flow

Month state is split between:

- route state for month and scope
- server state for the month page DTO
- workflow state for plan-row editing, notes, and drilldown return
- transient UI state for sheets and dialogs

The page must preserve active edits while background freshness catches up.

The top of the page is one lead card (`MonthLead` in `month-overview.jsx`,
design.md "Lead · Support · Detail"): "Spent · May 2026", the month's actual
spend "of" its planned spend, the bar, the percent of plan and how far under
or over plan. Income (received, with "plan $x"), Saved (with "target $x") and
Remaining budget are one row of three equal columns inside the card, under
the bar, split by hairlines, in text colour only (no tinted boxes); the card
is at most 270 px tall on an iPhone 13 (the groups have room between them,
design.md "Lead rhythm") so Money insights still start above the fold. The
figures are the month page DTO's metric cards plus the month's Summary row
(`buildMonthLeadModel`), so they equal what the six tiles showed; the
Remaining budget column (labelled "Not planned yet" or "Planned more than you earn", "Remaining budget" when money is hidden) opens its explanation. Nothing scrolls sideways at
390 px (`tests/e2e/summary-month-lsd.spec.js`).

The card's Plan | Simple switch (`lead-view.js`, DOMAIN.md "Lead View")
shares Summary's remembered choice (per login, from the app shell) and sets
the page's mode. Simple is "Earned $x · Spent $y" over the savings bar
without its plan bar, with the plan-free facts and no plan line, money jobs
or columns; the insights leave out the plan ones; and "Money in" (income
entries by source, from the month page's own entries) with "Plan this
month" replaces the plan tables, which Plan keeps for editing. Month
opens in Simple, with a plan or without, until a choice is made
(`tests/e2e/lead-simple-view.spec.js`).

Plan view opens with Plan Studio (`plan-studio.jsx`, design.md "Plan
Studio", DOMAIN.md "Plan Studio") in place of the plan tables: a Sliders | List
switch in the toolbar's row (`plan-mode-switch.jsx`, "How to show the plan",
remembered per login, Sliders by default; stored values `studio` and
`tables`) shows one or the other. The sliders stay mounted while List shows, so
held changes survive the switch; a month with nothing planned shows only the
tables. A row's menu reaches the note, the details sheet, matching entries and
removing; "Add a line" and "Add income" open the plan-row sheet (a line with a
due date is stored as a planned item, any other as a budget bucket).
Add to Savings on extra income is one Save plan request (`/api/month-plan/apply-changes`):
it raises the Savings line and raises or creates the person's Extra income
line by the same amount, so Planned in and Savings both rise and Left over does not move. The Month
page DTO carries a small `history` tuple per plan and income row (last month's
plan and actual, the three-month average actual; DOMAIN.md "Plan history") for
the slider popover. It reads the page's income
rows, plan sections and the lead's figures, holds its changes locally (one
Undo stack, Reset to saved) and saves them with one request,
`POST /api/month-plan/apply-changes`, naming each changed row and the amount
it must still hold: all or nothing, 409 when a row changed underneath (the
studio keeps the edits and says so), a failed save keeps them and offers Try
again. After a save the page shows the saved amounts (`isPendingDerived`)
while `runBackgroundRefresh` reloads the month, exactly as after a row edit.
The combined household view is read only (no sliders, Save plan or What
if; the plan tables' own hint says to switch to a person view). Simple view does not load the studio. Proof:
`tests/e2e/plan-studio.spec.js`, `tests/e2e/plan-studio-v2.spec.js`,
`tests/e2e/plan-studio-layout.spec.js`.

The plan tables (Income, Monthly budget, Bills and dated payments) keep their table
markup on every layout and add hierarchy: the item leads, the money columns
are right-aligned, and a thin bar under each actual shows actual against
plan. On the sheet layout each row is a compact card (bubble, item and
category, actual of planned, the bar, the note and the variance) and the
tables never scroll sideways; a tap opens the plan card sheet as before.

Opening a plan row (income, planned items, budget buckets) starts the same
edit on both layouts: inline editing on desktop, the edit sheet on mobile. A
row opens from a click anywhere on the row outside its own controls, or from
the "Edit <label> row" button in the item cell, which is the keyboard path
(Tab, then Enter or Space). One click opens the row once; only the `<tr>`
carries the click handler. The scope pills and match filter chips are toggle
buttons and expose their state with `aria-pressed`.

On the sheet layout the plan-row add and edit sheets are a plan card
(`month-plan-sheet.jsx`, design.md "Lead · Support · Detail"): the planned
amount is the editable lead (decimal keypad), actual against it is a bar
with what is left or over (income: what is still to come), month, owner and
entry count are chips, and Actual ("See the N entries", the same drilldown),
Item name, Category, Date, Account and Note are rows that edit in place.
Cancel and Done are in the bottom bar; the ✕ is a 44px target. Every field,
the draft, the save request and the error handling are the ones the sheet
had; `tests/e2e/lead-support-detail.spec.js` checks the save, Cancel, the
tap targets (44px or more), hidden money and a failed save on an iPhone 13
profile (tagged `@webkit`). There is no client check of the planned amount:
text that is not a number saves as its digits, or $0.00, as before. The
sheet swipes down to close (design.md "Mobile Sheet"): unchanged it closes,
and with a changed planned amount, name, category, day, account or note it
springs back and asks "Discard changes?"; the match sheet counts only the
ticked entries as its draft, not the filters. Like every bottom sheet with a bottom bar
it lifts itself above the iPhone keyboard (`EntryMobileSheet` uses
`use-keyboard-inset.js`), so Done and the focused field stay in sight;
`tests/keyboard-inset.test.mjs` pins the wiring and the hook's behaviour
with a stand-in visual viewport, because a browser test cannot open the
iPhone keyboard.

The mobile edit, add and match sheets are modal dialogs (`EntryMobileSheet`).
Focus moves into the sheet on open and stays inside it. Escape or a backdrop
tap closes it and discards the draft, as the desktop dialogs do. Focus then
returns to the row button or "+ Add bill or dated payment". While a save is in flight,
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
Planned, Actual and Variance stay on screen. "+ Add bill or dated payment", the row
open buttons, the header tabs and the period controls stay on screen and
uncovered, and inline Save and Cancel stay at the visible edge of the table.
From 1,100 to 1,199 px the plan tables tighten a
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
  its cache are shared with Summary's "The accounts shown".
- `GET /api/summary-page` for the range, through the Summary owner
  (`loadSummaryRangeContext` in `App.jsx`): the header's range, the month
  arrows and the month sheet's figures. Coming from All months it is
  already cached under the pinned range, so no request is made; a `/month`
  deep link fetches it once. It is optional for this page: its failure
  never shows the Month error screen, and until it lands the header shows
  the URL's range and the month controls wait. After a Month save clears
  the Summary cache, opening the month sheet reads it again.

The Month lead's savings bar and money jobs read the month's transfers
into and out of investment accounts from `monthPage.investmentMoves`
(optional, left out when both are zero; DOMAIN.md "Money job").

Spending Mix for the picked month (below the money insights, above the
plan tables) reads `monthPage.categoryShareChart` from this DTO
(`selectMonthSpendingMix` in `month-spending-mix.js`): no request of its
own, also on a deep link before the range's Summary page lands. It is the
same projection as the Summary page's `categoryShareByMonth` entry for the
month (`buildDonutChart` over the view's entries in the scope);
`tests/month-spending-mix.test.mjs` holds the two equal for every view and
scope. A category row's arrow opens Entries for that category in this
month and scope (`handleOpenEntriesForActual`, as the tables' Actual
drilldowns). `tests/e2e/month-spending-mix.spec.js` proves it on a phone
and a desktop.

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

On phones, a picked month other than the current month offers Back to this month
when the current month is in the displayed range. It uses the same month-choice
navigation, keeping person, scope and range. Default scope text makes room on
the island row; non-default scope stays visible with a separate context row.
