// Entry and linked split sync: adding an entry to splits refreshes the month
// totals in its own batch; an entry edit copies its event date, description
// and payer to the linked split when the split still mirrors them; a deleted
// (archived) split no longer counts as the entry's link. Runs against a real
// local D1 (Miniflare) seeded with the demo household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows,
  snapshotTotals
} from "./support/d1-workspace.mjs";
import { recalculateMonthlySnapshots } from "../src/domain/app-repository-snapshots.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const MONTH = "2026-05";
const DATE = "2026-05-16";

function scopeTotal(totals, scope) {
  return totals.find((row) => row.person_scope === scope)?.total_expense_minor;
}

async function addToSplits(api, entryId, splitGroupId = null) {
  const split = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  return split.payload.splitExpenseId;
}

async function createLinkedEntry(api, { description, amountMinor = 6_000, date = DATE }) {
  const entryId = await createEntry(api, { date, description, amountMinor });
  return { entryId, splitExpenseId: await addToSplits(api, entryId) };
}

async function entryRow(api, view, entryId, month = MONTH) {
  const page = await api(`/api/entries-page?view=${view}&month=${month}`);
  assert.equal(page.status, 200);
  return page.payload.monthPage.entries.find((entry) => entry.id === entryId);
}

async function splitActivity(api, splitExpenseId, month = MONTH) {
  const page = await api(`/api/splits-page?view=person-tim&month=${month}`);
  assert.equal(page.status, 200);
  return page.payload.splitsPage.activity.find((item) => item.id === splitExpenseId);
}

async function timSummaryExpenses(api) {
  const summary = await api(`/api/summary-page?view=person-tim&month=${MONTH}&summary_start=${MONTH}&summary_end=${MONTH}`);
  assert.equal(summary.status, 200, JSON.stringify(summary.payload));
  return summary.payload.summaryPage.months.find((item) => item.month === MONTH).realExpensesMinor;
}

async function splitRow(db, splitExpenseId) {
  const [row] = await rows(db, `
    SELECT expense_date, description, payer_person_id, split_group_id, split_batch_id, category_id,
      total_amount_minor, currency, home_amount_minor, fx_rate_basis_points, payment_method,
      payment_status, note, linked_transaction_id, deleted_at IS NOT NULL AS archived
    FROM split_expenses WHERE id = ?
  `, splitExpenseId);
  return row;
}

async function shareRows(db, splitExpenseId) {
  return rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", splitExpenseId);
}

// The payload the Entries editor sends: every loaded entry is direct.
function entryEdit(entryId, fields) {
  return {
    entryId,
    date: DATE,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 6_000,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note: "",
    ...fields
  };
}

// --- Adding an entry to splits refreshes month totals -----------------------

test("adding an entry to splits moves each person's month total to their share in the same write", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Split sync add", amountMinor: 6_000 });
  const before = await snapshotTotals(db, MONTH);
  const summaryBefore = await timSummaryExpenses(api);

  const splitExpenseId = await addToSplits(api, entryId);

  const after = await snapshotTotals(db, MONTH);
  // Tim paid 60.00 and now carries half; Joyce's view gains the other half.
  assert.equal(scopeTotal(after, "person-tim") - scopeTotal(before, "person-tim"), -3_000);
  assert.equal(scopeTotal(after, "person-joyce") - scopeTotal(before, "person-joyce"), 3_000);
  assert.equal(scopeTotal(after, "household"), scopeTotal(before, "household"));
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
  // The stored totals are what a full recalculation gives.
  await recalculateMonthlySnapshots(db, MONTH);
  assert.deepEqual(await snapshotTotals(db, MONTH), after);

  // The Summary page recomputes actual spend from the entries on each read,
  // so it already showed the share; the stored totals now agree with it.
  assert.equal(await timSummaryExpenses(api) - summaryBefore, -3_000);
  assert.equal((await entryRow(api, "person-tim", entryId)).linkedSplitExpenseId, splitExpenseId);
});

test("adding an entry to splits that fails on its shares leaves no split, batch or marker behind", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Split sync add atomic", amountMinor: 6_000 });
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO split_expense_shares/);

  // Okaeri has no open batch, so this add would also open one.
  const split = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: "split-group-okaeri" }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(split.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("adding an income entry to splits is rejected and changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Split sync income", amountMinor: 6_000, entryType: "income", categoryName: "Salary" });
  const before = await dumpDatabase(db);

  const split = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null });

  assert.equal(split.status, 400);
  assert.match(split.payload.error, /Only expense entries/);
  assertSameDatabase(await dumpDatabase(db), before);
});

