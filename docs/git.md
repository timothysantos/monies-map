# Product Workflow Guide

This guide is a short product-facing snapshot of Monie's Map. Keep it aligned
with [`faq.md`](faq.md) when import,
reconciliation, splits, or account workflows change.

## Core Features

- Multi-person household views for Household, Primary, and Partner.
- Monthly planning with income rows, planned items, and flexible budget buckets.
- Entries ledger with direct, shared, income, expense, and transfer rows.
- Splits workspace for manual shared expenses, named groups, settle-up records,
  and matching ledger expenses into shared batches.
- Account settings with institutions, owners, account types, opening balances,
  statement checkpoints, checkpoint history, and statement comparison.
- Category colors and icons used consistently by charts, category cards, and
  editing surfaces.
- CSV import with column mapping, row-level preview, ownership/category/account
  edits, duplicate highlighting, row removal, and commit.
- Supported PDF statement import for UOB, Citibank, and OCBC statement formats
  that include embedded text.
- Supported UOB current-transaction `.xls` and Citibank credit-card activity
  `.csv` imports for mid-cycle working ledger updates.
- Import traceability, recent import history, rollback, overlap context, and
  statement certification checks before commit.

## Account And Statement Setup

Use statement-backed setup when adding a new account:

1. Create the account in Settings with the right institution, account type, and
   owner. For a joint account, mark it as shared or owned by the household model
   used in the app.
2. Choose the first statement you trust as the starting point.
3. Set the account opening balance to the balance immediately before the first
   imported statement activity. This gives the ledger a known baseline.
4. Import the first statement, or use Compare statement from Settings if rows
   were already added manually.
5. Review the statement account mapping. This is especially important for banks
   that print similar labels, such as UOB One versus UOB One Card.
6. Commit rows only after duplicates, transfer directions, ownership, category,
   and split decisions look right.
7. Save the statement checkpoint once the computed ledger matches the statement
   ending balance.

For credit cards, enter checkpoint balances as the positive amount owed shown by
the bank. The app handles the internal liability sign when comparing the ledger.

## Two-Month Import Scenario

This is the intended flow when a user starts with one statement, then keeps the
next month useful before the next statement closes.

### Month 1: Establish The Baseline

Create the account cards first, for example Citi Rewards, Citi Miles, UOB One,
and OCBC 360. For each account, enter the opening balance from the first
statement baseline. Then import the first statement PDF or CSV.

During preview, check:

- the statement account maps to the intended app account
- the owner follows the mapped account when the account belongs to one person
- transfers are marked as transfers, not income or expense
- shared rows that belong in Splits are promoted or handled intentionally
- duplicate-looking rows are removed before commit
- the statement checkpoint end balance matches the projected ledger

After commit, the account should show a reconciled statement checkpoint. That is
the proof that the ledger is correct through that statement period.

### Month 2: Use Mid-Cycle Downloads As Working Ledger

Before the second statement arrives, download current activity exports when you
want the Month and Entries pages to stay current. Examples are UOB current
transaction `.xls` exports or Citi card activity CSVs. For Citi activity CSVs,
choose the matching Citibank credit-card account before uploading so the
headerless file is parsed with the right account context.

Import only rows that happen after that account's latest statement cutoff. For
example, if the latest Citi Rewards statement includes transactions through
8 Apr 2026, and a downloaded activity CSV covers 1 Apr to 13 Apr, treat 1 Apr to
8 Apr as already-statement-covered and keep only 9 Apr onward rows. Do this per
account: Citi Rewards, Citi Miles, UOB One, and OCBC 360 can each have different
cutoff dates.

Those mid-cycle rows are useful immediately:

- Month actuals update while the month is still in progress.
- Entries can be categorized while the details are still fresh.
- Transfers can be linked instead of left unresolved.
- Shared expenses can be added into Splits without waiting for the statement.
- Planned items can be matched to ledger entries during the month.

Mid-cycle rows are working ledger evidence, not the final reconciliation proof.

### Month 2 Close: Reconcile Against The Statement

When the second statement arrives, compare or import it against the ledger:

1. Upload the statement PDF in the import flow or use Compare statement from the
   Settings account card.
2. Confirm the detected statement period and account mapping.
3. Let the PDF statement certify matching mid-cycle rows. The statement updates
   bank-facing facts such as posted date, description, amount, and direction,
   while preserving user annotations such as categories, notes, splits, and
   links on the existing ledger row.
4. Review overlap warnings only when the statement cannot certify the existing
   row set. They are account/date-range warnings and may be valid when a
   mid-cycle import already covered part of the statement.
5. If the checkpoint is off, use comparison details to find missing rows, extra
   rows, wrong income/expense direction, or duplicate-looking ledger rows.
6. Once the ledger matches the statement balance, save the new statement
   checkpoint.

This keeps planning useful during the month while still making the bank
statement the final proof. Do not silently delete provisional rows that are
absent from the statement; treat them as extra ledger evidence that needs an
explicit correction, reversal, or rollback decision.

## Splits Workflow

Splits are intentionally separate from the bank ledger.

Use Entries for bank and card facts. Use Splits for shared-expense decisions:
who paid, who owes, which group it belongs to, and whether it has been settled.

Common paths:

- Add a manual split expense directly in Splits when the bank row is not needed
  yet.
- Open a ledger entry and use Add to splits when the bank row already exists.
- Review Matches when imported shared-looking rows need to be connected to a
  split batch.
- Record Settle up to close an open batch; the history remains visible for
  context.

Keeping this boundary prevents the import screen from becoming a place for every
shared-expense decision. Imports should get the ledger correct first; Splits can
then model the human settlement layer.

## Import Safety Notes

- Supported PDF and spreadsheet files are parsed in the browser. The backend
  receives parsed rows and checkpoint fields, not the original local file.
- Import preview can be cleared with Start over before anything is committed.
- Commits create an import batch so a bad import can be rolled back without
  deleting unrelated ledger rows.
- Duplicate highlighting is advisory. If the highlighted row is genuinely a
  separate transaction, keep it. If it is already in the ledger, remove it from
  the preview before commit.
- Statement checkpoints should be saved only when the ledger matches the bank
  statement balance for that account and period.
