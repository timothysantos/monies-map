// Entries and transfers: persistence commands are all-or-nothing. Each scenario runs against a real
// local D1 (Miniflare) seeded with the demo household. A success case pins
// the concrete rows a command writes; a failure case makes one statement
// fail partway through the command and proves the database is byte-for-byte
// what it was before (no partial rows).
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
import { saveMonthPlanEntryLinks, saveMonthPlanRow } from "../src/domain/app-repository-month-commands.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

// ---------------------------------------------------------------- entries

async function createTransferPair(api) {
  const outId = await createEntry(api, { date: "2026-05-14", description: "Atomic transfer out", accountName: "UOB Savings", categoryName: "Transfer", amountMinor: 20_000, entryType: "transfer", transferDirection: "out" });
  const inId = await createEntry(api, { date: "2026-05-14", description: "Atomic transfer in", accountName: "UOB One", categoryName: "Transfer", amountMinor: 20_000, entryType: "transfer", transferDirection: "in" });
  return { outId, inId };
}

test("updating a linked transfer into an expense dissolves the pair and updates month totals", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId, inId } = await createTransferPair(api);
  const link = await api("/api/transfers/link", { fromEntryId: outId, toEntryId: inId });
  assert.equal(link.status, 200, JSON.stringify(link.payload));
  await recalculateMonthlySnapshots(db, "2026-05");
  const [householdBefore] = (await snapshotTotals(db, "2026-05")).filter((row) => row.person_scope === "household");

  const update = await api("/api/entries/update", { entryId: outId, date: "2026-05-14", description: "Atomic now expense", accountName: "UOB Savings", categoryName: "Shopping", amountMinor: 20_000, entryType: "expense", ownershipType: "direct", ownerName: "Tim" });

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual(await rows(db, "SELECT id, entry_type, transfer_group_id FROM transactions WHERE id IN (?, ?) ORDER BY description", outId, inId), [
    { id: outId, entry_type: "expense", transfer_group_id: null },
    { id: inId, entry_type: "transfer", transfer_group_id: null }
  ]);
  assert.deepEqual(await rows(db, "SELECT id FROM transfer_groups WHERE id = ?", link.payload.groupId), []);
  const [householdAfter] = (await snapshotTotals(db, "2026-05")).filter((row) => row.person_scope === "household");
  assert.equal(householdAfter.total_expense_minor, householdBefore.total_expense_minor + 20_000);
});

test("an entry update that fails while dissolving its transfer pair changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId, inId } = await createTransferPair(api);
  await api("/api/transfers/link", { fromEntryId: outId, toEntryId: inId });
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /DELETE FROM transfer_groups/);

  const update = await api("/api/entries/update", { entryId: outId, date: "2026-05-14", description: "Atomic now expense", accountName: "UOB Savings", categoryName: "Shopping", amountMinor: 20_000, entryType: "expense", ownershipType: "direct", ownerName: "Tim" }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(update.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("deleting an entry removes it with its plan links and updates month totals", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: "2026-05-12", description: "Atomic doomed", amountMinor: 1_500 });
  await saveMonthPlanRow(db, { rowId: "atomic-row", month: "2026-05", sectionKey: "planned_items", categoryName: "Groceries", label: "Atomic item", planDate: "2026-05-12", accountName: "UOB One", plannedMinor: 2_000, ownershipType: "direct", ownerName: "Tim" });
  await saveMonthPlanEntryLinks(db, { rowId: "atomic-row", month: "2026-05", transactionIds: [entryId] });
  const [householdBefore] = (await snapshotTotals(db, "2026-05")).filter((row) => row.person_scope === "household");

  const removed = await api("/api/entries/delete", { entryId });

  assert.equal(removed.status, 200, JSON.stringify(removed.payload));
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE id = ?", entryId), []);
  assert.deepEqual(await rows(db, "SELECT id FROM monthly_plan_entry_links WHERE transaction_id = ?", entryId), []);
  const [householdAfter] = (await snapshotTotals(db, "2026-05")).filter((row) => row.person_scope === "household");
  assert.equal(householdAfter.total_expense_minor, householdBefore.total_expense_minor - 1_500);
  assert.deepEqual(await rows(db, "SELECT action FROM audit_events WHERE entity_id = ? ORDER BY rowid", entryId), [
    { action: "entry_created" },
    { action: "entry_deleted" }
  ]);
});