// --- Entry edits copy mirrored fields to the linked split -------------------

test("editing a linked entry's date, description and payer copies them to its split and keeps split-only fields", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description: "Split sync mirror" });
  const note = await api("/api/splits/expenses/update-note", { splitExpenseId, note: "Split-only note" });
  assert.equal(note.status, 200, JSON.stringify(note.payload));
  const before = await splitRow(db, splitExpenseId);
  const sharesBefore = await shareRows(db, splitExpenseId);
  assert.equal(before.payer_person_id, "person-tim");

  const update = await api("/api/entries/update", entryEdit(entryId, {
    date: "2026-05-18",
    description: "Split sync mirror renamed",
    ownerName: "Joyce",
    note: "Entry-only note"
  }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual(await splitRow(db, splitExpenseId), {
    ...before,
    expense_date: "2026-05-18",
    description: "Split sync mirror renamed",
    payer_person_id: "person-joyce"
  });
  assert.deepEqual(await shareRows(db, splitExpenseId), sharesBefore);

  const activity = await splitActivity(api, splitExpenseId);
  assert.equal(activity.date, "2026-05-18");
  assert.equal(activity.description, "Split sync mirror renamed");
  assert.equal(activity.paidByPersonName, "Joyce");
  assert.equal(activity.note, "Split-only note");
  const joyceRow = await entryRow(api, "person-joyce", entryId);
  assert.equal(joyceRow.linkedSplitExpenseId, splitExpenseId);
  assert.equal(joyceRow.linkedSplitNote, "Split-only note");
  assert.equal(joyceRow.note, "Entry-only note");
});

test("a split field that no longer mirrors its entry keeps its own value", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description: "Split sync own" });
  // The split's description is changed in Splits, so it no longer mirrors the entry.
  const splitEdit = await api("/api/splits/expenses/update", {
    splitExpenseId,
    groupId: null,
    date: DATE,
    description: "Dinner with Joyce",
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 6_000,
    splitBasisPoints: 5_000,
    homeAmountMinor: 6_000,
    paymentMethod: "bank",
    paymentStatus: "certified"
  });
  assert.equal(splitEdit.status, 200, JSON.stringify(splitEdit.payload));

  const update = await api("/api/entries/update", entryEdit(entryId, { date: "2026-05-19", description: "SPLIT SYNC OWN SINGAPORE" }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  const after = await splitRow(db, splitExpenseId);
  assert.equal(after.description, "Dinner with Joyce");
  // The date still mirrored the entry, so it follows.
  assert.equal(after.expense_date, "2026-05-19");
  assert.equal(after.payer_person_id, "person-tim");
});

test("a travel-currency split follows the entry's date and keeps its own amounts", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description: "Split sync travel", amountMinor: 9_000 });
  await db.batch([
    db.prepare("UPDATE split_expenses SET currency = 'JPY', total_amount_minor = 10000, home_amount_minor = 9000, fx_rate_basis_points = 9000 WHERE id = ?").bind(splitExpenseId),
    db.prepare("UPDATE split_expense_shares SET amount_minor = 5000 WHERE split_expense_id = ?").bind(splitExpenseId)
  ]);
  const before = await splitRow(db, splitExpenseId);
  const sharesBefore = await shareRows(db, splitExpenseId);

  const update = await api("/api/entries/update", entryEdit(entryId, { date: "2026-05-17", description: "Split sync travel", amountMinor: 9_000 }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual(await splitRow(db, splitExpenseId), { ...before, expense_date: "2026-05-17" });
  assert.deepEqual(await shareRows(db, splitExpenseId), sharesBefore);
});

