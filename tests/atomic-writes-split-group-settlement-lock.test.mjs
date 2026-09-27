// Group settle-up lock: a settle-up closes its group's current batch, and the
// records in that closed batch (its expenses and the settle-up itself) keep
// the facts the settle-up amount was computed from, the same way records in an
// active simplified settlement do. A command that would change them (Splits
// edit or delete, or a ledger entry edit whose linked split would follow) is
// refused as a whole with `split_settlement_locked` naming the batch, and
// writes nothing. "Undo settle-up" reopens the batch; the same change then
// saves. Runs against a real local D1 (Miniflare) seeded with the demo
// household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const MONTH = "2026-05";
const DATE = "2026-05-16";
const SETTLED_ON = "2026-05-17";
const LOCKED = "split_settlement_locked";

async function createGroup(api, name = "Lock trip") {
  const group = await api("/api/splits/groups/create", { name, currency: "SGD", expenseSource: "mixed" });
  assert.equal(group.status, 200, JSON.stringify(group.payload));
  return group.payload.groupId;
}

// A cash expense Tim paid in the group, split 50/50 (Tim is the first share
// person, so splitAmountMinor is Tim's share).
async function createGroupExpense(api, groupId, { description, amountMinor, date = DATE }) {
  const created = await api("/api/splits/expenses/create", {
    groupId,
    date,
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor,
    splitAmountMinor: amountMinor / 2,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    note: "trip shop"
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.splitExpenseId;
}

function expenseEdit(splitExpenseId, groupId, { description, amountMinor }, overrides = {}) {
  return {
    splitExpenseId,
    groupId,
    date: DATE,
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor,
    splitAmountMinor: amountMinor / 2,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    note: "trip shop",
    ...overrides
  };
}

function settleUpPayload(groupId, overrides = {}) {
  return {
    groupId,
    date: SETTLED_ON,
    fromPersonName: "Joyce",
    toPersonName: "Tim",
    amountMinor: 3_000,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    note: "trip settled",
    ...overrides
  };
}

// Records a group settle-up, which closes the group's current batch.
async function settleUp(api, groupId, overrides = {}) {
  const created = await api("/api/splits/settlements/create", settleUpPayload(groupId, overrides));
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.settlementId;
}

async function batchOf(db, table, id) {
  const [row] = await rows(db, `SELECT split_batch_id FROM ${table} WHERE id = ?`, id);
  const [batch] = await rows(db, "SELECT id, closed_on FROM split_batches WHERE id = ?", row.split_batch_id);
  return batch;
}

async function splitState(db, splitExpenseId) {
  const [expense] = await rows(db, "SELECT total_amount_minor, payer_person_id, expense_date, split_group_id, split_batch_id, deleted_at FROM split_expenses WHERE id = ?", splitExpenseId);
  const shares = await rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", splitExpenseId);
  return { expense, shares };
}

function assertGroupLocked(response, batchId, messagePattern) {
  assert.equal(response.status, 409, JSON.stringify(response.payload));
  assert.equal(response.payload.ok, false);
  assert.equal(response.payload.code, LOCKED);
  assert.equal(response.payload.batchId, batchId);
  assert.equal(response.payload.checkpointId, undefined);
  assert.match(response.payload.error, /Lock trip settle-up of 2026-05-17/);
  assert.match(response.payload.error, /Undo the settle-up/);
  if (messagePattern) assert.match(response.payload.error, messagePattern);
}

// A group with one settled expense and the settle-up that closed its batch.
async function settledGroup(api, db, { description = "Settled trip shop", amountMinor = 6_000 } = {}) {
  const groupId = await createGroup(api);
  const splitExpenseId = await createGroupExpense(api, groupId, { description, amountMinor });
  const settlementId = await settleUp(api, groupId);
  const batch = await batchOf(db, "split_expenses", splitExpenseId);
  assert.equal(batch.closed_on, SETTLED_ON);
  assert.equal((await batchOf(db, "split_settlements", settlementId)).id, batch.id);
  return { groupId, splitExpenseId, settlementId, batchId: batch.id, description, amountMinor };
}

test("a Splits edit that changes a settled group expense's amount, shares, payer, date or group is refused and writes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await settledGroup(api, db);
  const otherGroupId = await createGroup(api, "Other trip");
  const before = await dumpDatabase(db);

  const variants = [
    [{ amountMinor: 8_000, splitAmountMinor: 4_000 }, /amount/],
    [{ splitAmountMinor: 2_000 }, /shares/],
    [{ payerPersonName: "Joyce" }, /payer/],
    [{ date: "2026-05-15" }, /date/],
    [{ groupId: otherGroupId }, /group/]
  ];
  for (const [overrides, changed] of variants) {
    const update = await api("/api/splits/expenses/update", expenseEdit(settled.splitExpenseId, settled.groupId, settled, overrides));
    assertGroupLocked(update, settled.batchId, changed);
  }

  assertSameDatabase(await dumpDatabase(db), before);
});

test("deleting a settled group expense or its settle-up, or changing the settle-up's facts, is refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await settledGroup(api, db);
  const before = await dumpDatabase(db);

  assertGroupLocked(await api("/api/splits/expenses/delete", { splitExpenseId: settled.splitExpenseId }), settled.batchId, /split expense.*deleting it/);
  assertGroupLocked(await api("/api/splits/settlements/delete", { settlementId: settled.settlementId }), settled.batchId, /split settle-up.*deleting it/);
  const settlementEdit = { settlementId: settled.settlementId, ...settleUpPayload(settled.groupId) };
  assertGroupLocked(await api("/api/splits/settlements/update", { ...settlementEdit, amountMinor: 2_500 }), settled.batchId, /amount/);
  assertGroupLocked(await api("/api/splits/settlements/update", { ...settlementEdit, fromPersonName: "Tim", toPersonName: "Joyce" }), settled.batchId, /payer/);
  assertGroupLocked(await api("/api/splits/settlements/update", { ...settlementEdit, date: "2026-05-18" }), settled.batchId, /date/);

  assertSameDatabase(await dumpDatabase(db), before);
});

