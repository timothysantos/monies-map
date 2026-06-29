# OCBC 360 Statement-Then-Activity Reconciliation Audit

Date: 2026-06-29

## Problem

The May 2026 OCBC 360 PDF statement matched when imported first. After importing
the later `TransactionHistory_20260628140517.csv` current-activity export, the
May statement checkpoint showed a delta of `$1,459.12`, then `$1,000.00` after a
rollback/reimport left one legacy row whose value date was only present in the
note.

## Findings

The current-activity CSV contained rows that crossed the statement boundary:

- `BILL PAYMENT ... 4524192012247528`, `$459.12`, transaction date
  `2026-05-29`, value date `2026-05-29`.
- `FUND TRANSFER ...`, `$1,000.00`, transaction date `2026-05-31`, value date
  `2026-06-02`.
- `INTEREST CREDIT`, `$2.14`, transaction date `2026-05-31`, value date
  `2026-05-30`.

The PDF statement already contained the `$459.12` bill payment and the `$2.14`
interest credit. The `$1,000.00` current-activity row had a May transaction date
but a June value date, so it belongs to June statement reconciliation, not to the
May statement checkpoint.

Three gaps caused the false mismatch and confusing ledger display:

1. The OCBC 360 activity parser used `Transaction date` as the import date and
   stored `Value date` only as a note. That made the June-cleared `$1,000.00`
   row count inside the May statement period.
2. The duplicate suppression path did not recognize the same `$459.12` bill
   payment after the CSV reordered the PDF tokens around the reference number.
   The PDF text looked like `BILL PAYMENT INB 452419... INTERNET BANKING`, while
   the CSV text looked like `BILL PAYMENT INB INTERNET BANKING ...452419...`.
3. The OCBC 360 PDF parser treated disclosure and transaction-code pages as
   continuation text for the preceding transaction when those pages appeared
   before the next transaction row. That could create a huge ledger description
   from legal boilerplate instead of stopping at the transaction boundary.

## Implemented Fix

- OCBC 360 bank activity imports now use `Value date` as the ledger date used by
  statement checks and checkpoints.
- When `Transaction date` differs from `Value date`, the parser preserves the
  transaction date as both structured import metadata and visible
  `transaction date: YYYY-MM-DD` context.
- Existing OCBC 360 bank rows with a legacy `value date: YYYY-MM-DD` note are
  repaired on schema startup by moving that value into `post_date` when the row
  had no separate posted date yet. This makes the May `$1,000.00` row belong to
  June statement reconciliation without deleting or reimporting it.
- The OCBC 360 PDF parser now stops transaction continuation text at disclosure,
  transaction-code, page-header, and footer sections.
- Exact duplicate suppression now has a narrow certified-statement fallback for
  same-account, same-amount, date-window matches where the normalized source
  descriptions share enough reordered tokens. This lets the later CSV skip the
  already-certified `$459.12` PDF row without weakening general matching.
- The domain and code-spec docs now state the bank-account accounting rule:
  value, cleared, or posted date is the reconciliation date; transaction date is
  event evidence.

## Regression Tests

- `tests/parser-contract.test.mjs`
  - proves the near-real OCBC 360 CSV fixture imports the `$1,000.00` transfer
    on `2026-06-02` and preserves `transaction date: 2026-05-31` plus structured
    transaction/value date fields.
  - proves the interest row imports on value date `2026-05-30` with transaction
    date context.
  - proves OCBC 360 PDF disclosure and transaction-code text cannot be swallowed
    into a transaction description.
- `tests/e2e/import-ledger-flow.spec.js`
  - imports a synthetic OCBC 360 May PDF statement and saves a matched May
    checkpoint.
  - imports a later current-activity CSV with the reordered `$459.12` bill
    payment and the May-transaction-date/June-value-date `$1,000.00` transfer.
  - verifies the bill payment is skipped as already statement-certified.
  - verifies the `$1,000.00` row imports on `2026-06-02`.
  - verifies the May checkpoint delta remains `0` after the activity import.
  - recreates the legacy bad row shape where the row date is `2026-05-31` and
    the note says `value date: 2026-06-02`, then verifies May checkpoint health
    repairs to delta `0`.

## Repair Guidance For Existing Production Data

The app now repairs the affected legacy row shape automatically on the next
server request after deployment. A user should refresh the app and confirm the
May 2026 OCBC 360 statement checkpoint returns to `Matched`.

Rollback and reimport are still valid if a broader bad batch needs audit review,
but they are no longer required for the `$1,000.00` value-date-only note case.
Do not delete individual ledger rows first unless both automatic repair and
batch rollback are unavailable.