test("a linked entry edit that fails while copying to its split changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId } = await createLinkedEntry(api, { description: "Split sync mirror atomic" });
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE split_expenses SET expense_date/);

  const update = await api("/api/entries/update", entryEdit(entryId, { description: "Split sync mirror atomic renamed" }), { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(update.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

// --- A deleted split is not the entry's link --------------------------------

test("deleting a linked split clears the shared state in every projection and allows adding it again", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: DATE, description: "Split sync delete", amountMinor: 6_000 });
  const unlinkedTotals = await snapshotTotals(db, MONTH);
  const splitExpenseId = await addToSplits(api, entryId);

  const deleted = await api("/api/splits/expenses/delete", { splitExpenseId });

  assert.equal(deleted.status, 200, JSON.stringify(deleted.payload));
  // The archived split keeps its ledger link so a restore can bring it back.
  assert.equal((await splitRow(db, splitExpenseId)).linked_transaction_id, entryId);
  const timRow = await entryRow(api, "person-tim", entryId);
  assert.equal(timRow.linkedSplitExpenseId, undefined);
  assert.equal(timRow.linkedSplitShares, undefined);
  assert.equal(timRow.amountMinor, 6_000);
  const joyceRow = await entryRow(api, "person-joyce", entryId);
  assert.equal(joyceRow.linkedSplitExpenseId, undefined);
  assert.equal(joyceRow.viewerSplitRatioBasisPoints, undefined);
  // Month totals are back to the unlinked entry, refreshed by the delete.
  assert.deepEqual(await snapshotTotals(db, MONTH), unlinkedTotals);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);

  const readdedId = await addToSplits(api, entryId);
  assert.notEqual(readdedId, splitExpenseId);
  assert.equal((await entryRow(api, "person-tim", entryId)).linkedSplitExpenseId, readdedId);
  assert.equal((await entryRow(api, "person-tim", entryId)).amountMinor, 3_000);
});

test("restoring a deleted linked split links the entry again, unless the entry is linked to another split", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description: "Split sync restore" });
  const linkedTotals = await snapshotTotals(db, MONTH);
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId })).status, 200);

  const restored = await api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: splitExpenseId });

  assert.equal(restored.status, 200, JSON.stringify(restored.payload));
  assert.equal((await entryRow(api, "person-tim", entryId)).linkedSplitExpenseId, splitExpenseId);
  assert.deepEqual(await snapshotTotals(db, MONTH), linkedTotals);

  // Delete it again and add the entry to a new split: the old one cannot
  // come back as a second split of the same entry.
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId })).status, 200);
  const readdedId = await addToSplits(api, entryId);
  const beforeRejectedRestore = await dumpDatabase(db);

  const rejected = await api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: splitExpenseId });

  assert.equal(rejected.status, 400);
  assert.match(rejected.payload.error, /linked to another split/);
  assertSameDatabase(await dumpDatabase(db), beforeRejectedRestore);
  assert.equal((await entryRow(api, "person-tim", entryId)).linkedSplitExpenseId, readdedId);
});

test("saving an entry as Shared links a new split instead of rewriting its archived one", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId, splitExpenseId: archivedId } = await createLinkedEntry(api, { description: "Split sync shared save" });
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId: archivedId })).status, 200);
  const archivedShares = await shareRows(db, archivedId);

  const update = await api("/api/entries/update", entryEdit(entryId, { description: "Split sync shared save", ownershipType: "shared", splitBasisPoints: 8_000 }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual(await shareRows(db, archivedId), archivedShares);
  const row = await entryRow(api, "person-tim", entryId);
  assert.ok(row.linkedSplitExpenseId && row.linkedSplitExpenseId !== archivedId, "the entry is linked to a new active split");
  assert.equal(row.amountMinor, 4_800);

  // With an active split, the Shared save updates that split, not the archived one.
  const again = await api("/api/entries/update", entryEdit(entryId, { description: "Split sync shared save", ownershipType: "shared", splitBasisPoints: 2_500 }));
  assert.equal(again.status, 200, JSON.stringify(again.payload));
  assert.deepEqual(await shareRows(db, archivedId), archivedShares);
  assert.equal((await entryRow(api, "person-tim", entryId)).amountMinor, 1_500);
});

test("an archived split follows its entry's edits so a restore matches the ledger", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description: "Split sync archived follow" });
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId })).status, 200);

  const update = await api("/api/entries/update", entryEdit(entryId, { date: "2026-05-20", description: "Split sync archived renamed", amountMinor: 7_000 }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  const after = await splitRow(db, splitExpenseId);
  assert.equal(after.archived, 1);
  assert.equal(after.expense_date, "2026-05-20");
  assert.equal(after.description, "Split sync archived renamed");
  assert.equal(after.total_amount_minor, 7_000);
  assert.deepEqual((await shareRows(db, splitExpenseId)).map((share) => share.amount_minor), [3_500, 3_500]);
});

