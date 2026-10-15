// The time an entry was made, through the real Worker and a real local D1
// (Miniflare): the Apple Pay Shortcut and hand-made entries store the
// household's clock time, a bank row has none, a statement keeps the time of
// the entry it certifies, and the time never takes part in matching.
import assert from "node:assert/strict";
import test from "node:test";

import { createEntry, createSeededTemplate, failingStatement, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, postWalletPurchase, saveRate } from "./support/foreign-wallet.mjs";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { entryTimeInAppTimeZone } from "../src/lib/entry-time.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const CITI = "Citi Rewards";

// The clock reads before and after a request: the stored time is one of
// them (the minute may roll over while the request runs).
async function clockAround(run) {
  const before = entryTimeInAppTimeZone(new Date());
  const result = await run();
  const after = entryTimeInAppTimeZone(new Date());
  return { result, accepted: new Set([before, after]) };
}

const timeOf = async (db, entryId) => (await rows(db, "SELECT transaction_time FROM transactions WHERE id = ?", entryId))[0].transaction_time;

const handEntry = (input = {}) => ({
  accountName: "UOB One",
  categoryName: "Groceries",
  entryType: "expense",
  ownershipType: "direct",
  ownerName: "Tim",
  description: "Kopi",
  amountMinor: 500,
  ...input
});

test("the Shortcut saves the time it received the purchase, in Singapore time", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);

  const { result, accepted } = await clockAround(() => postWalletPurchase(fetchWorker, { date: todayInAppTimeZone(), amount: "SGD 4.80", description: "Toast Box", requestId: "time-request-001" }));

  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.ok(accepted.has(await timeOf(db, result.payload.entryId)), "stored the Singapore clock time of the request");
  assert.match(await timeOf(db, result.payload.entryId), /^\d\d:\d\d$/);

  // The Shortcut's retry of the same purchase keeps the first time.
  await db.prepare("UPDATE transactions SET transaction_time = '08:15' WHERE id = ?").bind(result.payload.entryId).run();
  const replay = await postWalletPurchase(fetchWorker, { date: todayInAppTimeZone(), amount: "SGD 4.80", description: "Toast Box", requestId: "time-request-001" });
  assert.deepEqual([replay.payload.created, await timeOf(db, result.payload.entryId)], [false, "08:15"]);
});

test("a Shortcut purchase dated another day gets no time", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await enableShortcut(db);

  const { status, payload } = await postWalletPurchase(fetchWorker, { date: "2026-09-30", amount: "SGD 4.80", description: "Toast Box" });

  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(await timeOf(db, payload.entryId), null);
});

test("a hand-made entry keeps the time it is given, now by default for today, and none for another day", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const today = todayInAppTimeZone();

  const given = await api("/api/entries/create", handEntry({ date: "2026-09-30", time: "14:32" }));
  assert.equal(given.status, 200, JSON.stringify(given.payload));
  assert.equal(await timeOf(db, given.payload.entryId), "14:32");

  const { result: byDefault, accepted } = await clockAround(() => api("/api/entries/create", handEntry({ date: today })));
  assert.ok(accepted.has(await timeOf(db, byDefault.payload.entryId)));

  const backdated = await api("/api/entries/create", handEntry({ date: "2026-09-30" }));
  assert.equal(await timeOf(db, backdated.payload.entryId), null);

  const cleared = await api("/api/entries/create", handEntry({ date: today, time: null }));
  assert.equal(await timeOf(db, cleared.payload.entryId), null);
  const blank = await api("/api/entries/create", handEntry({ date: today, time: "" }));
  assert.equal(await timeOf(db, blank.payload.entryId), null);
});

test("an entry with a time that is not HH:MM is refused and nothing is saved", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const before = (await rows(db, "SELECT COUNT(*) AS count FROM transactions"))[0].count;

  for (const time of ["25:00", "2:32 pm", "12:61", 1432]) {
    const refused = await api("/api/entries/create", handEntry({ date: "2026-09-30", time }));
    assert.equal(refused.status, 400, String(time));
    assert.equal(refused.payload.error, "Time must be hours and minutes like 14:32.");
  }
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM transactions"))[0].count, before);
});

