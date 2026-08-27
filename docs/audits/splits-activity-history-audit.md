# Splits Activity History Audit

Date: 2026-08-27

## Objective

Make split corrections reversible and give users an accessible record of what
changed, especially when a split is deleted accidentally or a linked ledger
relationship needs investigation.

## Scenarios

| Scenario | Expected result |
| --- | --- |
| Delete a manual expense | Row disappears from active activity, remains in history, and can be restored |
| Delete a linked expense | Ledger entry remains untouched; restore preserves the link |
| Delete a settlement | Settlement is restorable without recreating a second payment |
| Restore a deleted row | Original ID, shares, group, currency, note, and link return exactly once |
| Restore after a new checkpoint | Row is visible as a new open item and is not silently added to an old checkpoint |
| Delete an included checkpoint row | History explains deletion; checkpoint remains auditable and does not lose its snapshot |
| Repeated delete/restore | Idempotent state transitions; no duplicate history ambiguity |
| Two users restore/delete concurrently | Only the winning state transition applies; stale action reports current state |
| Delete while search/filter is active | History remains discoverable outside the filtered active list |
| Group history | Filter by group and see rows from archived/current batches |
| Currency history | Original foreign amount and currency remain visible after restore |
| Privacy | History is household-scoped and never exposes another household's records |
| Reseed/demo reset | Demo reset clears demo history; production history is not reset by page loading |
| Browser reload/offline retry | Restore action is safe to retry and refreshes active/history views |
| Settlement matching | Deleting a split does not delete ledger entries or transfer evidence |

## Product contract

- Delete is a reversible archive action, not physical removal from the user
  workflow.
- Active splits show only live records; history shows deleted and restored
  events with timestamps and context.
- Restore never changes the ledger entry and never rewrites a historical
  settlement checkpoint.
- History is household-scoped, bounded, and ordered newest first.
- Permanent erasure is an explicit future retention/admin feature, not the
  default delete button.

## Implementation status

The first release implements soft-delete, restore, household-scoped history,
and regression coverage for the scenarios above. Edit and settlement-match
event expansion remains a follow-up once the event payload contract is stable.
