# OCBC 360 Statement-Then-Activity Reconciliation Audit

Date: 2026-06-29

## Problem

The May 2026 OCBC 360 PDF statement matched when imported first. After importing
the later `TransactionHistory_20260628140517.csv` current-activity export, the
May statement checkpoint showed a delta of `$1,459.12`.

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

Two gaps caused the false mismatch:

1. The OCBC 360 activity parser used `Transaction date` as the import date and
   stored `Value date` only as a note. That made the June-cleared `$1,000.00`
   row count inside the May statement period.
2. The duplicate suppression path did not recognize the same `$459.12` bill
   payment after the CSV reordered the PDF tokens around the reference number.
   The PDF text looked like `BILL PAYMENT INB 452419... INTERNET BANKING`, while
   the CSV text looked like `BILL PAYMENT INB INTERNET BANKING ...452419...`.

## Implemented Fix

- OCBC 360 bank activity imports now use `Value date` as the ledger date used by
  statement checks and checkpoints.
- When `Transaction date` differs from `Value date`, the parser preserves the
  transaction date as `transaction date: YYYY-MM-DD` context.
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
    on `2026-06-02` and preserves `transaction date: 2026-05-31`.
  - proves the interest row imports on value date `2026-05-30` with transaction
    date context.
- `tests/e2e/import-ledger-flow.spec.js`
  - imports a synthetic OCBC 360 May PDF statement and saves a matched May
    checkpoint.
  - imports a later current-activity CSV with the reordered `$459.12` bill
    payment and the May-transaction-date/June-value-date `$1,000.00` transfer.
  - verifies the bill payment is skipped as already statement-certified.
  - verifies the `$1,000.00` row imports on `2026-06-02`.
  - verifies the May checkpoint delta remains `0` after the activity import.

## Repair Guidance For Existing Production Data

This fix prevents the issue on the next import. If the bad CSV batch was already
committed before this fix, the safest repair is:

1. Roll back the affected OCBC 360 current-activity import batch.
2. Reimport `TransactionHistory_20260628140517.csv` after deploying this fix.
3. Confirm the May 2026 OCBC 360 statement checkpoint returns to `Matched`.

Do not delete individual ledger rows first unless rollback is unavailable. The
import batch is the audit boundary, and rollback preserves the ability to
replay the corrected parser and matching behavior.
