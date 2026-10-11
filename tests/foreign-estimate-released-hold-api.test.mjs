// A foreign currency estimate saved at a hold's amount (Apple Pay showed
// the IDR 502,200 hold) pairs with the hold's row in the first activity
// export. The next export no longer lists the hold and charges IDR 375,500
// instead: a different purchase amount, so nothing pairs it by itself. The
// preview names the estimate and the rows that may be its final charge; the
// user links one, or the estimate goes back to its own saved amount. Either
// way rolling the export back puts the estimate back on the hold's row.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, postWalletPurchase, saveRate } from "./support/foreign-wallet.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const CITI = "Citi Rewards";
const row = (date, description, expense) => ({ date, description, expense, income: "", account: CITI, category: "Other", type: "expense" });
const HOLD = row("2026-10-05", "Grab* A-9TSU83RWW566AV JAKARTA PUSAT IDN IDR 502,200 Rp. 502,200", "36.06");
const FINAL = row("2026-10-05", "Grab* A-9TSU83RWW566AV JAKARTA PUSATID XXXX-XXXX-XXXX- IDR 375,500 Rp. 375,500", "27.83");
const COFFEE = row("2026-10-03", "COFFEE CORNER SINGAPORE SGP", "4.20");
const BOOKSHOP = row("2026-10-07", "BOOKSHOP SINGAPORE SGP", "12.00");
const FIRST = [COFFEE, HOLD, BOOKSHOP];
const NEXT = [COFFEE, FINAL, BOOKSHOP, row("2026-10-09", "BAKERY SINGAPORE SGP", "6.50")];

async function setUp(t) {
  const workspace = await openSeededDatabase(t, template);
  const [citi] = await rows(workspace.db, "SELECT id FROM accounts WHERE account_name = ?", CITI);
  await enableShortcut(workspace.db, { foreignCurrencyAccountId: citi.id });
  await saveRate(workspace.db);
  const { status, payload } = await postWalletPurchase(workspace.fetch, { amount: "IDR 502,200", description: "GrabFood Mr.Smash Burger", date: "2026-10-05" });
  assert.equal(status, 200, JSON.stringify(payload));
  return { ...workspace, estimateId: payload.entryId };
}

async function preview(api, sourceLabel, exportRows) {
  const { status, payload } = await api("/api/imports/preview", { sourceLabel, sourceType: "csv", rows: exportRows, ownershipType: "direct", ownerName: "Tim" });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.preview;
}

async function commit(api, sourceLabel, previewDto, { linkRowId, estimateId, reopen = true } = {}) {
  const committedRows = previewDto.previewRows
    .filter((item) => item.commitStatus === "included")
    .map((item) => (item.rowId === linkRowId ? { ...item, reconciliationTargetTransactionId: estimateId } : item));
  const { status, payload } = await api("/api/imports/commit", {
    sourceLabel,
    sourceType: "csv",
    parserKey: "citibank_credit_card_activity_csv",
    rows: committedRows,
    reopenedEstimates: reopen && !linkRowId ? (previewDto.unlistedEstimates ?? []).map(({ transactionId, importId }) => ({ transactionId, importId })) : []
  });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.importId;
}

const estimateRow = async (db, id) => (await rows(db, "SELECT amount_minor, import_id, post_date, description, original_amount_minor, original_currency FROM transactions WHERE id = ?", id))[0];
const grabEntries = (db) => rows(db, "SELECT amount_minor FROM transactions WHERE description LIKE 'Grab*%' OR description LIKE 'GrabFood%' ORDER BY amount_minor");

async function importFirstExport(api, db, estimateId) {
  const first = await preview(api, "Citi activity 6 Oct", FIRST);
  assert.equal(first.previewRows[1].reconciliationTargetTransactionId, estimateId);
  const firstImportId = await commit(api, "Citi activity 6 Oct", first);
  assert.deepEqual(await estimateRow(db, estimateId), {
    amount_minor: 3606, import_id: firstImportId, post_date: "2026-10-05", description: HOLD.description,
    original_amount_minor: 50220000, original_currency: "IDR"
  });
  return firstImportId;
}

