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

The page should preserve active matching state while freshness catches up,
instead of replacing the current workflow blindly.

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
- settlement simplification across groups
- checkpoint reopen and late/backdated activity handling
- reversible split deletion and restore from activity history
- travel currency and payment-evidence review
- archive behavior
- linked-entry handling

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep shell-refresh requests explicit and named
- checkpoint membership is immutable until the user explicitly reopens it
- a split group has one designated currency; original foreign amounts remain
  authoritative and cross-currency checkpoint matches require explicit FX
  evidence
- cash records may remain unlinked; card records can remain awaiting statement
  certification until the final ledger amount is imported
- deleting a split archives it from active projections but keeps its ID,
  shares, links, and currency available for restore
- restoring an archived split does not alter an existing checkpoint snapshot

## Known Exceptions / Watch Areas

- split archive behavior may still request shell refresh because the archive
  content rides the main splits payload
- split settle and linked-entry flows should stay narrow unless the mutation
  truly changes shared ledger evidence
