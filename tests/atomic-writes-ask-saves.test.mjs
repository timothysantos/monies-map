// What Ask's saves really write (Ask audit 2, "Wrong data"; docs/flows/
// ask-flow.md "What a save writes"), through the real Worker on a local D1
// seeded with the demo household (Tim and Joyce). Each command is
// all-or-nothing: a success case pins the rows to the cent, a failure case
// makes one statement fail and proves the database is unchanged.
//
// - B1: a shared expense saved with its split group lands in that group, in
//   the same batch as the entry, with the stated share to the cent; the
//   create answers with the split it made, and a repeat makes nothing new.
// - B2: Ask's Undo removes the entry and the split that save made in one
//   batch; balances and month totals go back exactly.
// - B9: a payment closes a group only when nothing is owed after it; more or
//   less than is owed leaves the rest open, the right way round.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows,
  snapshotTotals
} from "./support/d1-workspace.mjs";
import { loadSummarySplitBalances } from "../src/domain/pages/summary-split-balances.ts";
import { DEFAULT_HOUSEHOLD_ID } from "../src/domain/app-repository-constants.ts";
import { recalculateMonthlySnapshots } from "../src/domain/app-repository-snapshots.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const DATE = "2026-05-14";
const MONTH = "2026-05";

async function people(db) {
  const [tim, joyce] = await rows(db, "SELECT id, display_name FROM people ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END, created_at, id");
  return { tim, joyce };
}

// What Joyce owes Tim per group, as the Splits page and Summary read it
// (positive: Joyce owes Tim; "none" is no group).
async function owedByGroup(db, debtorId, creditorId) {
  void debtorId;
  const lines = await loadSummarySplitBalances(db, creditorId, {});
  return Object.fromEntries(lines.filter((line) => line.balanceMinor !== 0).map((line) => [line.id === "split-group-none" ? "none" : line.id, line.balanceMinor]));
}

function sharedDinner(overrides = {}) {
  return {
    date: DATE,
    description: "Dinner at Jumbo",
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    amountMinor: 8_000,
    entryType: "expense",
    ownershipType: "shared",
    splitBasisPoints: 6250,
    splitAmountMinor: 5_000,
    splitGroupId: "split-group-okaeri",
    externalReference: "ask:audit2-dinner-0001",
    ...overrides
  };
}

// ---------------------------------------------------------------- B1

test("B1: a shared expense saved with its group lands in that group with the stated shares, and says which split it made", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { tim, joyce } = await people(db);
  const owedBefore = await owedByGroup(db, joyce.id, tim.id);

  const saved = await api("/api/entries/create", sharedDinner());

  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.equal(saved.payload.created, true);
  const [split] = await rows(db, "SELECT id, split_group_id, payer_person_id, total_amount_minor, currency, linked_transaction_id, deleted_at FROM split_expenses WHERE linked_transaction_id = ?", saved.payload.entryId);
  assert.deepEqual(split, {
    id: saved.payload.linkedSplitExpenseId,
    split_group_id: "split-group-okaeri",
    payer_person_id: tim.id,
    total_amount_minor: 8_000,
    currency: "SGD",
    linked_transaction_id: saved.payload.entryId,
    deleted_at: null
  });
  assert.equal(saved.payload.linkedSplitExpenseMonth, MONTH);
  assert.deepEqual(await rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY amount_minor DESC", split.id), [
    { person_id: tim.id, ratio_basis_points: 6250, amount_minor: 5_000 },
    { person_id: joyce.id, ratio_basis_points: 3750, amount_minor: 3_000 }
  ]);
  // Joyce owes $30 more in Okaeri, and nothing changed without a group.
  const owedAfter = await owedByGroup(db, joyce.id, tim.id);
  assert.equal(owedAfter["split-group-okaeri"] - (owedBefore["split-group-okaeri"] ?? 0), 3_000);
  assert.equal(owedAfter.none ?? 0, owedBefore.none ?? 0);
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM audit_events WHERE entity_id = ? AND action = 'entry_created'", saved.payload.entryId))[0].count, 1);

  // A second Save (a retry after a lost answer) makes nothing new and
  // answers with the same split.
  const again = await api("/api/entries/create", sharedDinner());
  assert.equal(again.status, 200, JSON.stringify(again.payload));
  assert.deepEqual([again.payload.created, again.payload.entryId, again.payload.linkedSplitExpenseId], [false, saved.payload.entryId, split.id]);
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM split_expenses WHERE linked_transaction_id = ?", saved.payload.entryId))[0].count, 1);
  // Adding it to Splits again is refused, so a page that did would be wrong.
  const twice = await api("/api/splits/expenses/from-entry", { entryId: saved.payload.entryId, splitGroupId: "split-group-okaeri" });
  assert.equal(twice.status, 400);
});

