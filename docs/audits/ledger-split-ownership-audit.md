# Ledger And Split Ownership Audit

Date: 2026-07-06

## Summary

Entries had two overlapping meanings for `Shared`:

- a legacy ledger ownership state stored as `transactions.ownership_type = 'shared'`
- a split-workspace relationship stored as `split_expenses.linked_transaction_id`

That made the entry editor's `Split %` field misleading. Users reasonably
expected it to edit the linked split record, but it edited only the legacy
ledger split projection. The product invariant is now:

- ledger entries keep a real owner tied to the bank/account-side row
- Entries `Shared` scope and `On splits` cues are driven by a linked split
  expense
- split percentages are edited on split expenses, not in the ledger entry form
- linking, editing, deleting, or unlinking a split expense must not rewrite the
  ledger owner

## Surfaces Scanned

- Entry row display and owner cues:
  - `src/client/entry-row-display.js`
  - `src/client/entries-list.jsx`
  - `src/client/entries-panel.jsx`
- Entry create/edit workflow:
  - `src/client/entry-actions.js`
  - `src/client/entry-editor.jsx`
  - `src/client/entry-helpers.js`
  - `src/client/entry-selectors.js`
- Split-link workflow:
  - `src/domain/app-repository-splits.ts`
  - `src/client/splits-linked-entry-dialog.jsx`
  - `src/client/splits-drafts.js`
- Server page projection:
  - `src/domain/app-repository-entries.ts`
  - `src/domain/app-shell.ts`
  - `src/types/dto.ts`
- Import and shortcut entry creation surfaces:
  - `src/client/import-select-file-stage.jsx`
  - `src/client/import-preview-rows-table.jsx`
  - `src/client/import-api.js`
  - `src/client/quick-entry-url.js`
  - `src/client/statement-compare.jsx`
- Documentation and user-facing copy:
  - `DOMAIN.md`
  - `docs/faq.md`
  - `src/client/copy/en-SG.js`

## Findings

1. `Add to splits` promoted direct ledger rows to `ownership_type = 'shared'`.
   That erased the distinction between the bank ledger owner and the split
   workspace relationship.
2. The entry editor rendered a `Split %` field for shared ledger rows, but that
   field did not update the linked split expense.
3. Entries scope filtering used `ownershipType` instead of the linked split
   relationship, so a row could look shared without a split record.
4. Imports, statement comparison, quick-entry URL defaults, and linked-entry
   editing could still create or edit shared ledger ownership from user-facing
   controls.

## Changes Made

- Added `linkedSplitShares` to entry DTOs so Entries can derive shared visibility
  and split percentages from the linked split expense.
- Changed Entries scope filtering:
  - `Shared` means `linkedSplitExpenseId` exists and the viewer participates in
    the linked split shares.
  - `Direct ownership` excludes rows that are linked to split expenses.
  - `Direct + Shared` is the union without duplicating rows.
- Stopped `Add to splits`, split match linking, and split expense editing from
  rewriting ledger ownership or `transaction_splits`.
- Removed normal UI paths that set shared ledger ownership:
  - entry owner selector no longer includes `Shared`
  - entry editor no longer shows `Split %`
  - import defaults and preview rows no longer expose shared ownership or split
    percent
  - statement comparison and quick-entry URL no longer create shared ledger
    rows from user-facing controls
- Updated FAQ and domain language to distinguish `entry share`,
  `split-linked ledger entry`, `split expense`, and `split expense share`.

## Compatibility Notes

Existing legacy `ownership_type = 'shared'` rows still load and can be displayed.
They are no longer the source of truth for Entries `Shared` scope. Future data
cleanup is tracked in
[`legacy-ledger-ownership-repair-audit.md`](./legacy-ledger-ownership-repair-audit.md).

Month plan rows still have their own shared planning model. This audit changed
ledger entry sharing only.

## Test Coverage

- `tests/e2e/entries-add-to-splits.spec.js`
  - Add to splits keeps ledger ownership direct.
  - Shared scope is based on linked split records.
  - Linked split shares are projected onto Entries rows.
- `tests/e2e/splits-review-matches.spec.js`
  - Review match links a split expense without promoting the ledger owner.
- `tests/entry-row-display.test.mjs`
  - Linked split rows keep the Splits label and split percentage from linked
    shares.
- `tests/quick-entry-url-defaults.test.mjs`
  - `shared=true` no longer creates a shared ledger owner.
- `tests/e2e/money-field-editability.spec.js`
  - Import money editing still works after removing import shared split controls.
