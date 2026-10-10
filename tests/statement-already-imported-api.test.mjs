// A statement uploaded again names the earlier import that already saved it,
// so the review can say "Already imported on …" instead of looking empty.
// Real Worker routes against a real local D1.
import test from "node:test";
import { expect } from "@playwright/test";

import { postJson, useSeededWorkerRequest } from "./support/worker-request.mjs";

const openRequest = useSeededWorkerRequest();

async function createCard(request) {
  const accountName = `Synthetic Repeat Card ${Date.now()}`;
  const payload = await postJson(request, "/api/accounts/create", {
    name: accountName,
    institution: "Synthetic Test Bank",
    kind: "credit_card",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  expect(payload.accountId).toBeTruthy();
  return { accountId: payload.accountId, accountName };
}

function statementRow({ accountId, accountName }) {
  return {
    date: "2025-08-14",
    description: "BUS MRT 687",
    expense: "2.48",
    accountId,
    account: accountName,
    category: "Public Transport"
  };
}

function checkpoint({ accountId, accountName }, checkpointMonth = "2025-08") {
  return {
    accountId,
    accountName,
    detectedAccountName: "Synthetic Card Alpha",
    checkpointMonth,
    statementStartDate: `${checkpointMonth}-01`,
    statementEndDate: `${checkpointMonth}-28`,
    statementBalanceMinor: 248
  };
}

async function previewStatement(request, account, checkpointMonth) {
  const payload = await postJson(request, "/api/imports/preview", {
    sourceLabel: "Synthetic statement repeat",
    sourceType: "pdf",
    rows: [statementRow(account)],
    defaultAccountName: account.accountName,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: [checkpoint(account, checkpointMonth)]
  });
  return payload.preview;
}

async function commitFirstImport(request, account) {
  const preview = await previewStatement(request, account, "2025-08");
  expect(preview.statementReconciliations[0].previousStatementImport).toBeUndefined();
  const commit = await postJson(request, "/api/imports/commit", {
    sourceLabel: "eStatement_first.pdf",
    sourceType: "pdf",
    parserKey: "uob_pdf",
    rows: preview.previewRows,
    statementControlRows: preview.previewRows,
    statementCheckpoints: [checkpoint(account)],
    statementReconciliations: preview.statementReconciliations
  });
  expect(commit.importId).toBeTruthy();
  return commit.importId;
}

test("a statement uploaded again names the earlier import that saved it", async (t) => {
  const request = await openRequest(t);
  const account = await createCard(request);
  const importId = await commitFirstImport(request, account);

  const repeat = await previewStatement(request, account, "2025-08");
  const [reconciliation] = repeat.statementReconciliations;
  expect(reconciliation.status).toBe("matched");
  expect(reconciliation.previousStatementImport).toEqual({
    importId,
    sourceLabel: "eStatement_first.pdf",
    importedAt: expect.any(String)
  });
  expect(Number.isNaN(Date.parse(reconciliation.previousStatementImport.importedAt.replace(" ", "T")))).toBe(false);
  // The row is the one the first import certified, so nothing new is added.
  expect(repeat.previewRows.map((row) => row.commitStatus)).toEqual(["skipped"]);
  expect(repeat.previewRows[0].commitStatusReason).toContain("already certified");
});

test("another month's statement and a rolled-back import name no earlier import", async (t) => {
  const request = await openRequest(t);
  const account = await createCard(request);
  const importId = await commitFirstImport(request, account);

  const september = await previewStatement(request, account, "2025-09");
  expect(september.statementReconciliations[0].previousStatementImport).toBeUndefined();

  const rollback = await postJson(request, "/api/imports/rollback", { importId });
  expect(rollback.rolledBack).toBe(true);
  const afterRollback = await previewStatement(request, account, "2025-08");
  expect(afterRollback.statementReconciliations[0].previousStatementImport).toBeUndefined();
});