test("B1: an exact share stays exact on a large amount that basis points alone would round", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  // 1,234.56 with Tim's share 1,000.00: 8100 basis points alone floor to 999.99.
  const saved = await api("/api/entries/create", sharedDinner({ amountMinor: 123_456, splitBasisPoints: 8100, splitAmountMinor: 100_000, externalReference: "ask:audit2-big-0001" }));
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.deepEqual((await rows(db, "SELECT amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY amount_minor DESC", saved.payload.linkedSplitExpenseId)).map((row) => row.amount_minor), [100_000, 23_456]);
});

test("B1: a group in another currency or a share above the amount writes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await db.prepare("INSERT INTO split_groups (id, household_id, group_name, icon_key, sort_order, currency) VALUES ('split-group-tokyo', ?, 'Tokyo', 'plane', 9, 'JPY')").bind(DEFAULT_HOUSEHOLD_ID).run();
  const before = await dumpDatabase(db);
  const yen = await api("/api/entries/create", sharedDinner({ splitGroupId: "split-group-tokyo", externalReference: "ask:audit2-yen-0001" }));
  assert.equal(yen.status, 400);
  const over = await api("/api/entries/create", sharedDinner({ splitAmountMinor: 9_000, externalReference: "ask:audit2-over-001" }));
  assert.equal(over.status, 400);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("B1: a shared save that fails on its split shares writes neither the entry nor the split", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO split_expense_shares/);
  const saved = await api("/api/entries/create", sharedDinner(), { database: faulty.db });
  assert.equal(faulty.state.fired, true);
  assert.notEqual(saved.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

// ---------------------------------------------------------------- B2

test("B2: Ask's Undo removes the entry and its split in one batch; balances and month totals go back exactly", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { tim, joyce } = await people(db);
  const owedBefore = await owedByGroup(db, joyce.id, tim.id);
  await recalculateMonthlySnapshots(db, MONTH);
  const totalsBefore = await snapshotTotals(db, MONTH);
  assert.ok(totalsBefore.length > 0);

  const saved = await api("/api/entries/create", sharedDinner({ splitGroupId: null, externalReference: "ask:audit2-undo-001" }));
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.equal((await owedByGroup(db, joyce.id, tim.id)).none - (owedBefore.none ?? 0), 3_000);

  const undone = await api("/api/entries/delete", { entryId: saved.payload.entryId, withLinkedSplit: true });
  assert.equal(undone.status, 200, JSON.stringify(undone.payload));
  assert.equal(undone.payload.splitRemoved, true);
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE id = ?", saved.payload.entryId), []);
  const [split] = await rows(db, "SELECT deleted_at IS NOT NULL AS archived FROM split_expenses WHERE id = ?", saved.payload.linkedSplitExpenseId);
  assert.equal(split.archived, 1);
  assert.deepEqual(await rows(db, "SELECT record_kind, action, amount_minor FROM split_activity_history WHERE record_id = ?", saved.payload.linkedSplitExpenseId), [
    { record_kind: "expense", action: "deleted", amount_minor: 8_000 }
  ]);
  assert.deepEqual(await owedByGroup(db, joyce.id, tim.id), owedBefore);
  assert.deepEqual(await snapshotTotals(db, MONTH), totalsBefore);
  // The Splits page lists it only as removed, never in an open balance.
  const page = await api(`/api/splits-page?view=${tim.id}&month=${MONTH}`);
  assert.equal(page.status, 200);
  assert.ok(!(page.payload.splitsPage.expenses ?? []).some((expense) => expense.id === saved.payload.linkedSplitExpenseId));
});

test("B2: an Undo that fails on the entry row keeps the entry and its split", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const saved = await api("/api/entries/create", sharedDinner({ externalReference: "ask:audit2-undo-002" }));
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /DELETE FROM transactions/);
  const undone = await api("/api/entries/delete", { entryId: saved.payload.entryId, withLinkedSplit: true }, { database: faulty.db });
  assert.equal(faulty.state.fired, true);
  assert.notEqual(undone.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("B2: deleting from Entries (no Undo) still keeps a split recorded on Splits, only unlinked", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const saved = await api("/api/entries/create", sharedDinner({ externalReference: "ask:audit2-entries-1" }));
  const removed = await api("/api/entries/delete", { entryId: saved.payload.entryId });
  assert.equal(removed.status, 200);
  assert.deepEqual(await rows(db, "SELECT deleted_at, linked_transaction_id FROM split_expenses WHERE id = ?", saved.payload.linkedSplitExpenseId), [{ deleted_at: null, linked_transaction_id: null }]);
});

// ---------------------------------------------------------------- B9

async function nonGroupDinner(api, db, amountMinor) {
  const { tim } = await people(db);
  const created = await api("/api/splits/expenses/create", { groupId: null, date: DATE, description: "Hawker dinner", categoryName: "Food & Drinks", payerPersonName: tim.display_name, amountMinor, splitBasisPoints: 5000, currency: "SGD" });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
}

test("B9: paying back more than is owed leaves the rest owed the other way, and the group stays open", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { tim, joyce } = await people(db);
  const start = (await owedByGroup(db, joyce.id, tim.id)).none ?? 0;
  await nonGroupDinner(api, db, 9_600 - 2 * start);
  assert.equal((await owedByGroup(db, joyce.id, tim.id)).none, 4_800);

  const paid = await api("/api/splits/settlements/create", { groupId: null, date: DATE, fromPersonName: joyce.display_name, toPersonName: tim.display_name, amountMinor: 5_000, currency: "SGD" });

  assert.equal(paid.status, 200, JSON.stringify(paid.payload));
  assert.deepEqual([paid.payload.owedBeforeMinor, paid.payload.owedAfterMinor, paid.payload.settled], [4_800, -200, false]);
  // Tim now owes Joyce $2; nothing disappeared.
  assert.equal((await owedByGroup(db, joyce.id, tim.id)).none, -200);
  const [settlement] = await rows(db, "SELECT amount_minor, split_batch_id FROM split_settlements WHERE id = ?", paid.payload.settlementId);
  assert.equal(settlement.amount_minor, 5_000);
  assert.deepEqual(await rows(db, "SELECT closed_on FROM split_batches WHERE id = ?", settlement.split_batch_id), [{ closed_on: null }]);

  // The $2 back settles it exactly, and only then is the group closed.
  const back = await api("/api/splits/settlements/create", { groupId: null, date: DATE, fromPersonName: tim.display_name, toPersonName: joyce.display_name, amountMinor: 200, currency: "SGD" });
  assert.deepEqual([back.payload.owedAfterMinor, back.payload.settled], [0, true]);
  assert.deepEqual(await rows(db, "SELECT closed_on FROM split_batches WHERE id = ?", settlement.split_batch_id), [{ closed_on: DATE }]);
  assert.equal((await owedByGroup(db, joyce.id, tim.id)).none ?? 0, 0);
});

