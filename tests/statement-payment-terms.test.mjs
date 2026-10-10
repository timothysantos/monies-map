// What a card statement asks for (its due date and minimum) and the bank's
// notices about the card, through the real import preview, commit and the
// Settings page (real Worker, local D1). The figures are Joyce's OCBC 365
// card's Oct 2026 statement: $33.15 due 23 Oct, penalty interest 30.78%.
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

async function cardAccount(db) {
  const [account] = await rows(db, "SELECT id, account_name FROM accounts WHERE account_kind = 'credit_card' ORDER BY account_name LIMIT 1");
  return account;
}

function checkpointFor(account, extra = {}) {
  return {
    accountId: account.id,
    accountName: account.account_name,
    checkpointMonth: "2030-10",
    statementStartDate: "2030-09-02",
    statementEndDate: "2030-10-01",
    statementBalanceMinor: 3315,
    note: "Imported from OCBC credit card statement",
    ...extra
  };
}

const row = (account) => ({ date: "2030-09-21", description: "SHOPEE SG MP", expense: "33.15", income: "", account: account.account_name, category: "Shopping", type: "expense", note: "" });

test("a statement's due date, minimum and notices show on its card and the due date and minimum are saved", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const account = await cardAccount(db);
  const checkpoint = checkpointFor(account, {
    paymentDueDate: "2030-10-23",
    minimumPaymentMinor: 3315,
    // A notice the app does not know is dropped, not shown.
    notices: [{ code: "penalty_interest", annualRatePercent: 30.78 }, { code: "made_up" }, { code: "penalty_interest", annualRatePercent: 300 }]
  });
  const preview = await api("/api/imports/preview", {
    sourceLabel: "OCBC 365 Oct 2030",
    sourceType: "pdf",
    rows: [row(account)],
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: [checkpoint]
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const [reconciliation] = preview.payload.preview.statementReconciliations;
  assert.deepEqual(
    [reconciliation.paymentDueDate, reconciliation.minimumPaymentMinor, reconciliation.notices],
    ["2030-10-23", 3315, [{ code: "penalty_interest", annualRatePercent: 30.78 }]]
  );

  const commit = await api("/api/imports/commit", {
    sourceLabel: "OCBC 365 Oct 2030",
    sourceType: "pdf",
    parserKey: "ocbc_365_credit_card_pdf",
    statementCheckpoints: [checkpoint],
    statementControlRows: preview.payload.preview.previewRows,
    statementReconciliations: preview.payload.preview.statementReconciliations,
    rows: preview.payload.preview.previewRows.filter((item) => item.commitStatus === "included")
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [saved] = await rows(db, "SELECT payment_due_date, minimum_payment_minor FROM account_balance_checkpoints WHERE account_id = ? AND checkpoint_month = '2030-10'", account.id);
  assert.deepEqual(saved, { payment_due_date: "2030-10-23", minimum_payment_minor: 3315 });
});

test("a statement with no due date or a bad minimum saves neither", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const account = await cardAccount(db);
  const checkpoint = checkpointFor(account, { paymentDueDate: "23 Oct", minimumPaymentMinor: -5 });
  const preview = await api("/api/imports/preview", {
    sourceLabel: "Card Oct 2030",
    sourceType: "pdf",
    rows: [row(account)],
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: [checkpoint]
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const [reconciliation] = preview.payload.preview.statementReconciliations;
  assert.deepEqual([reconciliation.paymentDueDate, reconciliation.minimumPaymentMinor, reconciliation.notices], [undefined, undefined, undefined]);
  const commit = await api("/api/imports/commit", {
    sourceLabel: "Card Oct 2030",
    sourceType: "pdf",
    statementCheckpoints: [checkpoint],
    statementControlRows: preview.payload.preview.previewRows,
    statementReconciliations: preview.payload.preview.statementReconciliations,
    rows: preview.payload.preview.previewRows.filter((item) => item.commitStatus === "included")
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [saved] = await rows(db, "SELECT payment_due_date, minimum_payment_minor FROM account_balance_checkpoints WHERE account_id = ? AND checkpoint_month = '2030-10'", account.id);
  assert.deepEqual(saved, { payment_due_date: null, minimum_payment_minor: null });
});
