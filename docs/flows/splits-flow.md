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
scrolled away on a phone. On a wide screen the active groups become direct
buttons inside the compact navigation bar alongside Summary, Entries, Splits
and Ask; its list button still opens every group. On a long Splits page, the
translucent directional button appears briefly at the bottom centre: scrolling
down offers the bottom and scrolling up offers the top.

The open group's lead card (see design.md, "Splits page: lead card, search,
activity list") is also a presentation of the page DTO: `buildSplitsLead`
(`splits-lead-model.js`) turns the open group, the viewer and the money
privacy state into the figure, its tone, the plain words and who it is with,
and the group's spend is the spend of its open period: the search-filtered
expenses that no settle-up has covered (`summariseGroupSpend`, the same
`settlementStatus` the entry count and balance use), labelled "Spent since
last settle-up" once the group was ever settled and "Group spend" while it
never was. The household view shows that spend as its figure, captioned with
the same words. The breakdown donut is built on the page from the same
activity (`buildOpenPeriodDonut`, `split-open-period.ts`); a person view charts
that person's own share and says "Your share since last settle-up" ("Your
share" while never settled). Every figure on the page reads the one open set
(DOMAIN.md, "Group Spend (open period)"); the Just for fun lines count the
whole group and, once anything was settled, say "(settled or not, since 2
Apr)". Its buttons call the same handlers the old summary strip and
page head did (Settle group, Activity history, + Add expense, Simplify
settlement, the category breakdown); the page head keeps Review matches and,
on a wide screen, Simplify settlement. In the bank-match review
(`split_mode=matches`) the card is not rendered and the review shows its own
lead with Back. The search box (`split_search`) is unchanged and sits under
the card.

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

The dialogs and panels share the Lead · Support · Detail blocks: Record
settlement is `SplitSettlementCard` in the phone sheet, the wide dialog and
inline in the list (the household view and an archived batch open it
read-only; the draft, validation and save are unchanged), Create group is
`SplitGroupCard`, and the simplified settlement and the bank-match review are
`SplitsCheckpointPanel` and `SplitMatchesList`. View included activity on the
open simplified settlement opens its collapsed section and scrolls to the
first included row.

The activity list shows only open records (`buildSplitActivitySections`,
`splits-settled-sections.js`, called by `buildSplitsPanelModel`). Records a
settlement checkpoint covers (`partitionActivityBySettlement`,
`split-open-period.ts`: any status but `reopened` or `voided`, the same rule
as the chip and the balance) sit in one collapsed section per checkpoint at
the end: "Settled up on 27 Aug · 287 entries · $28,823.06" (expense totals of
this group's covered records; "Simplified on <date>" while an open or partly
matched checkpoint is not marked paid). The section's rows render only when it
is open; which sections are open is `openSettlementIds` in `SplitsPanel`
(reset with the view). A search narrows both parts and opens every section
with a match; the section holding the open inline card is open too. Rows
inside keep the settled behaviour above (read-only card, reason and Undo on
top). Archived batches (`splits-archive-dialog.jsx`) lists each settlement
above the closed batches; choosing one closes the sheet, opens the section and
scrolls to it.

### Settled sections load on demand

The page does not send the records a settled section holds
(`docs/audits/splits-settled-collapsed/README.md`, "Settled rows load on
demand": production's 352 settled records were ~300 kB of every Splits
load). It sends:

- the open records and closed batches (`splitsPage.activity`), read with the
  `outside-settled-sections` scope (`SplitRecordScope`,
  `app-repository-splits.ts`);
- one summary per settlement and group (`splitsPage.settledSections`:
  checkpoint, group, date, paid, entry count, expense total, currency),
  counted in SQL (`loadSettledSectionSummaries`, `split-settled-history.ts`);
- for each group with a settled section, its whole-group facts
  (`splitsPage.groupFacts`, `split-group-facts.ts`) for the Just for fun
  lines, counted in SQL in one batch of grouped statements
  (`loadSplitGroupFacets`);
- the settlement checkpoints without `includedRecordIds`.

Both keys are left out while nothing is settled. The rows load through
`useSettledSplitRows` (`splits-settled-rows.js`), one TanStack Query entry
each, via the shell's `fetchRequiredQuery`:

- opening a section: `GET /api/splits/settled-rows?view&checkpoint&group`
  (built exactly as the page built them, `buildSplitActivityForView`, so the
  read-only card's lock and Undo come with them; household-scoped, view
  filtered, newest first, at most 2,000 per kind with `truncated`). On a wide
  screen a hover or focus on the heading reads ahead (`startOptionalQuery`).
  Loading shows the spinner and "Loading..."; a failure "We couldn't reach
  your data just now." with Try again; a failed read never retries by itself;
- a search: `GET /api/splits/settled-search?view&group&q`, after a 250 ms pause
  in typing, returns the group's settled records that match with the page's
  own rule (`splitActivityMatchesSearch`, `src/domain/search-text.ts`, shared
  by page and Worker), at most 500. The page narrows them by the current words,
  shows their sections opened with the matches' own count and total, and holds
  back "nothing matches" until the server answered;
- a deep link (`editing_split_expense`) to an expense not in the page:
  `GET /api/splits/settled-rows?view&record` reads its section (and fills that
  section's entry), then the group and section open and the card opens
  read-only.

A split save or undo clears every `splits-settled-` entry with the page's
own (`clearSplitMutationCaches`, App.jsx), so open sections read again.
Ask's answers (`buildSplitsPageDto` groups and checkpoints, Ask lookups and
turn resolution, which build their own full projection) and the settle-up
sheet read balances and checkpoints, not the settled rows, so they are
unchanged. `tests/splits-settled-lazy.test.mjs` proves the page, every
section's rows, the facts and every check-in line equal the old full page on
seeds; `tests/e2e/splits-settled-lazy.spec.js` the browser behaviour.

## Data Flow

Splits data comes from:

- `GET /api/splits-page`
- `GET /api/splits/settled-rows` and `GET /api/splits/settled-search`, on
  demand (see "Settled sections load on demand")

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
- browser coverage for the lead card, the flat activity list and the
  restyled dialogs and panels lives in `splits-lead-card.spec.js`
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
- the category breakdown donut is built on the page from the open group's
  open expenses (`deriveGroupFigures` in `splits-selectors.js`), formatted in
  that group's currency. The page sends no donut of its own, so there is no
  second copy to disagree with the chip. Yen are never added to dollars
  (DOMAIN.md, "Split currency in charts"); `split-currency-display.test.mjs`,
  `atomic-writes-travel-split-home-amounts.test.mjs` and
  `splits-figures-agree.test.mjs` cover it
- bank-match suggestions (`split_mode=matches`): besides rows that share a
  description word, a row with the exact amount and date is suggested when it
  is the only one ("Same amount and date as this split expense"); a row
  another split already holds is never suggested. Rules in DOMAIN.md, "Split
  Match Suggestion"; `split-match-exact-suggestion.test.mjs` and
  `splits-exact-match-suggestion.spec.js` prove them
- a travel split's shares stay in its currency in Splits; Entries, Month,
  Summary and the stored month totals count each person's SGD share of the
  linked ledger row instead (DOMAIN.md, "Home share of a travel split")

On phones, the existing floating group bar gains a separate Clear button while
`split_search` is active. It calls the existing search updater with an empty
value, keeping group, month and person, and does not open the group sheet.
