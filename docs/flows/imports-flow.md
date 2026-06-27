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
  expose hover/focus explanations with the exact statement date window; ledger
  diagnostic rows link back to Entries in a new tab with row-specific month and
  wallet filters and can be deleted inline after confirmation. Ledger diagnostic
  lists with multiple rows also expose a confirmed "Delete all" action for cases
  where the whole unresolved set is known to be absent, duplicated, or on another
  account. Unmatched ledger rows mean the preview did not certify a unique PDF
  match, not that the rows are definitely absent from the PDF. Diagnostic lists
  return the full row list, and row date labels distinguish ledger transaction
  dates from PDF posted dates and event dates. When an unresolved list exactly
  matches the statement difference, the preview says whether correcting those
  ledger matches or including skipped PDF rows should reconcile the statement.
  Already-matched PDF rows are collapsed by default when a statement closes
  because they are audit context, not required user action. UOB card PDF
  matching normalizes foreign-currency description suffixes such as `USD 5.58`,
  so a ledger row like `OPENAI OPENAI.COM US` can certify against
  `OPENAI OPENAI.COM USD 5.58` when the account, amount, and
  date evidence align. When a real ledger row falls inside the transaction-date
  period but the bank PDF omits it because it posted after the statement cutoff,
  diagnostics expose two non-delete corrections: set the exact posted date when
  the bank app shows it, or defer the row to the next statement by setting a
  provisional posted date to the day after the current statement end. Both
  actions keep the event transaction date intact for spending history while
  moving statement reconciliation to the cleared/post date
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
