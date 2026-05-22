# Import Exact-Match Certification Audit

## Scope

- Final PDF statement imports after one or more mid-cycle CSV/XLS imports.
- Exact/probable provisional ledger matches that the statement certification check says will be certified.
- Visible preview rows, commit payload safety, and statement checkpoint refresh behavior.

## Audit Checklist

- [x] Confirmed ordinary mid-cycle CSV/XLS exact duplicates still auto-skip instead of importing duplicates.
- [x] Confirmed PDF statements can still certify existing provisional mid-cycle rows instead of creating duplicate ledger rows.
- [x] Confirmed matched statement certification rows are hidden from the active editable preview table.
- [x] Confirmed hidden certification rows remain in the commit payload so existing ledger rows are certified.
- [x] Confirmed true statement-only rows remain visible and editable.
- [x] Confirmed the commit summary still shows new rows, existing rows to certify, and checkpoint refresh counts correctly.
- [x] Confirmed user-excluded rows can still break the statement check and be restored.
- [x] Confirmed manual/user annotations on certified provisional rows are preserved after final statement commit.
- [x] Confirmed statement-certified bank facts stay locked after commit.
- [x] Confirmed no product semantics changed for already-certified rows or certified conflict rows.

## Verification

- `npm run build`
- `npx playwright test --workers=1 tests/e2e/import-ledger-flow.spec.js -g "statement preview can certify midcycle rows"`
- `npx playwright test --workers=1 tests/e2e/import-ledger-flow.spec.js -g "multi-card statements reconcile"`
- `npm run test:e2e:smoke`

## Verdict

The app should not ask the user to manually exclude rows it has already identified as statement-certified exact/probable provisional matches when the statement certification check is matched. Those rows are now treated as resolved certification work: hidden from the active preview table, retained in the commit payload, and reflected in the certification summary.