test("an update keeps the time unless it names one, and a date change keeps it too", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: "2026-09-30", description: "Kopi", amountMinor: 500, time: "14:32" });
  const edit = (changes) => api("/api/entries/update", {
    entryId,
    date: "2026-09-30",
    description: "Kopi",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 500,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    ...changes
  });

  assert.equal((await edit({ description: "Kopi O" })).status, 200);
  assert.equal(await timeOf(db, entryId), "14:32");

  assert.equal((await edit({ date: "2026-09-29" })).status, 200);
  assert.deepEqual((await rows(db, "SELECT transaction_date, transaction_time FROM transactions WHERE id = ?", entryId))[0], { transaction_date: "2026-09-29", transaction_time: "14:32" });

  assert.equal((await edit({ date: "2026-09-29", time: "09:05" })).status, 200);
  assert.equal(await timeOf(db, entryId), "09:05");

  const bad = await edit({ date: "2026-09-29", time: "9.05" });
  assert.deepEqual([bad.status, bad.payload.error], [400, "Time must be hours and minutes like 14:32."]);
  assert.equal(await timeOf(db, entryId), "09:05");

  assert.equal((await edit({ date: "2026-09-29", time: null })).status, 200);
  assert.equal(await timeOf(db, entryId), null);
});

test("a failed create or update leaves no time behind", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: "2026-09-30", description: "Kopi", amountMinor: 500, time: "14:32" });
  const before = (await rows(db, "SELECT COUNT(*) AS count FROM transactions"))[0].count;

  const failingCreate = failingStatement(db, /INSERT INTO transactions/);
  const created = await api("/api/entries/create", handEntry({ date: "2026-09-30", time: "10:00" }), { database: failingCreate.db });
  assert.equal(created.status, 400);
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM transactions"))[0].count, before);

  const failingUpdate = failingStatement(db, /UPDATE transactions\s+SET\s+transaction_date/);
  const updated = await api("/api/entries/update", {
    entryId, date: "2026-09-30", description: "Kopi", accountName: "UOB One", categoryName: "Groceries", amountMinor: 500, entryType: "expense", ownershipType: "direct", ownerName: "Tim", time: "23:59"
  }, { database: failingUpdate.db });
  assert.notEqual(updated.status, 200);
  assert.equal(await timeOf(db, entryId), "14:32");
});

test("the Entries page carries the time only on entries that have one", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const timed = await createEntry(api, { date: "2026-09-30", description: "Timed", amountMinor: 500, time: "14:32" });
  const untimed = await createEntry(api, { date: "2026-09-30", description: "Untimed", amountMinor: 700 });

  const page = (await api("/api/entries-page?view=household&month=2026-09")).payload;
  const byId = new Map(page.monthPage.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.get(timed).time, "14:32");
  assert.equal(Object.hasOwn(byId.get(untimed), "time"), false);
  // Seeded rows have no time: the field is simply absent.
  assert.equal(page.monthPage.entries.filter((entry) => entry.time).length, 1);
});

test("no other page sends an entry's time: Month and Splits responses are unchanged in size", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createEntry(api, { date: "2026-09-30", description: "Timed", amountMinor: 500, time: "14:32" });
  await createEntry(api, { date: "2026-09-30", description: "Timed transfer", amountMinor: 900, entryType: "transfer", categoryName: "Transfer", time: "15:00" });

  const month = (await api("/api/month-page?view=household&month=2026-09")).payload;
  const monthEntries = month.monthPage.entries;
  assert.ok(monthEntries.some((entry) => entry.description === "Timed"), "the entry is on the Month page");
  assert.equal(monthEntries.some((entry) => "time" in entry), false);
  const splits = (await api("/api/splits-page?view=household&month=2026-09")).payload;
  assert.equal(splits.monthPage.entries.some((entry) => "time" in entry), false);
  // Entries still has it.
  const entries = (await api("/api/entries-page?view=household&month=2026-09")).payload;
  assert.deepEqual(entries.monthPage.entries.filter((entry) => entry.time).map((entry) => entry.time).sort(), ["14:32", "15:00"]);
});

test("the schema check adds the column to a database that predates it, and entries still load", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  await db.exec("ALTER TABLE transactions DROP COLUMN transaction_time");
  assert.equal((await rows(db, "PRAGMA table_info(transactions)")).some((column) => column.name === "transaction_time"), false);

  const page = await api("/api/entries-page?view=household&month=2026-09");

  assert.equal(page.status, 200);
  assert.equal((await rows(db, "PRAGMA table_info(transactions)")).some((column) => column.name === "transaction_time"), true);
  const entryId = await createEntry(api, { date: "2026-09-30", description: "After", amountMinor: 500, time: "10:10" });
  assert.equal(await timeOf(db, entryId), "10:10");
});

