// A card's activity export imported after its statement is saved. The
// export is a real Citi Rewards activity export (1 Sep - 15 Oct 2026, card
// number and payee sanitized); the September statement closed on 11 Sep and
// listed every row up to 10 Sep except one EXIMBAY charge of SGD 28.22. That
// charge and the two from 11 Sep posted after the cut-off and are on the
// October statement. Before this fix the export filed them into September's
// closed cycle, and the saved September statement read "off by $49.53".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { parseCitibankActivityCsv } from "../src/lib/statement-import.ts";
import { loadAccounts } from "../src/domain/app-repository-settings.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const CITI = "Citi Rewards";
const CSV = readFileSync(new URL("./fixtures/citibank-activity/ACCT_349_19_10_2026-sanitized.csv", import.meta.url), "utf8");
const STATEMENT_END = "2026-09-11";
const LATE_ROWS = [
  ["2026-09-10", 2822],
  ["2026-09-11", 1418],
  ["2026-09-11", 713]
];

// The parser's raw row, read the way the preview reads it.
function ledgerRow(row) {
  const amountMinor = Math.round(Number(row.expense || row.income) * 100);
  const entryType = row.type === "transfer" ? "transfer" : row.expense ? "expense" : "income";
  const transferDirection = entryType === "transfer" ? (row.expense ? "out" : "in") : null;
  return { date: row.date, description: row.description, amountMinor, entryType, transferDirection };
}

function isLateRow(row) {
  return LATE_ROWS.some(([date, amountMinor]) => row.date === date && row.amountMinor === amountMinor);
}

