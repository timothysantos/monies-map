// The files of this session's import batch, as the sticky bar's file chips
// show them (src/client/import-batch-model.js): done, the one in review,
// then the queue in review order, with a short label each.
import assert from "node:assert/strict";
import test from "node:test";

import { buildImportBatchFiles, describeImportFileLabel } from "../src/client/import-batch-model.js";

function statementItem(id, { parserKey = "uob_credit_card_pdf", checkpoints, fileName = `${id}.pdf`, duplicate = false }) {
  return { id, fileName, sourceType: "pdf", parserKey, duplicate, parsed: { parserKey, checkpoints, rows: [] } };
}

function activityItem(id, { parserKey = "uob_credit_card_current_transactions_xls", fileName = `${id}.xls`, date = "2026-05-20" } = {}) {
  return { id, fileName, sourceType: "xls", parserKey, duplicate: false, parsed: { parserKey, checkpoints: [], rows: [{ date }] } };
}

test("a file's label is its card and month, its bank's activity, or its shortened name", () => {
  assert.equal(describeImportFileLabel({
    fileName: "eStatement.pdf",
    sourceType: "pdf",
    parserKey: "ocbc_360_pdf",
    checkpoints: [{ accountName: "OCBC 360 Account", checkpointMonth: "2026-08" }]
  }), "OCBC 360 Account Aug");
  // A statement of several cards is named by its bank.
  assert.equal(describeImportFileLabel({
    fileName: "eStatement_UOB_Cards_12May2026.pdf",
    sourceType: "pdf",
    parserKey: "uob_credit_card_pdf",
    checkpoints: [
      { detectedAccountName: "UOB One Card", accountName: "UOB One Card", checkpointMonth: "2026-05" },
      { detectedAccountName: "UOB Lady's Card", accountName: "UOB Lady's Card", checkpointMonth: "2026-05" }
    ]
  }), "UOB cards May");
  assert.equal(describeImportFileLabel({
    fileName: "uob-savings.pdf",
    sourceType: "pdf",
    parserKey: "uob_savings_pdf",
    checkpoints: [{ accountName: "UOB One Account", checkpointMonth: "2026-07" }, { accountName: "UOB Stash", checkpointMonth: "2026-07" }]
  }), "UOB accounts Jul");
  assert.equal(describeImportFileLabel({ fileName: "CC_Txn_History.xls", sourceType: "xls", parserKey: "uob_credit_card_current_transactions_xls" }), "UOB activity");
  assert.equal(describeImportFileLabel({ fileName: "ACCT_123.csv", sourceType: "csv", parserKey: "citibank_credit_card_activity_csv" }), "Citibank activity");
  assert.equal(describeImportFileLabel({ fileName: "one-card-activity.csv", sourceType: "csv", parserKey: "generic_csv" }), "one-card-activity.csv");
  // Long names are cut with an ellipsis; the chip keeps the full name as its title.
  assert.equal(describeImportFileLabel({ fileName: "household-shared-expenses-2026-export-final.csv", sourceType: "csv" }), "household-shared-expens…");
  assert.equal(describeImportFileLabel({ fileName: "", sourceType: "csv" }), "File");
});

test("a three-file drop lists the file in review, then the rest in review order", () => {
  const statement = statementItem("statement", { checkpoints: [{ accountName: "UOB One Card", checkpointMonth: "2026-05", statementStartDate: "2026-04-13" }] });
  const activity = activityItem("activity");
  const csv = { id: "csv", fileName: "ladys.csv", sourceType: "csv", parserKey: "generic_csv", duplicate: false, csvText: "date,description,amount\n2026-05-21,Kopi,-4.20" };
  const copy = { ...activityItem("copy"), duplicate: true };

  const batch = buildImportBatchFiles({
    committedFiles: [],
    currentFile: { id: "statement", label: "UOB One Card May" },
    queue: [csv, copy, activity, statement],
    activeItemId: "statement"
  });
  assert.deepEqual(batch.files.map(({ id, label, state }) => ({ id, label, state })), [
    { id: "statement", label: "UOB One Card May", state: "reviewing" },
    { id: "activity", label: "UOB activity", state: "waiting" },
    { id: "csv", label: "ladys.csv", state: "waiting" }
  ]);
  assert.equal(batch.files[1].item, activity);
  assert.deepEqual({ index: batch.index, total: batch.total }, { index: 1, total: 3 });
});

test("after a commit the file is done, and the count follows the next file in review", () => {
  const activity = activityItem("activity");
  const csv = { id: "csv", fileName: "ladys.csv", sourceType: "csv", parserKey: "generic_csv", duplicate: false, csvText: "" };
  const committedFiles = [{ id: "statement", label: "UOB One Card May", importId: "import-1" }];

  const done = buildImportBatchFiles({ committedFiles, currentFile: null, queue: [activity, csv], activeItemId: null });
  assert.deepEqual(done.files.map(({ id, state }) => ({ id, state })), [
    { id: "statement", state: "done" },
    { id: "activity", state: "waiting" },
    { id: "csv", state: "waiting" }
  ]);
  assert.equal(done.files[0].importId, "import-1");
  assert.deepEqual({ index: done.index, total: done.total }, { index: 1, total: 3 });

  const next = buildImportBatchFiles({
    committedFiles,
    currentFile: { id: "activity", label: "UOB activity" },
    queue: [activity, csv],
    activeItemId: "activity"
  });
  assert.deepEqual(next.files.map(({ id, state }) => ({ id, state })), [
    { id: "statement", state: "done" },
    { id: "activity", state: "reviewing" },
    { id: "csv", state: "waiting" }
  ]);
  assert.deepEqual({ index: next.index, total: next.total }, { index: 2, total: 3 });
});

test("one file opened on its own is file 1 of 1, and an empty session has no files", () => {
  const single = buildImportBatchFiles({ committedFiles: [], currentFile: { id: "current", label: "UOB cards May" }, queue: [], activeItemId: null });
  assert.deepEqual(single.files.map(({ id, state }) => ({ id, state })), [{ id: "current", state: "reviewing" }]);
  assert.deepEqual({ index: single.index, total: single.total }, { index: 1, total: 1 });

  const empty = buildImportBatchFiles({ committedFiles: [], currentFile: null, queue: [], activeItemId: null });
  assert.deepEqual(empty, { files: [], index: 0, total: 0 });
});
