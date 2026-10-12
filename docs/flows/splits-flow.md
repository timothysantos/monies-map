# Splits Flow

This doc describes the Splits page flow in three parts:

- route flow
- state flow
- data flow

## Route Flow

Route entry:

- `/splits`

The route state carries the active view and month. The browser URL remains the
source of truth for the current split workspace.

## State Flow

Splits state is split between:

- route state for view and month
- server state for the splits page DTO
- workflow state for split creation, matching, settling, and archive behavior
- settlement checkpoint state for simplification, transfer matching, and reopen
- split activity-history state for recovery and audit review
- transient UI state for dialogs and responsive controls

The group strip (see design.md, "Splits group strip") is a presentation of the
page DTO's groups: the open group is the `split_group` address parameter, and
with none the group this viewer used last (localStorage, per view) or the
default. New and All sit in a column beside the tile scroller; All opens the
All groups sheet, and a floating bar shows the open group once the strip has
scrolled away on a phone.

The page should preserve active matching state while freshness catches up,
instead of replacing the current workflow blindly.

Empty group, activity, search, match and history states use the shared
`EmptyState`. When there are no matches, the match review says so once, not
twice. Dialog form errors are `InlineError` alerts.

Selecting a split expense row opens the split expense card. On a wide screen
it opens inline in the list in place of the row, like the Entries inline
editor (the `splitInlineEditor` page flag, no dialog; the lead card across the
top and the Detail rows in two columns, with Date, Paid by and Paid using
edited from their Support chips and the share editor opened from a share row
or the shares chip); a phone opens the
sheet, and the household view and an archived batch open the dialog. The
`editing_split_expense` deep link opens the same card the same way. Enter
and Space on the focused row open it, Escape and Cancel close it and the row
takes focus back. Deleting from the card asks in the app first and closes the
card when the split is gone. A settlement row edits in its own form. A
settled split expense (`settlementCheckpointId` or `isArchived`) opens the
same card read-only: "Settled on <date>. Undo the settle-up to change it." or
"Simplified on <date>. Undo the simplification to change it." on top, its Undo
button directly under, no Save or Delete; after the undo the card is
editable in place. The server refusal below stays as the backstop (a stale
page, an entry save, a settlement row).

## Data Flow

Splits data comes from:

- `GET /api/splits-page`

Split mutations may also refresh:

- `entries`
- `month`
- `summary`

and may trigger shell refresh only when the explicit refresh plan says so.

## Ownership Notes

Splits owns:

- split creation
- matching
- settle-up behavior
- settlement simplification across groups of the same currency
- checkpoint reopen and late/backdated activity handling
- reversible split deletion and restore from activity history
- travel currency and payment-evidence review
- archive behavior
- linked-entry handling

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep shell-refresh requests explicit and named
- checkpoint membership is immutable until the user explicitly reopens it,
  and so are the settled facts of its records: a Splits edit or delete, or an
  Entries save that would move a linked split, is refused with
  `split_settlement_locked` and the form (for a split expense, the read-only
  card) offers `Undo simplification`
  (`settlement-lock-notice.jsx`); an edit never reopens a checkpoint by itself
- a closed group batch (settled by a settle-up) locks its records the same
  way; the refusal names the `batchId` and offers `Undo settle-up`, which the
  archived batch view also offers. It reopens the batch (or moves its records
  into the group's open batch), keeps the settle-up as open activity and
  refreshes Splits
- a split group has one designated currency; original foreign amounts remain
  authoritative and cross-currency checkpoint matches require explicit FX
  evidence
- cash records may remain unlinked; card records can remain awaiting statement
  certification until the final ledger amount is imported
- deleting a split archives it from active projections but keeps its ID,
  shares, links, and currency available for restore
- restoring an archived split does not alter an existing checkpoint snapshot
- a refused restore (for example, already restored in another tab) shows its
  error inside the Activity history dialog and refreshes the page data
- browser coverage for creating an expense through `+ Add expense`, a JPY
  cash-only travel group and restoring from Activity history lives in
  `splits-add-expense-dialog.spec.js`, `splits-travel-group.spec.js` and
  `splits-history-restore.spec.js`
- a new expense opens as the create expense card (`split-expense-card.jsx`,
  design.md "Lead · Support · Detail") in the phone sheet and the wide
  dialog; editing or viewing a saved split keeps the form. The card edits the
  same draft with the same calls (`updateSplitExpenseDraft` for the total,
  share percent and share amount), so the request is unchanged; each
  person's share row comes from `split-share-rows.js`, which only reads the
  draft (`split-share-rows.test.mjs` proves 50/50, uneven, odd-cent and
  over-total shares add up to the total).
  `lead-support-detail-sheets.spec.js` proves the saved totals and shares
  for an even and an uneven split, the existing refusals, tap targets and
  hidden money on a phone
- the new expense dialog is titled "New split expense" (editing keeps "Edit
  split"). On a phone the expense dialog is a bottom sheet that swipes down
  to close: unchanged it closes; changed since it opened
  (`buildComparableSplitDraft`) it springs back and asks "Discard changes?"
  (`sheet-swipe-dismiss.spec.js`). The settlement dialog does not swipe yet

## Known Exceptions / Watch Areas

- split archive behavior may still request shell refresh because the archive
  content rides the main splits payload
- split settle and linked-entry flows should stay narrow unless the mutation
  truly changes shared ledger evidence
- `Settle group` closes only the selected group's current batch and does not
  create a checkpoint; simplification remains optional
- active simplified checkpoints are scoped by currency, so an SGD checkpoint
  does not block an independent JPY checkpoint
- a foreign-currency group shows its amounts in the group currency with that
  currency's own digits: the group pill balance, the summary strip totals, the
  expense dialog's share preview and odd-cent labels, activity cards, history
  rows and archived settle-up summaries (a ¥12,000 expense shows
  "Spend JP¥12,000"). All format through `formatCurrencyMinor` (see
  `design.md`, Split Currency Display Contract);
  `splits-travel-group.spec.js` and `currency-money-format.test.mjs` cover it,
  including money privacy masking
- the category breakdown donut is per currency: the page sends the SGD chart
  as `donutChart` and one chart per other currency with open expenses in
  `donutChartsByCurrency` (left out when there are none), and the panel shows
  the active group's currency through `selectSplitDonutChart`, formatted in
  that currency. Yen are never added to dollars (DOMAIN.md, "Split currency
  in charts"); `split-currency-display.test.mjs` and
  `atomic-writes-travel-split-home-amounts.test.mjs` cover it
- a travel split's shares stay in its currency in Splits; Entries, Month,
  Summary and the stored month totals count each person's SGD share of the
  linked ledger row instead (DOMAIN.md, "Home share of a travel split")