// The September statement as the app saves it: a statement import of the
// rows it listed and its checkpoint. Its balance is set to what the ledger
// adds up to, so it matches before the export arrives.
async function saveSeptemberStatement(db, api, parsedRows, { leaveOut = () => false } = {}) {
  const [citi] = await rows(db, "SELECT id FROM accounts WHERE account_name = ?", CITI);
  const listed = parsedRows.filter((row) => row.date <= STATEMENT_END && !isLateRow(ledgerRow(row)) && !leaveOut(ledgerRow(row)));
  const statementCheckpoints = [{
    accountName: CITI,
    checkpointMonth: "2026-09",
    statementStartDate: "2026-08-12",
    statementEndDate: STATEMENT_END,
    statementBalanceMinor: 0
  }];
  const preview = await api("/api/imports/preview", {
    sourceLabel: "Citi Rewards September statement",
    sourceType: "pdf",
    parserKey: "citibank_credit_card_pdf",
    rows: listed,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const commit = await api("/api/imports/commit", {
    sourceLabel: "Citi Rewards September statement",
    sourceType: "pdf",
    parserKey: "citibank_credit_card_pdf",
    rows: committable(preview.payload.preview.previewRows),
    statementCheckpoints
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [account] = (await loadAccounts(db)).filter((item) => item.id === citi.id);
  const september = account.checkpointHistory.find((item) => item.month === "2026-09");
  await db
    .prepare("UPDATE account_balance_checkpoints SET statement_balance_minor = ? WHERE account_id = ? AND checkpoint_month = '2026-09'")
    .bind(-september.computedBalanceMinor, citi.id)
    .run();
  return citi.id;
}

// What the page sends: the rows the preview keeps.
function committable(previewRows) {
  return previewRows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review");
}

async function septemberDelta(db, accountId) {
  const [account] = (await loadAccounts(db)).filter((item) => item.id === accountId);
  return account.checkpointHistory.find((item) => item.month === "2026-09")?.deltaMinor;
}

test("rows an activity export adds inside a saved statement's cycle belong to the next statement", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const parsed = parseCitibankActivityCsv(CSV, "ACCT_349_01_09_2026.csv", { accountName: CITI, accountKind: "credit_card", institution: "Citibank" });
  const accountId = await saveSeptemberStatement(db, api, parsed.rows);
  assert.equal(await septemberDelta(db, accountId), 0, "the saved statement matches before the export");

  const preview = await api("/api/imports/preview", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "csv",
    parserKey: parsed.parserKey,
    rows: parsed.rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: []
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const commit = await api("/api/imports/commit", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "csv",
    parserKey: parsed.parserKey,
    rows: committable(preview.payload.preview.previewRows)
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));

  // The three late rows keep their purchase day and post the day after the
  // statement closed.
  const late = await rows(db, `
    SELECT transaction_date, post_date, amount_minor FROM transactions
    WHERE account_id = ? AND import_id = ? AND transaction_date <= ?
    ORDER BY transaction_date, amount_minor DESC
  `, accountId, commit.payload.importId, STATEMENT_END);
  assert.deepEqual(late, LATE_ROWS.map(([date, amountMinor]) => ({ transaction_date: date, post_date: "2026-09-12", amount_minor: amountMinor })));

  // Rows after the statement keep the day the export gives them.
  const [after] = await rows(db, `
    SELECT post_date FROM transactions WHERE account_id = ? AND import_id = ? AND amount_minor = 6030
  `, accountId, commit.payload.importId);
  assert.equal(after.post_date, "2026-09-12");
  const [later] = await rows(db, `
    SELECT post_date FROM transactions WHERE account_id = ? AND import_id = ? AND amount_minor = 18463
  `, accountId, commit.payload.importId);
  assert.equal(later.post_date, "2026-09-16");

  assert.equal(await septemberDelta(db, accountId), 0, "the saved statement still matches after the export");
});

test("an export for a card with no saved statement keeps every row on its own day", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const parsed = parseCitibankActivityCsv(CSV, "ACCT_349_01_09_2026.csv", { accountName: CITI, accountKind: "credit_card", institution: "Citibank" });
  const preview = await api("/api/imports/preview", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "csv",
    parserKey: parsed.parserKey,
    rows: parsed.rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: []
  });
  const commit = await api("/api/imports/commit", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "csv",
    parserKey: parsed.parserKey,
    rows: committable(preview.payload.preview.previewRows)
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const shifted = await rows(db, `
    SELECT COUNT(*) AS count FROM transactions
    WHERE import_id = ? AND post_date <> transaction_date
  `, commit.payload.importId);
  assert.equal(shifted[0].count, 0);
});

test("an older row the statement does not list still needs review, and included it posts after the close", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const parsed = parseCitibankActivityCsv(CSV, "ACCT_349_01_09_2026.csv", { accountName: CITI, accountKind: "credit_card", institution: "Citibank" });
  // As if the statement had left out the 5 Sep CHABAIKDO charge.
  const isChabaikdo = (row) => row.date === "2026-09-05" && row.amountMinor === 569;
  const accountId = await saveSeptemberStatement(db, api, parsed.rows, { leaveOut: isChabaikdo });

  const preview = await api("/api/imports/preview", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "csv",
    parserKey: parsed.parserKey,
    rows: parsed.rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: []
  });
  const previewRows = preview.payload.preview.previewRows;
  const older = previewRows.find(isChabaikdo);
  assert.deepEqual([older.commitStatus, older.commitStatusReason], [
    "needs_review",
    "Dated inside the confirmed September 2026 statement, but that statement does not list it. Review the source row before importing it."
  ]);
  const late = previewRows.find((row) => row.date === "2026-09-10" && row.amountMinor === 2822);
  assert.deepEqual([late.commitStatus, late.commitStatusReason], [
    "included",
    "Not on the September 2026 statement, which closed just after it, so it counts toward the next statement."
  ]);

  // The person checks the source row and includes it.
  older.commitStatus = "included";
  const commit = await api("/api/imports/commit", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "csv",
    parserKey: parsed.parserKey,
    rows: committable(previewRows)
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.deepEqual(await rows(db, `
    SELECT transaction_date, post_date FROM transactions WHERE account_id = ? AND import_id = ? AND amount_minor = 569
  `, accountId, commit.payload.importId), [{ transaction_date: "2026-09-05", post_date: "2026-09-12" }]);
});
