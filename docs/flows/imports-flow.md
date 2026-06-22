# Imports Flow

This doc describes the Imports page flow in three parts:

- route flow
- state flow
- data flow

## Route Flow

Route entry:

- `/imports`

The route state carries the active view, month, and any import-context
parameters. The browser URL is the source of truth.

## State Flow

Imports state is split between:

- route state for the current view and month
- server state for the imports page DTO
- workflow state for upload, preview, mapping, certification, and rollback
- transient UI state for the staged import UI

The page should preserve preview and mapping state while the user is in the
workflow, and it should not rely on decorative chrome as a readiness contract.

## Data Flow

Imports data comes from:

- `GET /api/imports-page`

Import mutations may also refresh:

- `entries`
- `month`
- `summary`
- `summary-account-pills`

when the import changes shared ledger evidence or reference data.

## Ownership Notes

Imports owns:

- file upload and preview
- account mapping
- commit and rollback
- certification and duplicate review
- statement mismatch diagnostics, including balance breakdown rows that explain
  likely account, row direction, skipped-row, or unmatched-ledger causes and
  link ledger diagnostic rows back to Entries in a new tab with row-specific
  month and wallet filters; unmatched ledger rows mean the preview did not
  certify a unique PDF match, not that the rows are definitely absent from the
  PDF. When a diagnostic bucket exactly matches the statement difference, the
  preview says whether correcting those ledger matches or including skipped PDF
  rows should reconcile the statement
- non-destructive statement preview auto-refresh; transient refresh failures
  must keep the current reviewed preview visible

## Audit Status

Current status: aligned with tests and runtime behavior.

Watch area:

- keep readiness checks tied to actual page controls and API response state

## Known Exceptions / Watch Areas

- explicit shell refresh remains a named exception when imports create shared
  reference data such as a new account
- imports readiness should stay tied to actual controls, not decorative chrome
