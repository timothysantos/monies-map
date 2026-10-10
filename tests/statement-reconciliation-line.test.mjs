// The statement card's summary line on the import review. The ledger side
// is the balance once this import is saved, so it says "after import", and a
// card balance reads the way a statement prints it ("$33.15 owed").
import assert from "node:assert/strict";
import test from "node:test";

import { formatStatementReconciliationLine } from "../src/client/formatters.js";

test("a card line names the statement and the ledger after import, owed or in credit", () => {
  // Joyce's OCBC 365, Oct 2026: the statement owes 33.15; the ledger, missing
  // the Sept statement, would end 119.26 in credit.
  assert.equal(
    formatStatementReconciliationLine({ accountKind: "credit_card", statementBalanceMinor: -3315, projectedLedgerBalanceMinor: 11926 }),
    "Statement: $33.15 owed • Ledger after import: $119.26 in credit"
  );
  assert.equal(
    formatStatementReconciliationLine({ accountKind: "credit_card", statementBalanceMinor: 0, projectedLedgerBalanceMinor: -500 }),
    "Statement: $0.00 • Ledger after import: $5.00 owed"
  );
  assert.equal(
    formatStatementReconciliationLine({ accountKind: "bank", statementBalanceMinor: 120000, projectedLedgerBalanceMinor: 119000 }),
    "Statement: $1,200.00 • Ledger after import: $1,190.00"
  );
  // Before the check has a ledger balance, only the statement shows.
  assert.equal(formatStatementReconciliationLine({ accountKind: "credit_card", statementBalanceMinor: -3315 }), "Statement -$33.15");
});

test("hidden money shows no word that gives away a card balance's sign", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { dataset: { moneyPrivacy: "hidden" } } };
  try {
    const line = formatStatementReconciliationLine({ accountKind: "credit_card", statementBalanceMinor: -3315, projectedLedgerBalanceMinor: 11926 });
    assert.equal(line, "Statement: •••• • Ledger after import: ••••");
    assert.doesNotMatch(line, /owed|credit/);
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  }
});