test("wording, category, note and payment method stay editable in a settled group batch", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await settledGroup(api, db);
  const splitBefore = await splitState(db, settled.splitExpenseId);

  const expenseUpdate = await api("/api/splits/expenses/update", expenseEdit(settled.splitExpenseId, settled.groupId, { description: "Settled trip shop (renamed)", amountMinor: settled.amountMinor }, {
    categoryName: "Food & Drinks",
    note: "renamed after settling"
  }));
  assert.equal(expenseUpdate.status, 200, JSON.stringify(expenseUpdate.payload));
  const settlementUpdate = await api("/api/splits/settlements/update", {
    settlementId: settled.settlementId,
    ...settleUpPayload(settled.groupId, { paymentMethod: "bank", note: "paid by transfer" })
  });
  assert.equal(settlementUpdate.status, 200, JSON.stringify(settlementUpdate.payload));

  assert.deepEqual(await rows(db, "SELECT description, note FROM split_expenses WHERE id = ?", settled.splitExpenseId), [
    { description: "Settled trip shop (renamed)", note: "renamed after settling" }
  ]);
  assert.deepEqual(await rows(db, "SELECT amount_minor, payment_method, note, split_batch_id FROM split_settlements WHERE id = ?", settled.settlementId), [
    { amount_minor: 3_000, payment_method: "bank", note: "paid by transfer", split_batch_id: settled.batchId }
  ]);
  assert.deepEqual(await splitState(db, settled.splitExpenseId), splitBefore);
  assert.equal((await batchOf(db, "split_expenses", settled.splitExpenseId)).closed_on, SETTLED_ON);
});