test("an entry delete that fails on the ledger row keeps its plan links and the row", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: "2026-05-12", description: "Atomic doomed", amountMinor: 1_500 });
  await saveMonthPlanRow(db, { rowId: "atomic-row", month: "2026-05", sectionKey: "planned_items", categoryName: "Groceries", label: "Atomic item", planDate: "2026-05-12", accountName: "UOB One", plannedMinor: 2_000, ownershipType: "direct", ownerName: "Tim" });
  await saveMonthPlanEntryLinks(db, { rowId: "atomic-row", month: "2026-05", transactionIds: [entryId] });
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /DELETE FROM transactions/);

  const removed = await api("/api/entries/delete", { entryId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(removed.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("linking a transfer pair marks both halves and records the group", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId, inId } = await createTransferPair(api);

  const link = await api("/api/transfers/link", { fromEntryId: outId, toEntryId: inId });

  assert.equal(link.status, 200, JSON.stringify(link.payload));
  assert.equal(link.payload.linked, true);
  assert.deepEqual(await rows(db, "SELECT id, entry_type, transfer_direction, transfer_group_id FROM transactions WHERE id IN (?, ?) ORDER BY transfer_direction DESC", outId, inId), [
    { id: outId, entry_type: "transfer", transfer_direction: "out", transfer_group_id: link.payload.groupId },
    { id: inId, entry_type: "transfer", transfer_direction: "in", transfer_group_id: link.payload.groupId }
  ]);
  assert.deepEqual(await rows(db, "SELECT note, matched_confidence FROM transfer_groups WHERE id = ?", link.payload.groupId), [
    { note: "Linked from entries editor", matched_confidence: 1 }
  ]);
});

test("a transfer link that fails on the second half links neither", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId, inId } = await createTransferPair(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /transfer_direction = 'in'/);

  const link = await api("/api/transfers/link", { fromEntryId: outId, toEntryId: inId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(link.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("settling a transfer pair turns both halves into categorised entries", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId, inId } = await createTransferPair(api);
  const link = await api("/api/transfers/link", { fromEntryId: outId, toEntryId: inId });

  const settle = await api("/api/transfers/settle", { entryId: outId, currentCategoryName: "Shopping", counterpartCategoryName: "Other" });

  assert.equal(settle.status, 200, JSON.stringify(settle.payload));
  assert.deepEqual(await rows(db, `
    SELECT transactions.id, entry_type, transfer_direction, transfer_group_id, categories.name AS category
    FROM transactions JOIN categories ON categories.id = transactions.category_id
    WHERE transactions.id IN (?, ?) ORDER BY transactions.description DESC
  `, outId, inId), [
    { id: outId, entry_type: "expense", transfer_direction: null, transfer_group_id: null, category: "Shopping" },
    { id: inId, entry_type: "income", transfer_direction: null, transfer_group_id: null, category: "Other" }
  ]);
  assert.deepEqual(await rows(db, "SELECT id FROM transfer_groups WHERE id = ?", link.payload.groupId), []);
});

test("a transfer settle that fails on the group delete leaves the pair linked", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId, inId } = await createTransferPair(api);
  await api("/api/transfers/link", { fromEntryId: outId, toEntryId: inId });
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /DELETE FROM transfer_groups/);

  const settle = await api("/api/transfers/settle", { entryId: outId, currentCategoryName: "Shopping", counterpartCategoryName: "Other" }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(settle.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});
