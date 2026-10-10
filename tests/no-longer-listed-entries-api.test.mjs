// An activity export lists what the bank holds at that moment, pending
// charges included. A pending hold the bank later releases (a Grab order's
// hold before its discount, IDR 502,200, posted as IDR 375,500) is in one
// export and gone from the next. The next export, covering those dates,
// removes the entry the earlier one created; rolling it back brings it back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, postWalletPurchase, saveRate } from "./support/foreign-wallet.mjs";
import { parseCitibankActivityCsv } from "../src/lib/statement-import.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const CITI = "Citi Rewards";
const FIRST_EXPORT = readFileSync(new URL("./fixtures/citibank-activity/ACCT_349_26_09_2026-bali-sanitized.csv", import.meta.url), "utf8");
const HOLD = "Grab* A-9TSU83RWW566AV JAKARTA PUSAT IDN IDR 502,200";

// The next export: the hold released, one new purchase since.
const NEXT_EXPORT = [
  `"11/10/2026","SHOPEE SG MP           SINGAPORE     SGP","-15.00","","'5000000000006349'"`,
  ...FIRST_EXPORT.split("\n").filter((line) => line.trim() && !line.includes("IDR 502,200"))
].join("\n");

function parse(text, fileName) {
  return parseCitibankActivityCsv(text, fileName, { accountName: CITI, accountKind: "credit_card", institution: "Citibank" });
}

async function preview(api, text, fileName) {
  const parsed = parse(text, fileName);
  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "csv",
    parserKey: parsed.parserKey,
    rows: parsed.rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: []
  });
  assert.equal(status, 200, JSON.stringify(payload));
  return { parsed, preview: payload.preview };
}

async function commit(api, { parsed, preview: previewDto }, { keep = false } = {}) {
  const { status, payload } = await api("/api/imports/commit", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "csv",
    parserKey: parsed.parserKey,
    rows: previewDto.previewRows.filter((row) => row.commitStatus === "included"),
    noLongerListedEntries: keep ? [] : (previewDto.noLongerListedEntries ?? []).map(({ transactionId, importId }) => ({ transactionId, importId }))
  });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.importId;
}

const holdEntries = (db) => rows(db, "SELECT id, amount_minor, transaction_date FROM transactions WHERE instr(description, ?) = 1", HOLD);
const citiTotal = async (db) => (await rows(db, "SELECT COALESCE(SUM(amount_minor), 0) AS total FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.account_name = ? AND t.entry_type = 'expense'", CITI))[0].total;

test("the next export removes the hold the bank released, and rolling it back brings the hold back", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  await commit(api, await preview(api, FIRST_EXPORT, "ACCT_349_26_09_2026.csv"));
  const [hold] = await holdEntries(db);
  assert.equal(hold.amount_minor, 3606);
  const totalWithHold = await citiTotal(db);

  const next = await preview(api, NEXT_EXPORT, "ACCT_349_11_10_2026.csv");
  assert.deepEqual(next.preview.noLongerListedEntries.map(({ transactionId, accountName, date, description, amountMinor }) => (
    { transactionId, accountName, date, description: description.slice(0, HOLD.length), amountMinor }
  )), [{ transactionId: hold.id, accountName: CITI, date: "2026-10-05", description: HOLD, amountMinor: 3606 }]);
  // Everything else the bank still lists is the same entry: nothing new but
  // the one purchase since.
  assert.deepEqual(next.preview.previewRows.filter((row) => row.commitStatus === "included").map((row) => row.description), ["SHOPEE SG MP SINGAPORE SGP"]);

  const nextImportId = await commit(api, next);
  assert.deepEqual(await holdEntries(db), []);
  assert.equal(await citiTotal(db), totalWithHold - 3606 + 1500);

  const rollback = await api("/api/imports/rollback", { importId: nextImportId });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await holdEntries(db), [hold]);
  assert.equal(await citiTotal(db), totalWithHold);
});

test("keeping the entries the bank no longer lists leaves them in the ledger", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  await commit(api, await preview(api, FIRST_EXPORT, "ACCT_349_26_09_2026.csv"));
  const [hold] = await holdEntries(db);

  await commit(api, await preview(api, NEXT_EXPORT, "ACCT_349_11_10_2026.csv"), { keep: true });
  assert.deepEqual(await holdEntries(db), [hold]);
});

test("an export that starts later says nothing about the entries before its first day", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await commit(api, await preview(api, FIRST_EXPORT, "ACCT_349_26_09_2026.csv"));

  // Released hold aside, the next cycle's export lists only 1 Oct onwards:
  // the September purchases are not in it, and not gone.
  const fromOctober = NEXT_EXPORT.split("\n").filter((line) => !/"\d\d\/09\/2026"/.test(line)).join("\n");
  const next = await preview(api, fromOctober, "ACCT_349_01_10_2026.csv");
  assert.deepEqual(next.preview.noLongerListedEntries.map((entry) => entry.description.slice(0, HOLD.length)), [HOLD]);
});

test("a purchase you saved yourself is never removed, even when the bank row that updated it is gone", async (t) => {
  const { api, db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const [citi] = await rows(db, "SELECT id FROM accounts WHERE account_name = ?", CITI);
  await enableShortcut(db, { foreignCurrencyAccountId: citi.id });
  await saveRate(db, { quote: "IDR", quotePerBase: 14000 });
  // The hold saved through Apple Pay first, so the first export updates it.
  const { payload: saved } = await postWalletPurchase(fetchWorker, { amount: "IDR 502,200", description: "GrabFood Mr.Smash Burger", date: "2026-10-05" });
  await db.prepare("UPDATE transactions SET amount_minor = 3500 WHERE id = ?").bind(saved.entryId).run();

  const first = await preview(api, FIRST_EXPORT, "ACCT_349_26_09_2026.csv");
  assert.equal(first.preview.previewRows.find((row) => row.description.startsWith(HOLD)).reconciliationTargetTransactionId, saved.entryId);
  await commit(api, first);

  const next = await preview(api, NEXT_EXPORT, "ACCT_349_11_10_2026.csv");
  assert.deepEqual(next.preview.noLongerListedEntries, []);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM transactions WHERE id = ?", saved.entryId))[0].n, 1);
});

test("an earlier export waits for the later export that removed one of its entries to be rolled back first", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const firstImportId = await commit(api, await preview(api, FIRST_EXPORT, "ACCT_349_26_09_2026.csv"));
  const nextImportId = await commit(api, await preview(api, NEXT_EXPORT, "ACCT_349_11_10_2026.csv"));

  const early = await api("/api/imports/rollback", { importId: firstImportId });
  assert.equal(early.status, 409);
  assert.equal(early.payload.error, "This import cannot be rolled back yet: a later import removed one of its entries. Roll back the later import first.");

  assert.equal((await api("/api/imports/rollback", { importId: nextImportId })).status, 200);
  assert.equal((await api("/api/imports/rollback", { importId: firstImportId })).status, 200);
  assert.deepEqual(await holdEntries(db), []);
});