// A Tim expense on UOB One added to the group's splits (50/50).
async function settledLinkedEntry(api, db, { description, amountMinor }) {
  const groupId = await createGroup(api);
  const entryId = await createEntry(api, { date: DATE, description, amountMinor });
  const split = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: groupId });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  const splitExpenseId = split.payload.splitExpenseId;
  await settleUp(api, groupId);
  const batch = await batchOf(db, "split_expenses", splitExpenseId);
  assert.equal(batch.closed_on, SETTLED_ON);
  return { groupId, entryId, splitExpenseId, batchId: batch.id };
}

function entryEdit(entryId, { description, amountMinor }, overrides = {}) {
  return {
    entryId,
    date: DATE,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note: "",
    ...overrides
  };
}

test("an entry edit that would move its split in a settled group batch is refused as a whole", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Settled trip dinner";
  const linked = await settledLinkedEntry(api, db, { description, amountMinor: 6_000 });
  const before = await dumpDatabase(db);

  const amountEdit = await api("/api/entries/update", entryEdit(linked.entryId, { description, amountMinor: 8_050 }));
  assertGroupLocked(amountEdit, linked.batchId, /This entry's split expense.*amount/);
  const shareEdit = await api("/api/entries/update", entryEdit(linked.entryId, { description, amountMinor: 6_000 }, { ownershipType: "shared", ownerName: undefined, splitBasisPoints: 2_500 }));
  assertGroupLocked(shareEdit, linked.batchId, /shares/);
  const dateEdit = await api("/api/entries/update", entryEdit(linked.entryId, { description, amountMinor: 6_000 }, { date: "2026-05-18" }));
  assertGroupLocked(dateEdit, linked.batchId, /date/);

  assertSameDatabase(await dumpDatabase(db), before);
});

test("an unchanged shared entry save keeps its split in the settled group batch", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Settled trip groceries";
  const linked = await settledLinkedEntry(api, db, { description, amountMinor: 6_000 });
  const splitBefore = await splitState(db, linked.splitExpenseId);

  // The household editor saves a linked entry as shared with its 50/50 basis;
  // nothing the settle-up used changes, so it saves, and the split stays in
  // the closed batch instead of moving into the group's open balance.
  const sharedEdit = await api("/api/entries/update", entryEdit(linked.entryId, { description: "Settled trip groceries (renamed)", amountMinor: 6_000 }, { ownershipType: "shared", ownerName: undefined, splitBasisPoints: 5_000, note: "renamed" }));

  assert.equal(sharedEdit.status, 200, JSON.stringify(sharedEdit.payload));
  assert.deepEqual(await splitState(db, linked.splitExpenseId), splitBefore);
  assert.deepEqual(await batchOf(db, "split_expenses", linked.splitExpenseId), { id: linked.batchId, closed_on: SETTLED_ON });
  const splitsPage = await api(`/api/splits-page?view=household&month=${MONTH}`);
  assert.equal(splitsPage.payload.splitsPage.groups.find((group) => group.id === linked.groupId).balanceMinor, 0);
});

