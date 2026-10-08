// Moving through the files of an import batch: which file opens next, how
// "Skip for now" sends the file in review to the end of the queue, and what
// the commit button says while another file waits
// (src/client/import-batch-model.js, src/client/import-intake-model.js).
import assert from "node:assert/strict";
import test from "node:test";

import { describeCommitLabel, findNextIntakeItem, skipIntakeItem } from "../src/client/import-batch-model.js";
import { orderIntakeQueue } from "../src/client/import-intake-model.js";

function statementItem(id, month, extra = {}) {
  return {
    id,
    fileName: `${id}.pdf`,
    sourceType: "pdf",
    parserKey: "uob_credit_card_pdf",
    duplicate: false,
    parsed: {
      parserKey: "uob_credit_card_pdf",
      checkpoints: [{ accountName: "UOB One Card", checkpointMonth: month, statementStartDate: `${month}-01` }],
      rows: [{ date: `${month}-03` }]
    },
    ...extra
  };
}

function activityItem(id, date, extra = {}) {
  return {
    id,
    fileName: `${id}.csv`,
    sourceType: "csv",
    parserKey: "generic_csv",
    duplicate: false,
    parsed: { parserKey: "generic_csv", checkpoints: [], rows: [{ date }] },
    ...extra
  };
}

const ids = (items) => items.map((item) => item.id);

test("the next file is the first one waiting in review order, never the one in review or a copy", () => {
  const april = statementItem("april", "2026-04");
  const may = statementItem("may", "2026-05");
  const activity = activityItem("activity", "2026-05-20");
  const copy = statementItem("copy", "2026-03", { duplicate: true });
  const queue = [activity, may, copy, april];

  assert.equal(findNextIntakeItem(queue, null)?.id, "april");
  assert.equal(findNextIntakeItem(queue, "april")?.id, "may");
  assert.equal(findNextIntakeItem(queue, "may")?.id, "april");
  // Only the file in review and a copy left: nothing waits.
  assert.equal(findNextIntakeItem([april, copy], "april"), undefined);
  assert.equal(findNextIntakeItem([], null), undefined);
});

test("skipping a file sends it after every file waiting, keeping its parsed rows", () => {
  const april = statementItem("april", "2026-04");
  const may = statementItem("may", "2026-05");
  const activity = activityItem("activity", "2026-05-20");
  const queue = [activity, may, april];
  assert.deepEqual(ids(orderIntakeQueue(queue)), ["april", "may", "activity"]);

  const skipped = skipIntakeItem(queue, "april");
  // A new list; the original is left alone.
  assert.notEqual(skipped, queue);
  assert.equal(queue.find((item) => item.id === "april").skipOrder, undefined);
  // Statements normally come first; a skipped one goes after the activity.
  assert.deepEqual(ids(orderIntakeQueue(skipped)), ["may", "activity", "april"]);
  const skippedApril = skipped.find((item) => item.id === "april");
  assert.equal(skippedApril.parsed, april.parsed);
  assert.equal(skippedApril.fileName, "april.pdf");
  assert.equal(findNextIntakeItem(skipped, null)?.id, "may");

  // Skipping a second file puts it after the first skipped one; skipping the
  // first again sends it to the very end.
  const twice = skipIntakeItem(skipped, "may");
  assert.deepEqual(ids(orderIntakeQueue(twice)), ["activity", "april", "may"]);
  const again = skipIntakeItem(twice, "april");
  assert.deepEqual(ids(orderIntakeQueue(again)), ["activity", "may", "april"]);
});

test("a copy stays last even after a skip, and skipping an unknown file changes nothing", () => {
  const april = statementItem("april", "2026-04");
  const copy = statementItem("copy", "2026-03", { duplicate: true });
  const activity = activityItem("activity", "2026-05-20");
  const skipped = skipIntakeItem([april, copy, activity], "april");
  assert.deepEqual(ids(orderIntakeQueue(skipped)), ["activity", "april", "copy"]);

  const queue = [april, activity];
  const unchanged = skipIntakeItem(queue, "missing");
  assert.equal(unchanged, queue);
});

test("the commit button names the next file while one waits, and keeps its own words for the last file", () => {
  const may = statementItem("may", "2026-05");
  const activity = activityItem("uob-activity", "2026-05-20", { parserKey: "uob_credit_card_current_transactions_xls", sourceType: "xls" });
  assert.equal(describeCommitLabel({ commitLabel: "Commit import to ledger", nextItem: may }), "Commit and open UOB One Card May");
  assert.equal(describeCommitLabel({ commitLabel: "Commit import to ledger", nextItem: activity }), "Commit and open UOB activity");
  assert.equal(describeCommitLabel({ commitLabel: "Commit import to ledger", nextItem: undefined }), "Commit import to ledger");
  assert.equal(describeCommitLabel({ commitLabel: "Refresh statement checkpoints", nextItem: null }), "Refresh statement checkpoints");
});
