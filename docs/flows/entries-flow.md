# Entries Flow

This doc describes the Entries page flow in three parts:

- route flow
- state flow
- data flow

## Route Flow

Route entry:

- `/entries`

The route state carries the active view, month, and entry filters. The browser
location is the source of truth for the current filter contract.

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

- route filter parsing
- row editing
- quick-entry persistence
- add-to-splits behavior
- delete behavior

## Audit Status

Current status: aligned with tests and runtime behavior.

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