test("Undo settle-up reopens the batch, keeps the settle-up, and the refused change then saves", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await settledGroup(api, db);
  const edit = expenseEdit(settled.splitExpenseId, settled.groupId, settled, { amountMinor: 9_000, splitAmountMinor: 4_500 });
  assertGroupLocked(await api("/api/splits/expenses/update", edit), settled.batchId);

  const undo = await api("/api/splits/batches/reopen", { batchId: settled.batchId });

  assert.equal(undo.status, 200, JSON.stringify(undo.payload));
  assert.deepEqual(undo.payload, { ok: true, batchId: settled.batchId, reopened: true });
  assert.deepEqual(await rows(db, "SELECT closed_on, batch_name FROM split_batches WHERE id = ?", settled.batchId), [{ closed_on: null, batch_name: "Lock trip current batch" }]);
  // The settle-up is a real payment: it stays, now as open activity.
  assert.deepEqual(await rows(db, "SELECT amount_minor, deleted_at, split_batch_id FROM split_settlements WHERE id = ?", settled.settlementId), [
    { amount_minor: 3_000, deleted_at: null, split_batch_id: settled.batchId }
  ]);
  assert.deepEqual(await rows(db, "SELECT record_kind, record_id, action, detail FROM split_activity_history WHERE record_id = ? AND action = 'updated'", settled.settlementId), [
    { record_kind: "settlement", record_id: settled.settlementId, action: "updated", detail: "Settle-up undone; its activity is open again." }
  ]);

  const update = await api("/api/splits/expenses/update", edit);
  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual((await splitState(db, settled.splitExpenseId)).shares.map((share) => share.amount_minor), [4_500, 4_500]);

  // Joyce owed 30.00, paid 30.00, and now owes the 15.00 the correction added.
  const splitsPage = await api(`/api/splits-page?view=person-tim&month=${MONTH}`);
  assert.equal(splitsPage.payload.splitsPage.groups.find((group) => group.id === settled.groupId).balanceMinor, 1_500);
  const second = await settleUp(api, settled.groupId, { amountMinor: 1_500, date: "2026-05-19" });
  assert.equal((await batchOf(db, "split_settlements", second)).id, settled.batchId);
  assert.equal((await batchOf(db, "split_expenses", settled.splitExpenseId)).closed_on, "2026-05-19");
});

test("undoing an older settle-up joins its activity to the group's open batch", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await settledGroup(api, db);
  const laterExpenseId = await createGroupExpense(api, settled.groupId, { description: "After the settle-up", amountMinor: 2_000, date: "2026-05-18" });
  const openBatch = await batchOf(db, "split_expenses", laterExpenseId);
  assert.notEqual(openBatch.id, settled.batchId);
  assert.equal(openBatch.closed_on, null);

  const undo = await api("/api/splits/batches/reopen", { batchId: settled.batchId });
  assert.equal(undo.status, 200, JSON.stringify(undo.payload));

  // One open batch per group: the reopened activity moves into it, so the
  // next settle-up closes all of it together.
  for (const [table, id] of [["split_expenses", settled.splitExpenseId], ["split_settlements", settled.settlementId], ["split_expenses", laterExpenseId]]) {
    assert.deepEqual(await batchOf(db, table, id), { id: openBatch.id, closed_on: null });
  }
  assert.deepEqual(await rows(db, "SELECT id FROM split_batches WHERE split_group_id = ? AND closed_on IS NULL", settled.groupId), [{ id: openBatch.id }]);
  const splitsPage = await api(`/api/splits-page?view=person-tim&month=${MONTH}`);
  assert.equal(splitsPage.payload.splitsPage.groups.find((group) => group.id === settled.groupId).balanceMinor, 1_000);
  await settleUp(api, settled.groupId, { amountMinor: 1_000, date: "2026-05-19" });
  const after = await api(`/api/splits-page?view=person-tim&month=${MONTH}`);
  const groupActivity = after.payload.splitsPage.activity.filter((item) => item.groupId === settled.groupId);
  assert.equal(groupActivity.length, 4);
  assert.ok(groupActivity.every((item) => item.batchClosedAt === "2026-05-19"), JSON.stringify(groupActivity.map((item) => item.batchClosedAt)));
});

test("Undo settle-up refuses a batch that is not settled", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const groupId = await createGroup(api);
  const splitExpenseId = await createGroupExpense(api, groupId, { description: "Still open", amountMinor: 2_000 });
  const openBatch = await batchOf(db, "split_expenses", splitExpenseId);
  const before = await dumpDatabase(db);

  const openUndo = await api("/api/splits/batches/reopen", { batchId: openBatch.id });
  assert.equal(openUndo.status, 400, JSON.stringify(openUndo.payload));
  assert.match(openUndo.payload.error, /not settled/);
  const unknownUndo = await api("/api/splits/batches/reopen", { batchId: "split-batch-missing" });
  assert.equal(unknownUndo.status, 400, JSON.stringify(unknownUndo.payload));
  const missingId = await api("/api/splits/batches/reopen", {});
  assert.equal(missingId.status, 400, JSON.stringify(missingId.payload));

  assertSameDatabase(await dumpDatabase(db), before);
});

