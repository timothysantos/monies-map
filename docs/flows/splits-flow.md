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
- archive behavior
- linked-entry handling

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep shell-refresh requests explicit and named

## Known Exceptions / Watch Areas

- split archive behavior may still request shell refresh because the archive
  content rides the main splits payload
- split settle and linked-entry flows should stay narrow unless the mutation
  truly changes shared ledger evidence