test("a split delete that fails while recording its history changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { splitExpenseId } = await createLinkedEntry(api, { description: "Split sync delete atomic" });
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO split_activity_history/);

  const deleted = await api("/api/splits/expenses/delete", { splitExpenseId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(deleted.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a split restore that fails while recording its history changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { splitExpenseId } = await createLinkedEntry(api, { description: "Split sync restore atomic" });
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId })).status, 200);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO split_activity_history/);

  const restored = await api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: splitExpenseId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(restored.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

// --- Matching a split to an imported entry ----------------------------------

// An imported expense that no split record holds yet.
async function unlinkedImportedExpense(db) {
  const [row] = await rows(db, `
    SELECT transactions.id, transactions.transaction_date, transactions.amount_minor
    FROM transactions INNER JOIN imports ON imports.id = transactions.import_id
    WHERE imports.status = 'completed' AND transactions.entry_type = 'expense'
      AND NOT EXISTS (SELECT 1 FROM split_expenses WHERE linked_transaction_id = transactions.id)
    ORDER BY transactions.transaction_date, transactions.id
    LIMIT 1
  `);
  assert.ok(row, "the demo seed has an unlinked imported expense");
  return row;
}

async function createSplitFor(api, transaction, description) {
  const created = await api("/api/splits/expenses/create", {
    groupId: null,
    date: transaction.transaction_date,
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: Math.abs(transaction.amount_minor),
    splitBasisPoints: 5_000,
    paymentMethod: "bank",
    paymentStatus: "recorded"
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.splitExpenseId;
}

test("matching a split to an imported entry refreshes month totals, and deleting the match frees the entry", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const transaction = await unlinkedImportedExpense(db);
  const month = transaction.transaction_date.slice(0, 7);
  const firstId = await createSplitFor(api, transaction, "Split sync match first");
  await recalculateMonthlySnapshots(db, month);
  const before = await snapshotTotals(db, month);

  const linked = await api("/api/splits/matches/link-expense", { splitExpenseId: firstId, transactionId: transaction.id });

  assert.equal(linked.status, 200, JSON.stringify(linked.payload));
  const [owner] = await rows(db, "SELECT COALESCE(transactions.owner_person_id, accounts.owner_person_id) AS person_id FROM transactions INNER JOIN accounts ON accounts.id = transactions.account_id WHERE transactions.id = ?", transaction.id);
  const other = owner.person_id === "person-tim" ? "person-joyce" : "person-tim";
  const shares = Object.fromEntries((await shareRows(db, firstId)).map((share) => [share.person_id, share.amount_minor]));
  const afterLink = await snapshotTotals(db, month);
  assert.equal(scopeTotal(afterLink, owner.person_id) - scopeTotal(before, owner.person_id), shares[owner.person_id] - Math.abs(transaction.amount_minor));
  assert.equal(scopeTotal(afterLink, other) - scopeTotal(before, other), shares[other]);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);

  // Deleting the matched split frees the entry for another split record.
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId: firstId })).status, 200);
  assert.deepEqual(await snapshotTotals(db, month), before);
  const secondId = await createSplitFor(api, transaction, "Split sync match second");
  const relinked = await api("/api/splits/matches/link-expense", { splitExpenseId: secondId, transactionId: transaction.id });
  assert.equal(relinked.status, 200, JSON.stringify(relinked.payload));
  assert.equal((await entryRow(api, "person-tim", transaction.id, month)).linkedSplitExpenseId, secondId);

  // Nothing else can take the row while the second split holds it.
  const thirdId = await createSplitFor(api, transaction, "Split sync match third");
  const refused = await api("/api/splits/matches/link-expense", { splitExpenseId: thirdId, transactionId: transaction.id });
  assert.equal(refused.status, 400);
  assert.match(refused.payload.error, /already linked to another split record/);
  const restore = await api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: firstId });
  assert.equal(restore.status, 400);
  assert.match(restore.payload.error, /linked to another split/);
});

test("a split match that fails on its month refresh marker changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const transaction = await unlinkedImportedExpense(db);
  const splitExpenseId = await createSplitFor(api, transaction, "Split sync match atomic");
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO monthly_snapshot_refreshes/);

  const linked = await api("/api/splits/matches/link-expense", { splitExpenseId, transactionId: transaction.id }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(linked.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});