test("an Undo settle-up that fails part way changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await settledGroup(api, db);
  await createGroupExpense(api, settled.groupId, { description: "After the settle-up", amountMinor: 2_000, date: "2026-05-18" });
  const before = await dumpDatabase(db);

  for (const pattern of [/INSERT INTO split_activity_history/, /UPDATE split_settlements SET split_batch_id/]) {
    const faulty = failingStatement(db, pattern);
    const undo = await api("/api/splits/batches/reopen", { batchId: settled.batchId }, { database: faulty.db });
    assert.equal(faulty.state.fired, true, String(pattern));
    assert.notEqual(undo.status, 200);
    assertSameDatabase(await dumpDatabase(db), before);
  }
});

test("after Undo settle-up, editing the kept settle-up does not settle the group again", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await settledGroup(api, db);
  assert.equal((await api("/api/splits/batches/reopen", { batchId: settled.batchId })).status, 200);
  const correction = await api("/api/splits/expenses/update", expenseEdit(settled.splitExpenseId, settled.groupId, settled, { amountMinor: 9_000, splitAmountMinor: 4_500 }));
  assert.equal(correction.status, 200, JSON.stringify(correction.payload));

  // A note and payment method change is an ordinary edit of open activity.
  const noteEdit = await api("/api/splits/settlements/update", {
    settlementId: settled.settlementId,
    ...settleUpPayload(settled.groupId, { paymentMethod: "bank", note: "paid by transfer" })
  });

  assert.equal(noteEdit.status, 200, JSON.stringify(noteEdit.payload));
  assert.deepEqual(await batchOf(db, "split_settlements", settled.settlementId), { id: settled.batchId, closed_on: null });
  const splitsPage = await api(`/api/splits-page?view=person-tim&month=${MONTH}`);
  assert.equal(splitsPage.payload.splitsPage.groups.find((group) => group.id === settled.groupId).balanceMinor, 1_500);
});

test("a shared save is checked against the live linked split, not an archived one", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const groupId = await createGroup(api);
  const description = "Re-added trip dinner";
  const entryId = await createEntry(api, { date: DATE, description, amountMinor: 6_000 });
  const first = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: groupId });
  assert.equal(first.status, 200, JSON.stringify(first.payload));
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId: first.payload.splitExpenseId })).status, 200);
  // The archived split no longer holds the entry, so it can be added again.
  const second = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: groupId });
  assert.equal(second.status, 200, JSON.stringify(second.payload));
  await settleUp(api, groupId);
  const batch = await batchOf(db, "split_expenses", second.payload.splitExpenseId);
  assert.equal(batch.closed_on, SETTLED_ON);
  const before = await dumpDatabase(db);

  const shareEdit = await api("/api/entries/update", entryEdit(entryId, { description, amountMinor: 6_000 }, { ownershipType: "shared", ownerName: undefined, splitBasisPoints: 2_500 }));

  assertGroupLocked(shareEdit, batch.id, /shares/);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("restoring a record whose batch was settled since brings it back as open activity", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const groupId = await createGroup(api);
  const keptId = await createGroupExpense(api, groupId, { description: "Kept trip shop", amountMinor: 6_000 });
  const deletedId = await createGroupExpense(api, groupId, { description: "Deleted trip taxi", amountMinor: 2_000 });
  assert.equal((await api("/api/splits/expenses/delete", { splitExpenseId: deletedId })).status, 200);
  await settleUp(api, groupId);
  const settledBatch = await batchOf(db, "split_expenses", keptId);
  assert.equal(settledBatch.closed_on, SETTLED_ON);

  const restore = await api("/api/splits/activity-history/restore", { recordKind: "expense", recordId: deletedId });

  assert.equal(restore.status, 200, JSON.stringify(restore.payload));
  // The settle-up did not pay for it, so it counts in the open balance
  // instead of hiding in the settled batch.
  const restoredBatch = await batchOf(db, "split_expenses", deletedId);
  assert.notEqual(restoredBatch.id, settledBatch.id);
  assert.equal(restoredBatch.closed_on, null);
  assert.deepEqual(await batchOf(db, "split_expenses", keptId), settledBatch);
  const splitsPage = await api(`/api/splits-page?view=person-tim&month=${MONTH}`);
  assert.equal(splitsPage.payload.splitsPage.groups.find((group) => group.id === groupId).balanceMinor, 1_000);
});

