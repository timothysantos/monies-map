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
`Direct` / `Shared` / `Both` switch under the `Summary` title (what each counts
is its tooltip; it adds no header height), on a phone the scope section of the
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
month cards. It uses the account-pill DTO for account health and drilldown.
Spending Mix follows the tab's month choice and has no month chips of its
own: on All months it shows the whole range (`categoryShareChart`); with a
month picked the Month page shows that month's (`month-flow.md`). The
section is shared (`spending-mix-section.jsx`) and shows the Entries empty
state ("No spend rows in this view.") when there is no spending. The month sheet and the desktop month row read the same
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

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep drilldown return behavior narrow and non-destructive

## Known Exceptions / Watch Areas

- explicit shell refresh is still available for named reference-data flows, but
  it is not the default Summary path
- summary account-pills remain a separate query surface and must stay aligned
  with note and drilldown behavior
