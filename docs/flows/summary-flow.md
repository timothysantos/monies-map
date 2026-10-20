# Summary Flow

This doc describes the Summary page flow in three parts:

- route flow
- state flow
- data flow

## Route Flow

Route entry:

- `/summary`

Summary is the "All months" choice of the one `Summary` tab, which also
covers the Month page (`/month`, one month of the range picked; see
`month-flow.md`). The tab's month control picks between them: on a phone
the floating island beside the View and scope trigger (`All months ▾`,
opening the "Pick a month" sheet), on desktop and tablet the month row
under the header. Picking a month goes to `/month?month=YYYY-MM` and pins
the range on screen into the URL (`summary_start`, `summary_end`), reusing
the Summary page already loaded under the pinned key
(`seedPinnedSummaryPage`), so no request repeats. The Summary tab link
always opens `/summary`. Design: design.md, "Summary Tab Month Choice".

The route may include view, scope and range parameters (`summary_focus`, the
old Spending Mix month chip, is ignored). `App.jsx` reads
the URL and keeps the selected Summary view in sync with browser location. In a
person view the scope control sets `scope`: on desktop and tablet the compact
`Direct` / `Shared` / `Both` switch in the title row after "Viewing • name",
above the full-width lead (what each counts is its tooltip), on a phone the scope section of the
floating View and scope bar's dialog, with a line saying what the scope
counts (the desktop switch is not rendered there). Both show the scope of the
Summary request whose figures are on screen. On a phone the bar also switches
the view, and the header's view pills are hidden as on Month and Entries.

## State Flow

Summary state is split between:

- route state for the selected view, scope and focus
- server state for the summary page DTO and account pills
- workflow state for note editing and drilldown return behavior

The page should preserve drilldown continuity without turning Summary into a
general routing controller.

## Data Flow

Summary data comes from:

- `GET /api/summary-page`
- `GET /api/summary-account-pills`

The page uses the summary page DTO for range metrics, category share, and
month cards. The range metrics show as one lead card (`summary-lead.jsx`,
design.md "Lead · Support · Detail" and "Summary lead"): spend against
plan with a bar, the percent of plan and how far under or over, then Income
(with planned income) and Saved (with the savings target). Wider than a
phone the card takes the full width and Income and Saved are its stat
strip beside the money jobs (two columns from a 960 px card,
`tests/e2e/summary-plan-layout.spec.js`); a phone shows them as two pills
under the card. They read the
DTO's six metric cards (`buildSummaryLeadModel`), so the figures are the
cards' own; `tests/e2e/lead-support-detail.spec.js` compares them with the
API on a phone and a desktop. The savings bar's invested also reads the
DTO's optional `investmentMoves` (transfers into and out of investment
accounts over the range, DOMAIN.md "Money job";
`tests/e2e/investment-transfers.spec.js`). It uses the account-pill DTO for account health and drilldown.
Intent vs Outcome is one compact card per month, newest first
(`summary-intent-outcome.jsx`): the lead is the month's spend against its
plan with the bar, the percent of plan and how far under or over; planned and
actual income are chips; a "Details" row folds the old table's income, spend
and savings rows (planned, actual, variance) and the month note, open for
the latest month only. The month name opens the month and the note row edits
the note. Every figure is the summary DTO's month row
(`buildIntentMonthCard`); nothing scrolls sideways at 390 px, and hidden
money shows dots with only the bar's track
(`tests/e2e/summary-month-lsd.spec.js`).

