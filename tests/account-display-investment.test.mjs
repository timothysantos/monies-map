// An investment account's health line on Summary is what its latest statement
// says it was worth, with the statement's date; other accounts keep their
// reconciliation wording.
import assert from "node:assert/strict";
import test from "node:test";

import { describeAccountHealth } from "../src/client/account-display.js";

test("an investment account says what its statement says it was worth, and when", () => {
  assert.equal(
    describeAccountHealth({ investmentValue: { valueMinor: 202_390, asOfDate: "2026-09-30" }, reconciliationStatus: undefined }),
    "Worth $2,023.90 on 30 Sep 2026, from its statement"
  );
});

test("the statement figure wins over a reconciliation status the account never had", () => {
  assert.equal(
    describeAccountHealth({ investmentValue: { valueMinor: 100, asOfDate: "2026-01-31" }, reconciliationStatus: "matched", latestCheckpointMonth: "2026-01" }),
    "Worth $1.00 on 31 Jan 2026, from its statement"
  );
});

test("accounts without a statement value keep the reconciliation wording", () => {
  assert.equal(describeAccountHealth({ reconciliationStatus: "matched", latestCheckpointMonth: "2026-06" }), "Reconciled to Jun 2026 statement");
  assert.equal(describeAccountHealth({}), "No statement checkpoint yet");
});