// A statement row for an Apple Pay estimate, the way the Citi statement words it.
const statementRow = (date, description, amount, purchaseDate = date) => ({
  date, description, expense: amount, income: "", account: CITI, category: "Other", type: "expense", note: `txn date: ${purchaseDate}`
});

async function previewAndCommit(api, statementRows) {
  const base = { sourceLabel: "Citi Rewards Oct 2026", sourceType: "pdf", rows: statementRows, ownershipType: "direct", ownerName: "Tim", statementCheckpoints: [] };
  const { status, payload } = await api("/api/imports/preview", base);
  assert.equal(status, 200, JSON.stringify(payload));
  const preview = payload.preview;
  const commit = await api("/api/imports/commit", {
    sourceLabel: base.sourceLabel,
    sourceType: "pdf",
    parserKey: "citibank_credit_card_pdf",
    statementCheckpoints: [],
    statementControlRows: preview.previewRows,
    statementReconciliations: preview.statementReconciliations,
    rows: preview.previewRows.filter((item) => item.commitStatus === "included")
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  return preview;
}

async function citiWorkspace(t) {
  const workspace = await openSeededDatabase(t, template);
  const [citi] = await rows(workspace.db, "SELECT id FROM accounts WHERE account_name = ?", CITI);
  await enableShortcut(workspace.db, { foreignCurrencyAccountId: citi.id });
  await saveRate(workspace.db);
  return workspace;
}

test("a statement that certifies a timed Apple Pay entry keeps its time, and a new bank row has none", async (t) => {
  const { api, db, fetch: fetchWorker } = await citiWorkspace(t);
  const today = todayInAppTimeZone();
  const { payload } = await postWalletPurchase(fetchWorker, { date: today, amount: "IDR 159,000", description: "Digimap Icon Sanur M23" });
  await db.prepare("UPDATE transactions SET transaction_time = '13:07' WHERE id = ?").bind(payload.entryId).run();

  await previewAndCommit(api, [
    statementRow(today, "AMAZE* DIGIMAP ICON SANUR M23 SINGAPORE SG", "11.61"),
    statementRow(today, "BREADTALK PTE LTD SINGAPORE SG", "6.40")
  ]);

  const [certified] = await rows(db, "SELECT bank_certification_status, transaction_time, amount_minor FROM transactions WHERE id = ?", payload.entryId);
  assert.deepEqual(certified, { bank_certification_status: "statement_certified", transaction_time: "13:07", amount_minor: 1161 });
  const [bankRow] = await rows(db, "SELECT transaction_time FROM transactions WHERE description LIKE 'BREADTALK%'");
  assert.equal(bankRow.transaction_time, null);
});

test("the time never changes which estimate a statement row pairs with", async (t) => {
  const { api, db, fetch: fetchWorker } = await citiWorkspace(t);
  const today = todayInAppTimeZone();
  const first = (await postWalletPurchase(fetchWorker, { date: today, amount: "IDR 43,300", description: "Market City Icon Bali" })).payload.entryId;
  const second = (await postWalletPurchase(fetchWorker, { date: today, amount: "IDR 42,800", description: "Market city ICON Bali Sanur" })).payload.entryId;
  const preview = async () => (await api("/api/imports/preview", {
    sourceLabel: "Citi Rewards Oct 2026",
    sourceType: "pdf",
    rows: [
      statementRow(today, "AMAZE* MARKET CITY ICON BALI SINGAPORE SG", "3.16"),
      statementRow(today, "AMAZE* MARKET CITY ICON BALI SANUR SINGAPORE SG", "3.12")
    ],
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: []
  })).payload.preview.previewRows.map((row) => row.reconciliationTargetTransactionId);

  await db.prepare("UPDATE transactions SET transaction_time = NULL WHERE id IN (?, ?)").bind(first, second).run();
  const withoutTimes = await preview();
  // The later purchase has the earlier clock time: if time mattered, the pairing would flip.
  await db.prepare("UPDATE transactions SET transaction_time = '20:00' WHERE id = ?").bind(first).run();
  await db.prepare("UPDATE transactions SET transaction_time = '08:00' WHERE id = ?").bind(second).run();
  const withTimes = await preview();

  assert.deepEqual(withoutTimes, [first, second]);
  assert.deepEqual(withTimes, withoutTimes);
});
