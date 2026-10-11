# Entries Flow

This doc describes the Entries page flow in three parts:

- route flow
- state flow
- data flow

## Route Flow

Route entry:

- `/entries`

The route state carries the active view, month, and entry filters. The browser
location is the source of truth for the current filter contract, read and
written in one module (`entry-filter-params.js`, shared with the Ask page's
answers):

- `entry_search` (words every row must contain), `entry_wallet` (account
  ids, repeated), `entry_category` (names, repeated), `entry_type`,
  `entry_id` (the check-in's links), `entries_scope`;
- `entry_min` / `entry_max`: an amount limit in dollars, compared with the
  amount the row shows for the view. Only an Ask answer sets them; the
  filters' Reset clears them;
- `from_ask=1`: the filters came from an Ask answer's `Open in Entries`.

None of these ride along to another tab (`sanitizeTabParams`).

The From Ask chip (`entries-ask-chip.jsx`, design.md "From Ask chip") shows
while `from_ask=1` and a list filter are in the URL: "From Ask · Groceries ·
over $50.00 ✕". It names the filters as the URL now has them. Its main
button goes back to `/ask` (view, month and scope), where the conversation
is as it was; ✕ removes the list filters and `from_ask` and keeps the view,
month and scope. On a phone it floats just above the View and scope bar,
left of the + button; on a wide screen it sits at the top of the list.

`editing_entry=<entryId>` links one entry's editor (from Splits, Settings,
import review, a reload, or Add to splits keeping the open entry in the
URL). The param is the only source of the linked entry; the panel keeps no
copy of it. It acts on each param value once (`linked-entry-request.js`):
it opens that entry when this month's rows have it, or treats the link as
handled when that editor is already open. A handled link never reopens the
editor while the param is still in the URL, so saving (which closes the
editor, waits for its refresh, then removes the param) or closing cannot
bounce the editor back open. A new param value, including the same entry
linked again after the param was removed, opens it again. Closing or
saving the editor removes the param with a replace navigation.

## State Flow

Entries state is split between:

- route state for view, month, and filters
- server state for the entries page DTO
- workflow state for quick-entry, inline editing, add-to-splits, and delete
- transient UI state for mobile sheets and dialogs

The page should keep rows visible while draft edits are in progress and only
apply the final contract on save.

Empty views use the shared `EmptyState` ("No entries match this view.", or
the wallet-view mismatch block with its two view buttons). The mobile add
and edit sheets are modal dialogs. Escape closes them, except while a save
or delete is in flight, and focus returns to the opener. Sheet errors are
announced as alerts.

The edit sheet (phone) and the inline editor (wide screen) both render
`EntryEditCard` (`entry-edit-card.jsx`, design.md "Lead · Support ·
Detail"): a lead card with what it was and the amount, Support chips, and
Detail rows. It patches the same draft through the same `updateEntry`,
`updateEntryAmount` and owner handlers the grid editor used, so the saved
payload is unchanged; the Splits row runs the same Add to splits / View
split actions, Delete entry goes through the in-app confirmation, and a
statement-certified entry keeps its bank facts read-only (description,
amount, date, wallet, posted date; type within its direction). The phone
sheet's bottom bar holds Delete entry (and Delete split once linked),
Cancel or Close, and Save; while Add to splits asks for a group, the bar
becomes the group question (`EntrySplitGroupPickerFooter`). The add sheet
(composer) still uses the grid form (`EntryEditorFields`).

## Data Flow

Entries data comes from:

- `GET /api/entries-page`

Entries mutations may also refresh:

- `month`
- `summary`
- `splits`

depending on the kind of change and whether the row change affects ledger
evidence.

## Ownership Notes

Entries owns:

- route filter parsing (through `entry-filter-params.js`) and the list
  filtering and totals (`entry-filtering.js`), which the Ask page's answers
  run too, so an answer and this page always agree
- row editing
- quick-entry persistence
- add-to-splits behavior
- delete behavior

## Audit Status

Current status: aligned with tests and runtime behavior
(`tests/ask-filter-answer.test.mjs` proves an Ask answer equals this page
for the same filter; `tests/e2e/ask-search.spec.js` the From Ask chip).

Watch area:

- keep filtered rows visible while edits are still draft-only

## Known Exceptions / Watch Areas

- draft-only row edits should remain visible until the user saves
- add-to-splits and transfer-link behavior may fan out to month and summary
  refreshes when ledger evidence changes
- a save that would move a linked split held by an active simplified
  settlement is refused whole (409 `split_settlement_locked`); the editor and
  phone sheet show the reason with `Undo simplification`, which reopens the
  settlement and invalidates Splits, and the draft is kept for a second save.
  A linked split in a closed group batch is refused the same way, naming the
  `batchId`, with `Undo settle-up` (`POST /api/splits/batches/reopen`)
- the editor reads a cleared or unreadable amount as 0. `POST
  /api/entries/update` refuses an `amountMinor` it is sent that is not
  greater than zero (400 "Amount must be greater than zero", the create
  rule) before any read or write, so the editor and phone sheet keep the
  draft and show the reason. An update that leaves `amountMinor` out
  keeps the stored amount (`tests/entry-update-amount.test.mjs`,
  `tests/e2e/entries-zero-amount.spec.js`)
- When the route-level page load fails, the shell shows the page error panel.
  When only the Entries owner (`entries-data-owner.js`) learns that the
  month failed, the panel shows the same `ErrorPanel` with "Try loading
  again" in place of its figures and rows. This happens when a cross-tab
  save during a month switch cancels the shell's load. The previous month's
  rows are never shown, and the month is never called empty. A failed
  reload over this month's own rows shows the refresh notice instead.
- A deep-linked editor that bounced back open after Save was proven on
  2026-09-26 (the link stayed pending while the save waited for its
  refresh). `entries-deep-link-editor.spec.js` holds that refresh to prove
  the editor stays closed, for a deep link and after Add to splits.
- The category dialog opened from a sheet, the composer or a row stops its
  submit, click and key events, so saving it never saves or opens the
  surrounding entry.
- `lead-support-detail-sheets.spec.js` proves the edit card in WebKit on an
  iPhone 13 and in Chromium: the saved fields, the certified lock, the
  in-app delete confirmation, tap targets of 44 px or more with 8 px apart,
  hidden money, and Tab order in the wide-screen editor.
- Known gap (unchanged by the card): an amount that is not a number reads as
  zero, as in the grid form, and the update endpoint accepts a zero amount.
