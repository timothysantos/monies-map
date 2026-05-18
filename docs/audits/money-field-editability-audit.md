# Money Field Editability Audit

## Verdict
Ready to close.

## Scope
This audit covers the editable fields on the main workflow surfaces and checks
that money and numeric fields remain manually editable without forcing the user
to select the existing value first.

## Outcome
- The money fields now use a shared focus behavior that selects the current
  value on focus.
- The core manual-replacement path is covered by a cross-page Playwright
  regression.
- Standard text, select, and textarea fields remain editable through the
  existing workflow tests and CRUD coverage.

## Field Inventory

### Summary

| Field | Purpose | Coverage |
| --- | --- | --- |
| Month note | Add explanation to a summary month card | Existing summary workflow tests |
| Month drilldown actions | Open month details or entries from the summary card | Existing summary workflow tests |
| Account pill actions | Jump to entries for an account | Existing summary workflow tests |

### Entries

| Field | Purpose | Coverage |
| --- | --- | --- |
| Category | Reclassify the entry | Existing entries workflow tests |
| Date | Change when the transaction belongs | Existing entries workflow tests |
| Wallet | Move the entry to another account | Existing entries workflow tests |
| Owner | Switch direct/shared ownership context | Existing entries workflow tests |
| Amount | Edit the transaction value | `tests/e2e/money-field-editability.spec.js` |
| Type | Switch between expense, income, and transfer | Existing entries workflow tests |
| Split % | Adjust the split ownership ratio for shared entries | `tests/e2e/money-field-editability.spec.js` |
| Description | Rename the ledger line item | Existing entries workflow tests |
| Note | Add freeform context for the entry | Existing entries workflow tests |
| Transfer direction | Change transfer in/out semantics when the entry is a transfer | Existing entries workflow tests |

### Month

| Field | Purpose | Coverage |
| --- | --- | --- |
| Category | Classify the month row | Existing month workflow tests |
| Item / label | Name the planned row or income source | Existing month workflow tests |
| Planned amount | Edit the budgeted amount for income rows and planned items | `tests/e2e/money-field-editability.spec.js` |
| Row date | Change the day attached to a planned item | Existing month workflow tests |
| Account | Assign the planned item to a wallet | Existing month workflow tests |
| Note | Explain the planning intent or row context | Existing month workflow tests |

### Splits

| Field | Purpose | Coverage |
| --- | --- | --- |
| Group | Choose the split group | Existing splits workflow tests |
| Date | Set the settlement or expense date | Existing splits workflow tests |
| From / To | Record who paid whom | Existing splits workflow tests |
| Category | Reclassify the split expense | Existing splits workflow tests |
| Expense amount | Edit the total split expense amount | `tests/e2e/money-field-editability.spec.js` |
| Split % | Adjust the share ratio by percentage | `tests/e2e/money-field-editability.spec.js` |
| Exact split amount | Adjust the share ratio by fixed amount | `tests/e2e/money-field-editability.spec.js` |
| Description | Name the split transaction | Existing splits workflow tests |
| Note | Add split context | Existing splits workflow tests |
| Settlement amount | Edit the settle-up transfer amount | Existing splits settlement tests and focus contract regression |
| Linked entry amount | Edit the amount on the ledger-linked entry view | Dormant dialog surface; no active page route currently opens it |

### Imports

| Field | Purpose | Coverage |
| --- | --- | --- |
| Source label | Name the imported batch | Existing import workflow tests |
| CSV content | Provide the source data to preview | Existing import workflow tests |
| Preview row date | Reassign imported row dates | Existing import workflow tests |
| Preview row description | Refine imported row text | Existing import workflow tests |
| Preview row amount | Replace the imported amount before commit | `tests/e2e/money-field-editability.spec.js` |
| Preview row entry type | Convert the row between expense, income, and transfer | Existing import workflow tests |
| Preview row account | Map the row to the correct wallet | Existing import workflow tests |
| Preview row category | Map the row to the correct category | Existing import workflow tests |
| Preview row owner / shared split | Assign the ownership shape for previewed rows | Existing import workflow tests |
| Preview row note | Keep commentary with the import row | Existing import workflow tests |
| Import split percent | Set the default split percent for shared imports | `tests/e2e/money-field-editability.spec.js` |

### Settings

| Field | Purpose | Coverage |
| --- | --- | --- |
| Person display name | Rename a person | Existing settings reference-data tests |
| Account name | Rename the account | Existing settings reference-data tests |
| Account institution | Update the institution label | Existing settings reference-data tests |
| Account type | Update the account kind | Existing settings reference-data tests |
| Account currency | Update the account currency label | Existing settings reference-data tests |
| Opening balance | Set the starting account balance | `tests/e2e/money-field-editability.spec.js` |
| Account owner | Reassign or share the account | Existing settings reference-data tests |
| Checkpoint month | Choose the reconciliation checkpoint month | Existing settings workflow tests |
| Checkpoint start / end date | Define the statement span | Existing settings workflow tests |
| Statement balance | Enter the checkpoint statement amount | `tests/e2e/money-field-editability.spec.js` |
| Checkpoint note | Record reconciliation context | Existing settings workflow tests |
| Category rule pattern | Define the rule match text | Existing settings reference-data tests |
| Category rule category | Choose the target category | Existing settings reference-data tests |
| Category rule priority | Control rule precedence | Existing settings reference-data tests and `tests/e2e/money-field-editability.spec.js` |
| Category rule status | Toggle active versus inactive | Existing settings reference-data tests |
| Category rule note | Add rule context | Existing settings reference-data tests |

## Risks Reviewed
- Numeric inputs remain browser-native controls in some dialogs, so the
  contract depends on the shared focus helper and on manual typing tests.
- The imports and settings surfaces are still the most coordination-heavy
  surfaces, so the new regression should remain in the serial smoke set.
- Standard text and select fields are already covered by existing CRUD tests,
  so the remaining risk is primarily numeric replacement behavior.

## Pass Condition
The audit passes when:
- the cross-page money field regression passes,
- the serial smoke bundle remains green,
- and the editable-field inventory above matches the current UI surfaces.