// A settled group whose settle-up was undone and then deleted, so it sits in
// activity history with Restore offered.
async function deletedSettleUp(api, db) {
  const settled = await settledGroup(api, db);
  assert.equal((await api("/api/splits/batches/reopen", { batchId: settled.batchId })).status, 200);
  const removal = await api("/api/splits/settlements/delete", { settlementId: settled.settlementId });
  assert.equal(removal.status, 200, JSON.stringify(removal.payload));
  return settled;
}

async function settlementHistory(api, settlementId) {
  const history = await api("/api/splits/activity-history");
  assert.equal(history.status, 200, JSON.stringify(history.payload));
  return history.payload.activityHistory
    .filter((row) => row.recordId === settlementId)
    .map(({ action, recordKind, description, amountMinor, groupName, canRestore }) => ({ action, recordKind, description, amountMinor, groupName, canRestore }));
}

test("restoring a deleted settle-up brings it back into its open batch with a restored history event", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await deletedSettleUp(api, db);
  const deletedHistory = await settlementHistory(api, settled.settlementId);
  assert.deepEqual(deletedHistory[0], { action: "deleted", recordKind: "settlement", description: "Settlement", amountMinor: 3_000, groupName: "Lock trip", canRestore: true });

  const restore = await api("/api/splits/activity-history/restore", { recordKind: "settlement", recordId: settled.settlementId });

  assert.equal(restore.status, 200, JSON.stringify(restore.payload));
  assert.deepEqual(restore.payload, { ok: true, recordId: settled.settlementId, restored: true });
  assert.deepEqual(await rows(db, "SELECT deleted_at, amount_minor, split_batch_id FROM split_settlements WHERE id = ?", settled.settlementId), [
    { deleted_at: null, amount_minor: 3_000, split_batch_id: settled.batchId }
  ]);
  // Its batch was reopened by the undo, so it stays there as open activity.
  assert.deepEqual(await batchOf(db, "split_settlements", settled.settlementId), { id: settled.batchId, closed_on: null });
  const history = await settlementHistory(api, settled.settlementId);
  assert.deepEqual(history[0], { action: "restored", recordKind: "settlement", description: "Settlement", amountMinor: 3_000, groupName: "Lock trip", canRestore: false });
  assert.equal(history.find((row) => row.action === "deleted").canRestore, false);
  // The payment counts again: Joyce's 3,000 share is paid.
  const splitsPage = await api(`/api/splits-page?view=person-tim&month=${MONTH}`);
  assert.equal(splitsPage.payload.splitsPage.groups.find((group) => group.id === settled.groupId).balanceMinor, 0);
});

test("restoring a deleted settle-up whose batch was settled since brings it back as open activity", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await deletedSettleUp(api, db);
  const secondSettlementId = await settleUp(api, settled.groupId);
  const settledBatch = await batchOf(db, "split_settlements", secondSettlementId);
  assert.equal(settledBatch.id, settled.batchId);
  assert.equal(settledBatch.closed_on, SETTLED_ON);

  const restore = await api("/api/splits/activity-history/restore", { recordKind: "settlement", recordId: settled.settlementId });

  assert.equal(restore.status, 200, JSON.stringify(restore.payload));
  const restoredBatch = await batchOf(db, "split_settlements", settled.settlementId);
  assert.notEqual(restoredBatch.id, settledBatch.id);
  assert.equal(restoredBatch.closed_on, null);
  assert.deepEqual(await batchOf(db, "split_settlements", secondSettlementId), settledBatch);
  assert.deepEqual(await batchOf(db, "split_expenses", settled.splitExpenseId), settledBatch);
});

