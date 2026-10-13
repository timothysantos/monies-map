import assert from "node:assert/strict";
import test from "node:test";

import { countRowsToImport } from "../src/client/import-preview-model.js";

const row = (rowId, overrides = {}) => ({ rowId, commitStatus: "included", ...overrides });

test("the file card counts the rows a commit would add as new entries", () => {
  assert.equal(countRowsToImport([row("a"), row("b"), row("c", { commitStatus: undefined })]), 3);
});

test("excluded, review-pending, ledger-paired and resolved rows are not new entries", () => {
  const rows = [
    row("new"),
    row("excluded", { commitStatus: "skipped" }),
    row("needs-review", { commitStatus: "needs_review" }),
    row("paired", { reconciliationTargetTransactionId: "txn-1" }),
    row("resolved", { isStatementMatchResolved: true }),
    row("conflict", { isCertifiedConflict: true, commitStatus: "skipped" })
  ];
  assert.equal(countRowsToImport(rows), 1);
  assert.equal(countRowsToImport([]), 0);
});