test("B9: paying less than is owed leaves the rest owed; an exact payment closes the group", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { tim, joyce } = await people(db);
  const start = (await owedByGroup(db, joyce.id, tim.id)).none ?? 0;
  await nonGroupDinner(api, db, 9_600 - 2 * start);
  const part = await api("/api/splits/settlements/create", { groupId: null, date: DATE, fromPersonName: joyce.display_name, toPersonName: tim.display_name, amountMinor: 4_000, currency: "SGD" });
  assert.deepEqual([part.payload.owedAfterMinor, part.payload.settled], [800, false]);
  assert.equal((await owedByGroup(db, joyce.id, tim.id)).none, 800);
  const rest = await api("/api/splits/settlements/create", { groupId: null, date: DATE, fromPersonName: joyce.display_name, toPersonName: tim.display_name, amountMinor: 800, currency: "SGD" });
  assert.equal(rest.payload.settled, true);
});

test("B9: a payment that fails on its row writes no batch, no settlement and closes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { tim, joyce } = await people(db);
  await nonGroupDinner(api, db, 9_600);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO split_settlements/);
  const paid = await api("/api/splits/settlements/create", { groupId: null, date: DATE, fromPersonName: joyce.display_name, toPersonName: tim.display_name, amountMinor: 5_000, currency: "SGD" }, { database: faulty.db });
  assert.equal(faulty.state.fired, true);
  assert.notEqual(paid.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});