test("restoring a settle-up that is not in activity history is refused and writes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await settledGroup(api, db);
  const before = await dumpDatabase(db);

  const restore = await api("/api/splits/activity-history/restore", { recordKind: "settlement", recordId: settled.settlementId });

  assert.equal(restore.status, 400, JSON.stringify(restore.payload));
  assert.match(restore.payload.error, /already active/);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a settle-up restore that fails partway writes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await deletedSettleUp(api, db);
  await settleUp(api, settled.groupId);
  const before = await dumpDatabase(db);

  for (const pattern of [/INSERT INTO split_activity_history/, /UPDATE split_settlements SET deleted_at = NULL/]) {
    const faulty = failingStatement(db, pattern);
    const restore = await api("/api/splits/activity-history/restore", { recordKind: "settlement", recordId: settled.settlementId }, { database: faulty.db });
    assert.equal(faulty.state.fired, true, String(pattern));
    assert.notEqual(restore.status, 200);
    assertSameDatabase(await dumpDatabase(db), before);
  }
});

test("Undo settle-up refuses a batch whose activity already moved", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await settledGroup(api, db);
  await createGroupExpense(api, settled.groupId, { description: "After the settle-up", amountMinor: 2_000, date: "2026-05-18" });
  assert.equal((await api("/api/splits/batches/reopen", { batchId: settled.batchId })).status, 200);
  const before = await dumpDatabase(db);

  const again = await api("/api/splits/batches/reopen", { batchId: settled.batchId });

  assert.equal(again.status, 400, JSON.stringify(again.payload));
  assert.match(again.payload.error, /already undone/);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("activity recorded after a settle-up stays editable", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const settled = await settledGroup(api, db);
  const laterExpenseId = await createGroupExpense(api, settled.groupId, { description: "After the settle-up", amountMinor: 2_000, date: "2026-05-18" });

  const update = await api("/api/splits/expenses/update", expenseEdit(laterExpenseId, settled.groupId, { description: "After the settle-up", amountMinor: 5_000 }, { date: "2026-05-18" }));
  assert.equal(update.status, 200, JSON.stringify(update.payload));
  const removal = await api("/api/splits/expenses/delete", { splitExpenseId: laterExpenseId });
  assert.equal(removal.status, 200, JSON.stringify(removal.payload));
});

test("rolling back an import leaves a split in a settled group batch intact", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const groupId = await createGroup(api);
  const csv = [
    "date,description,amount,account,category,note",
    "2026-05-16,SETTLED TRIP IMPORT,-60.00,UOB One,Groceries,"
  ].join("\n");
  const preview = await api("/api/imports/preview", { sourceLabel: "Trip CSV", sourceType: "csv", csv, ownershipType: "direct", ownerName: "Tim" });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const commit = await api("/api/imports/commit", { sourceLabel: "Trip CSV", sourceType: "csv", parserKey: "generic_csv", rows: preview.payload.preview.previewRows });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [{ id: entryId }] = await rows(db, "SELECT id FROM transactions WHERE import_id = ?", commit.payload.importId);
  const split = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: groupId });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  await settleUp(api, groupId);
  const splitBefore = await splitState(db, split.payload.splitExpenseId);
  assert.equal((await batchOf(db, "split_expenses", split.payload.splitExpenseId)).closed_on, SETTLED_ON);

  const rollback = await api("/api/imports/rollback", { importId: commit.payload.importId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT linked_transaction_id FROM split_expenses WHERE id = ?", split.payload.splitExpenseId), [{ linked_transaction_id: null }]);
  assert.deepEqual(await splitState(db, split.payload.splitExpenseId), splitBefore);
  assert.equal((await batchOf(db, "split_expenses", split.payload.splitExpenseId)).closed_on, SETTLED_ON);
});