The Plan | Simple switch (`lead-view.js`, DOMAIN.md "Lead View") sets the
page's mode. The panel builds the lead model once (`buildSummaryLeadModel`);
the default is Simple (a login that never chose, with a plan or without,
and while loading), and the login's choice wins (Settings > Summary view
sets the same choice): it comes on `GET /api/app-shell`
(`leadView`, only for a signed-in login that chose) and a switch saves it
with `POST /api/viewer-preferences/lead-view`; without a login the device
keeps it. Simple shows the model's `simple` figures and facts, Money
insights without the plan ones (`withoutPlanSignals`), and in Intent vs
Outcome's place "Earned vs spent by month" (`simple-detail.js`, lazy, from
the same DTO's `months` and `categoryShareByMonth`). The page request does
not change with the mode (`tests/e2e/lead-simple-view.spec.js`).
Both modes' month card (Simple's "Earned vs spent by month", Plan's Intent vs
Outcome) opens with the column + line chart when the range has two or more
months (`earned-spent-chart.js`, lazy, handed React by the panel so the first
screen gains no shared chunk; model `earned-spent-chart-model.js`; nothing is
fetched, the series are the card's own months). Simple draws Earned and Spent
columns and a Kept line (below zero when overspent); Plan draws Earned and
Spent columns and a Planned spending line (the month's `estimatedExpensesMinor`,
no point where it is 0). Each column and point is an openable figure with the
month as its period (`pointFigure`): View entries, Open plan on the plan
figures, Ask about this, like a Spending Mix slice; the legend chips hide and
show a series. The panel mounts it only while money shows, behind an invisible
placeholder of the chart's height (`.earned-spent-chart-reserve`); the chart
draws nothing when money is hidden. Proof:
`tests/earned-spent-chart-model.test.mjs`, `tests/earned-spent-chart-dom.test.mjs`,
`tests/e2e/earned-spent-chart.spec.js`.
Spending Mix follows the tab's month choice and has no month chips of its
own: on All months it shows the whole range (`categoryShareChart`); with a
month picked the Month page shows that month's (`month-flow.md`). The
section is shared (`spending-mix-section.jsx`) and shows the Entries empty
state ("No spend rows in this view.") when there is no spending. Its donut has
no labels on it; a ranked list (`.summary-mix-row`: bubble, name, amount, share
and bar; the top five, then "Show all N") carries them, and a row's main tap
hides the slice, its bubble edits the category and its arrow opens Entries
(`design.md`, "Summary body"; `tests/e2e/summary-body-lsd.spec.js`). Wallets in
view is one `DetailRows` group of wallet rows (name, freshness, balance) from
`/api/summary-account-pills`; a row opens Entries for the wallet. An
investment account with an imported iFAST or StashAway statement carries `investmentValue`
(`{ valueMinor, asOfDate }`, only when it has one, so a household without any
adds nothing to the payload) and its freshness line reads "$x on 30 Sep
2026, as the statement says" (`describeAccountHealth`); it is a statement
figure, never a balance or a forecast, and hidden money drops the whole line
(`tests/e2e/ifast-statement-import.spec.js`, `tests/e2e/stashaway-statement-import.spec.js`). The month sheet and the desktop month row read the same
DTO's `rangeMonths` and `months` (`realExpensesMinor` against
`estimatedExpensesMinor`); they add no request.

A request with both range bounds sends the range end as its `month`
(`buildSummaryPageParams`), because the Worker anchors only an implicit
range on `month`: every month of a pinned range shares one cache entry, the
key the mutation invalidations already used.

## Ownership Notes

Summary owns:

- summary metrics
- summary account pills
- summary note edits
- category-card and month-card drilldowns (a month card picks that month,
  like the month control)

`tests/e2e/summary-month-choice.spec.js` proves the month choice on a phone
and a desktop.

A person view reads its entries through `adjustEntriesForView`, so a
transfer with a purpose (DOMAIN.md "Transfer Purpose") is the sender's
spending and the receiver's payback in its category, in the sending entry's
month; the person month totals Summary reads follow. The household view is
unchanged (`tests/transfer-purpose-projections.test.mjs`).

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep drilldown return behavior narrow and non-destructive

## Known Exceptions / Watch Areas

- explicit shell refresh is still available for named reference-data flows, but
  it is not the default Summary path
- summary account-pills remain a separate query surface and must stay aligned
  with note and drilldown behavior

The All months island stays unchanged. Picking an older month opens Month;
when the current month belongs to the displayed range, its island offers
Back to this month through the existing month-choice navigation.

Summary/Month header period and More pages popovers consume outside presses and
lock background interaction until dismissed. A picked month uses Month's
route-owned phone plan actions; All months has no slider draft or Undo action.
