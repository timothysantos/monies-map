// An investment statement saves what the account was worth, not a balance to
// certify, so a commit with no new rows has its own words; the account it
// names that the app does not know is asked for like a bank statement's.
import assert from "node:assert/strict";
import test from "node:test";

import { describeCommitLabel } from "../src/client/import-batch-model.js";
import { buildImportPreviewModel } from "../src/client/import-preview-model.js";

const ACCOUNTS = [{ id: "acct-ifast", name: "Alex iFAST", kind: "investment" }];

const VALUE_CHECKPOINT = {
  accountName: "Alex iFAST",
  detectedAccountName: "Alex iFAST",
  checkpointMonth: "2026-09",
  statementBalanceMinor: 202_390,
  investmentValue: { accountReference: "P0000194", currency: "SGD", totalAssetsMinor: 202_390, marketValueMinor: 202_390, cashMinor: 0, incomeMinor: 0 }
};

const ROW = { rowId: "preview-1", date: "2026-08-11", amountMinor: 68_500, entryType: "transfer", transferDirection: "in", accountName: "Alex iFAST", accountId: "acct-ifast", statementAccountName: "Alex iFAST", commitStatus: "included" };

function model({ rows = [], checkpoints = [VALUE_CHECKPOINT], accounts = ACCOUNTS } = {}) {
  return buildImportPreviewModel({
    accounts,
    preview: { statementReconciliations: [], overlapImports: [], unknownAccounts: [] },
    previewRows: rows,
    statementCheckpoints: checkpoints,
    statementImportMeta: { sourceType: "pdf", parserKey: "ifast_wrap_pdf" },
    dismissedOverlapIds: [],
    unknownCategoryMode: "other"
  });
}

test("a month with no contribution commits as \"Save statement value\", not an empty checkpoint", () => {
  const preview = model();
  assert.equal(preview.commitKind, "investment_value");
  assert.equal(preview.commitLabel, "Save statement value");
  assert.equal(preview.hasCommitPayload, true);
  assert.equal(describeCommitLabel({ commitKind: preview.commitKind, commitLabel: preview.commitLabel, nextItem: { id: "next" } }), "Save statement value and open next");
});

test("a statement with a contribution to add keeps the plain commit", () => {
  const preview = model({ rows: [ROW] });
  assert.equal(preview.commitKind, "rows");
  assert.equal(preview.commitLabel, "Commit import to ledger");
});

test("an account the statement names that is not known yet is listed for mapping", () => {
  const preview = model({ rows: [{ ...ROW, accountId: undefined }], accounts: [] });
  assert.deepEqual(preview.unknownPreviewAccountNames, ["Alex iFAST"]);
  assert.equal(preview.needsStatementAccountMapping, true);
});

test("a bank statement's checkpoint with no rows is still an empty checkpoint", () => {
  const { investmentValue, ...bankCheckpoint } = VALUE_CHECKPOINT;
  assert.ok(investmentValue);
  assert.equal(model({ checkpoints: [bankCheckpoint] }).commitKind, "empty_checkpoint");
});
