# Legacy Ledger Ownership Repair Audit

Date: 2026-07-06

## Summary

Legacy ledger entries can still have `transactions.ownership_type = 'shared'`
from the older model where Entries owned shared-expense allocation. The current
model makes a ledger row direct to the account owner, while shared-expense state
lives in `split_expenses` and `split_expense_shares`.

## Repair

Settings now exposes a temporary Maintenance action:

- count legacy shared ledger rows
- count rows that can be repaired from `accounts.owner_person_id`
- count rows skipped because the account has no owner
- count legacy `transaction_splits` rows and the subset already attached to
  direct ledger rows
- repair eligible rows by setting `ownership_type = 'direct'` and
  `owner_person_id = accounts.owner_person_id`
- delete obsolete `transaction_splits` rows for repaired/direct ledger entries
- record completion in `app_maintenance_tasks`
- record an audit event when rows are changed

Rows on joint or ownerless accounts are intentionally skipped because the app
cannot infer a specific ledger owner from those account records.

## Removal Plan

After production reports zero legacy shared ledger rows and zero obsolete ledger
split rows attached to direct ledger entries, remove the temporary Settings
Maintenance action and remove the legacy ledger storage:

- stop writing or reading `transactions.ownership_type` for ledger entries
- stop writing or reading `transaction_splits`
- migrate the D1 schema to drop the legacy transaction ownership column and the
  `transaction_splits` table
- keep `monthly_plan_rows.ownership_type`, because shared month planning remains
  a separate domain concept

Do not drop the schema before the production repair status is zero.
