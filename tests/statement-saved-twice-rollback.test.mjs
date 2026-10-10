// A statement saved twice (imported, then saved again from the re-upload's
// "Save it again anyway") has one checkpoint per card and month, claimed by
// both imports. Rolling back one import must leave the checkpoint the other
// still saves; rolling back both removes it. Real local D1 (Miniflare)
// seeded with the demo household.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const CHECKPOINT_MONTH = "2026-05";

async function createCard(api) {
  const created = await api("/api/accounts/create", {
    name: "Twice Card",
    institution: "Synthetic Test Bank",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.accountId;
}

// Previews the statement, then commits what the preview says to commit:
// its new rows on the first upload, none on the second.
async function saveStatement(api, accountId, sourceLabel) {
  const statementCheckpoints = [{
    accountId,
    accountName: "Twice Card",
    detectedAccountName: "Twice Card",
    checkpointMonth: CHECKPOINT_MONTH,
    statementStartDate: "2026-04-13",
    statementEndDate: "2026-05-12",
    statementBalanceMinor: 734
  }];
  const preview = await api("/api/imports/preview", {
    sourceLabel,
    sourceType: "pdf",
    rows: [{ date: "2026-04-17", description: "OPENAI OPENAI.COM USD 5.58", expense: "7.34", accountId, account: "Twice Card", category: "Other" }],
    defaultAccountName: "Twice Card",
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const { previewRows, statementReconciliations } = preview.payload.preview;
  assert.equal(statementReconciliations[0].status, "matched");
  const commit = await api("/api/imports/commit", {
    sourceLabel,
    sourceType: "pdf",
    parserKey: "uob_credit_card_pdf",
    rows: previewRows.filter((row) => row.commitStatus === "included"),
    statementCheckpoints,
    statementControlRows: previewRows,
    statementReconciliations
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  return { importId: commit.payload.importId, previewRows, statementReconciliations };
}

const checkpoints = (db, accountId) => rows(db, `
  SELECT checkpoint_month, statement_balance_minor FROM account_balance_checkpoints WHERE account_id = ?
`, accountId);

async function rollBack(api, importId) {
  const rollback = await api("/api/imports/rollback", { importId });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
}

async function saveTwice(api, accountId) {
  const first = await saveStatement(api, accountId, "eStatement_first");
  const second = await saveStatement(api, accountId, "eStatement_again");
  // The second upload adds nothing: its row is the one the first certified,
  // and each card names the first import.
  assert.deepEqual(second.previewRows.map((row) => row.commitStatus), ["skipped"]);
  assert.equal(second.statementReconciliations[0].previousStatementImport.importId, first.importId);
  return { first: first.importId, second: second.importId };
}

test("rolling back the second save of a statement keeps the checkpoint the first still saves", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const accountId = await createCard(api);
  const { first, second } = await saveTwice(api, accountId);
  assert.deepEqual(await checkpoints(db, accountId), [{ checkpoint_month: CHECKPOINT_MONTH, statement_balance_minor: -734 }]);

  await rollBack(api, second);

  assert.deepEqual(await checkpoints(db, accountId), [{ checkpoint_month: CHECKPOINT_MONTH, statement_balance_minor: -734 }]);
  assert.equal((await rows(db, "SELECT status FROM imports WHERE id = ?", first))[0].status, "completed");
});

test("rolling back the first save keeps the checkpoint while the second still saves it, and both remove it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const accountId = await createCard(api);
  const { first, second } = await saveTwice(api, accountId);

  await rollBack(api, first);
  assert.deepEqual(await checkpoints(db, accountId), [{ checkpoint_month: CHECKPOINT_MONTH, statement_balance_minor: -734 }]);

  await rollBack(api, second);
  assert.deepEqual(await checkpoints(db, accountId), []);
});