test("the next export names the estimate whose hold it no longer lists, with the charge that may be its final amount", async (t) => {
  const { api, db, estimateId } = await setUp(t);
  const firstImportId = await importFirstExport(api, db, estimateId);

  const next = await preview(api, "Citi activity 10 Oct", NEXT);
  const finalRow = next.previewRows.find((item) => item.description.startsWith("Grab*"));
  assert.deepEqual(next.unlistedEstimates, [{
    transactionId: estimateId,
    importId: firstImportId,
    accountId: finalRow.accountId,
    accountName: CITI,
    date: "2026-10-05",
    walletDescription: "GrabFood Mr.Smash Burger",
    originalAmount: "IDR 502,200",
    currency: "SGD",
    amountMinor: 3606,
    restoredAmountMinor: 3581,
    candidates: [{ rowId: finalRow.rowId, date: "2026-10-05", description: FINAL.description, amountMinor: 2783 }]
  }]);
  // An estimate is the user's own record: never removed as no longer listed.
  assert.deepEqual(next.noLongerListedEntries, []);
  assert.deepEqual([finalRow.commitStatus, finalRow.reconciliationTargetTransactionId], ["included", undefined]);
});

test("linking the final charge moves the estimate onto it, and rolling back puts it back on the hold", async (t) => {
  const { api, db, estimateId } = await setUp(t);
  const firstImportId = await importFirstExport(api, db, estimateId);
  const next = await preview(api, "Citi activity 10 Oct", NEXT);

  const nextImportId = await commit(api, "Citi activity 10 Oct", next, { linkRowId: next.unlistedEstimates[0].candidates[0].rowId, estimateId });
  assert.deepEqual(await estimateRow(db, estimateId), {
    amount_minor: 2783, import_id: nextImportId, post_date: "2026-10-05", description: FINAL.description,
    original_amount_minor: 50220000, original_currency: "IDR"
  });
  assert.deepEqual(await grabEntries(db), [{ amount_minor: 2783 }]);

  assert.equal((await api("/api/imports/rollback", { importId: nextImportId })).status, 200);
  assert.equal((await estimateRow(db, estimateId)).import_id, firstImportId);
  assert.equal((await estimateRow(db, estimateId)).amount_minor, 3606);
});

test("left unlinked, the estimate goes back to its own saved amount and the final charge comes in on its own", async (t) => {
  const { api, db, estimateId } = await setUp(t);
  const firstImportId = await importFirstExport(api, db, estimateId);
  const next = await preview(api, "Citi activity 10 Oct", NEXT);

  const nextImportId = await commit(api, "Citi activity 10 Oct", next);
  assert.deepEqual(await estimateRow(db, estimateId), {
    amount_minor: 3581, import_id: null, post_date: null, description: "GrabFood Mr.Smash Burger",
    original_amount_minor: 50220000, original_currency: "IDR"
  });
  assert.deepEqual(await grabEntries(db), [{ amount_minor: 2783 }, { amount_minor: 3581 }]);

  // The first export waits for the later one, which changed its entry.
  const early = await api("/api/imports/rollback", { importId: firstImportId });
  assert.equal(early.status, 409);
  assert.equal((await api("/api/imports/rollback", { importId: nextImportId })).status, 200);
  assert.deepEqual(await estimateRow(db, estimateId), {
    amount_minor: 3606, import_id: firstImportId, post_date: "2026-10-05", description: HOLD.description,
    original_amount_minor: 50220000, original_currency: "IDR"
  });
  assert.equal((await api("/api/imports/rollback", { importId: firstImportId })).status, 200);
  assert.equal((await estimateRow(db, estimateId)).amount_minor, 3581);
});

test("an export that still lists the estimate's row says nothing about it", async (t) => {
  const { api, db, estimateId } = await setUp(t);
  await importFirstExport(api, db, estimateId);

  const again = await preview(api, "Citi activity 8 Oct", [...FIRST, row("2026-10-08", "BAKERY SINGAPORE SGP", "6.50")]);
  assert.deepEqual(again.unlistedEstimates, []);
});
