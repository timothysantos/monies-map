# Delete Confirmation Audit

Last audited: 2026-07-05

## Rule

Every destructive user action must require an app-native confirmation before it calls a delete endpoint or mutation. Browser `alert`, `confirm`, and `prompt` APIs are not allowed. Typed confirmations remain reserved for broad destructive actions such as deleting or resetting a whole month.

## Delete Surfaces

| Surface | Endpoint or mutation | Confirmation status |
| --- | --- | --- |
| Entries inline editor: Delete entry | `/api/entries/delete` | Confirmed by `EntriesDeleteConfirmationDialog`. |
| Entries mobile edit sheet: Delete entry | `/api/entries/delete` | Confirmed by `EntriesDeleteConfirmationDialog`. |
| Entries inline editor: Delete split created from entry | `/api/splits/expenses/delete` | Confirmed by `EntriesDeleteConfirmationDialog`; linked ledger entry stays intact. |
| Entries mobile edit sheet: Delete split created from entry | `/api/splits/expenses/delete` | Confirmed by `EntriesDeleteConfirmationDialog`; linked ledger entry stays intact. |
| Splits page: Delete split expense row | `/api/splits/expenses/delete` | Confirmed by `SplitDeleteDialog`. |
| Splits page: Delete settlement row | `/api/splits/settlements/delete` | Confirmed by `SplitDeleteDialog`. |
| Month page: Delete planning income row | `/api/month-plan/delete` | Confirmed by `DeleteRowButton` popover. |
| Month page: Delete planning row | `/api/month-plan/delete` | Confirmed by `DeleteRowButton` popover. |
| Month page: Delete whole month | `/api/months/delete` | Typed confirmation dialog; user must type `delete month`. |
| Imports diagnostic reconciliation: Delete ledger row | `/api/entries/delete` | Confirmed by `DeleteRowButton` popover with row details. |
| Imports diagnostic reconciliation: Delete all shown ledger rows | `/api/entries/delete` per row | Confirmed by `DeleteRowButton` popover with count and net amount. |
| Imports history: Rollback import | `/api/imports/rollback` | Confirmed by `DeleteRowButton` popover before removing imported ledger rows. |
| Settings: Archive account | account settings mutation | Confirmed by `DeleteRowButton` popover. |
| Settings: Delete account checkpoint | `/api/accounts/checkpoints/delete` | Confirmed by `DeleteRowButton` popover. |
| Settings: Delete category | `/api/categories/delete` | Confirmed by `DeleteRowButton` popover. |
| Settings: Delete category match rule | `/api/category-match-rules/delete` | Confirmed by `DeleteRowButton` popover, including duplicate-rule shortcuts. |

## 2026-07-05 Finding

The entries page had confirmation coverage for import-diagnostic entry deletes but not for normal entry deletes from the inline editor or mobile edit sheet. Those buttons called the shared entry deletion handler directly, so a single click could remove a ledger entry.

## Fix

`EntriesPanel` now owns an explicit pending delete confirmation state. Desktop and mobile entry delete buttons request confirmation first, and the existing delete handlers only run after the dialog confirm action. The same dialog protects the entry-created split delete shortcut.
