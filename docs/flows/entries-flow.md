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
- A failed Entries page load inside the Entries owner (`entries-data-owner.js`)
  still ends loading silently and keeps the last page. When the route-level
  page load fails, the shell shows the page error panel instead.
