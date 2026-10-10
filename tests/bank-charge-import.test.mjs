// A card statement's bank charges and their reversals through the real
// import preview and commit (real Worker, local D1). A charge saves in Fees;
// its reversal saves in Fees as income that offsets Fees, so a waived late
// charge nets to nothing there. Wording follows UOB's card statement ("LATE
// CHARGES", "CR LATE CHARGE"), the case in the household's 2026 ledger.
import assert from "node:assert/strict";
import test from "node:test";

import { inferCategory } from "../src/lib/statement-import/shared.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function cardAccount(db) {
  const [account] = await rows(db, "SELECT account_name FROM accounts WHERE account_kind = 'credit_card' ORDER BY account_name LIMIT 1");
  return account.account_name;
}

const statementRow = (account, date, description, { expense = "", income = "" }) => ({
  date,
  description,
  expense,
  income,
  account,
  category: inferCategory(description, Boolean(income)),
  type: income ? "income" : "expense",
  note: ""
});

async function importRows(api, statementRows) {
  const preview = await api("/api/imports/preview", {
    sourceLabel: "Card statement",
    sourceType: "csv",
    rows: statementRows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: []
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const previewRows = preview.payload.preview.previewRows;
  const commit = await api("/api/imports/commit", {
    sourceLabel: "Card statement",
    sourceType: "csv",
    statementCheckpoints: [],
    rows: previewRows.filter((row) => row.commitStatus === "included")
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
}

test("a late charge saves in Fees and its reversal offsets Fees; other income and charges do not offset", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const account = await cardAccount(db);
  await importRows(api, [
    statementRow(account, "2026-06-03", "LATE CHARGES", { expense: "100.00" }),
    statementRow(account, "2026-06-05", "CR LATE CHARGE", { income: "100.00" }),
    statementRow(account, "2026-06-12", "INTERESTS", { expense: "18.37" }),
    statementRow(account, "2026-06-20", "CASH REBATE", { income: "2.36" })
  ]);

  const saved = await rows(db, `
    SELECT transactions.description, transactions.entry_type, transactions.offsets_category, categories.name AS category
    FROM transactions
    LEFT JOIN categories ON categories.id = transactions.category_id
    WHERE transactions.description IN ('LATE CHARGES', 'CR LATE CHARGE', 'INTERESTS', 'CASH REBATE')
    ORDER BY transactions.transaction_date
  `);
  assert.deepEqual(saved.map((row) => [row.description, row.entry_type, row.category, row.offsets_category]), [
    ["LATE CHARGES", "expense", "Fees", 0],
    ["CR LATE CHARGE", "income", "Fees", 1],
    ["INTERESTS", "expense", "Fees", 0],
    ["CASH REBATE", "income", "Other - Income", 0]
  ]);
});
