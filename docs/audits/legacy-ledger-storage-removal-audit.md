# Legacy Ledger Storage Removal Audit

Date: 2026-07-07

## Summary

Production reported zero legacy shared ledger rows and zero obsolete direct-row
ledger split rows after the one-time repair completed on 7 Jul 2026 at 7:11 am.
The temporary repair surface is now retired.

Ledger ownership now has one persisted source of truth:

- `transactions.owner_person_id` stores the direct ledger owner.
- linked shared-expense state lives in `split_expenses` and
  `split_expense_shares`.
- `monthly_plan_rows.ownership_type` remains, because shared month planning is
  a separate planning concept.

## Changes

- Removed `transactions.ownership_type` from the canonical schema.
- Removed the `transaction_splits` compatibility table and index from the
  canonical schema.
- Added a guarded D1 migration that drops the legacy column and table only when
  no `ownership_type = 'shared'` ledger rows remain.
- Removed the Settings maintenance repair UI and repair API.
- Removed the legacy repair repository module and tests.
- Stopped import, entry create/update, statement rollback, demo seed, and entry
  DTO projection paths from reading or writing legacy ledger split storage.

## Verification Targets

- Entry rows still project a direct 100% owner share from
  `transactions.owner_person_id` for client compatibility.
- Entries `Shared` scope still comes from linked split expense shares.
- Statement rollback restores transaction rows and real split links without
  recreating removed ledger split rows.
- Month planning shared ownership remains unchanged.
