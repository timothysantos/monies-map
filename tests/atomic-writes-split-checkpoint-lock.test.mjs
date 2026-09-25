// Settlement checkpoint lock: a split record included in an active simplified
// settlement keeps the facts its settled balance was computed from. Any
// command that would change them (Splits edit or delete, or a ledger entry
// edit whose linked split would follow) is refused as a whole with a
// `split_settlement_locked` error that names the settlement, and writes
// nothing. After "Undo simplification" (reopen) the same change saves.
// Runs against a real local D1 (Miniflare) seeded with the demo household.
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
const LOCKED = "split_settlement_locked";

// A cash split expense in Non-group expenses. Tim is the first share person,
// so splitAmountMinor is Tim's share.
async function createSplitExpense(api, { description, amountMinor, payerPersonName = "Tim", splitAmountMinor = amountMinor / 2 }) {
  const created = await api("/api/splits/expenses/create", {
    groupId: null,
    date: DATE,
    description,
    categoryName: "Groceries",
    payerPersonName,
    amountMinor,
    splitAmountMinor,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    note: "shared shop"
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.splitExpenseId;
}

// The Splits editor payload for that expense, unchanged unless overridden.
function expenseEdit(splitExpenseId, { description, amountMinor }, overrides = {}) {
  return {
    splitExpenseId,
    groupId: null,
    date: DATE,
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor,
    splitAmountMinor: amountMinor / 2,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    note: "shared shop",
    ...overrides
  };
}

// A Tim expense on UOB One added to splits (50/50).
async function createLinkedEntry(api, { description, amountMinor }) {
  const entryId = await createEntry(api, { date: DATE, description, amountMinor });
  const split = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  return { entryId, splitExpenseId: split.payload.splitExpenseId };
}

// The Entries editor payload (person view: saved as a direct entry).
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

async function simplify(api, date = "2026-05-20") {
  const checkpoint = await api("/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date, currency: "SGD" });
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.payload));
  return checkpoint.payload;
}

async function splitState(db, splitExpenseId) {
  const [expense] = await rows(db, "SELECT total_amount_minor, payer_person_id, expense_date, split_group_id, deleted_at FROM split_expenses WHERE id = ?", splitExpenseId);
  const shares = await rows(db, "SELECT person_id, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", splitExpenseId);
  return { expense, shares };
}

async function checkpointState(db, checkpointId) {
  const [checkpoint] = await rows(db, "SELECT amount_minor, status, settled_at, from_person_id, to_person_id FROM split_settlement_checkpoints WHERE id = ?", checkpointId);
  const items = await rows(db, "SELECT record_kind, record_id FROM split_settlement_checkpoint_items WHERE checkpoint_id = ? ORDER BY record_id", checkpointId);
  return { checkpoint, items };
}

async function includedIds(db, checkpointId) {
  return (await checkpointState(db, checkpointId)).items.map((item) => item.record_id);
}

function assertLocked(response, checkpointId, messagePattern) {
  assert.equal(response.status, 409, JSON.stringify(response.payload));
  assert.equal(response.payload.ok, false);
  assert.equal(response.payload.code, LOCKED);
  assert.equal(response.payload.checkpointId, checkpointId);
  assert.match(response.payload.error, /simplified settlement/);
  assert.match(response.payload.error, /Undo the simplification/);
  if (messagePattern) assert.match(response.payload.error, messagePattern);
}

test("a Splits edit that changes a settled expense's amount, shares, payer, date or group is refused and writes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Settled weekly shop";
  const splitExpenseId = await createSplitExpense(api, { description, amountMinor: 6_000 });
  const checkpoint = await simplify(api);
  assert.ok((await includedIds(db, checkpoint.checkpointId)).includes(splitExpenseId));
  const group = await api("/api/splits/groups/create", { name: "Lock test group", currency: "SGD", expenseSource: "mixed" });
  assert.equal(group.status, 200, JSON.stringify(group.payload));
  const before = await dumpDatabase(db);

  const variants = [
    [{ amountMinor: 8_000, splitAmountMinor: 4_000 }, /amount/],
    [{ splitAmountMinor: 2_000 }, /shares/],
    [{ payerPersonName: "Joyce" }, /who paid/],
    [{ date: "2026-05-17" }, /date/],
    [{ groupId: group.payload.groupId }, /group/]
  ];
  for (const [overrides, changed] of variants) {
    const update = await api("/api/splits/expenses/update", expenseEdit(splitExpenseId, { description, amountMinor: 6_000 }, overrides));
    assertLocked(update, checkpoint.checkpointId, changed);
  }

  assertSameDatabase(await dumpDatabase(db), before);
});

test("description, category and note stay editable on a settled expense", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const splitExpenseId = await createSplitExpense(api, { description: "Settled market run", amountMinor: 6_000 });
  const checkpoint = await simplify(api);
  const splitBefore = await splitState(db, splitExpenseId);
  const checkpointBefore = await checkpointState(db, checkpoint.checkpointId);

  const update = await api("/api/splits/expenses/update", expenseEdit(splitExpenseId, { description: "Settled market run (renamed)", amountMinor: 6_000 }, {
    categoryName: "Food & Drinks",
    note: "renamed after settling"
  }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual(await rows(db, "SELECT description, note FROM split_expenses WHERE id = ?", splitExpenseId), [
    { description: "Settled market run (renamed)", note: "renamed after settling" }
  ]);
  assert.deepEqual(await splitState(db, splitExpenseId), splitBefore);
  assert.deepEqual(await checkpointState(db, checkpoint.checkpointId), checkpointBefore);
});

test("deleting a settled expense is refused and writes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const splitExpenseId = await createSplitExpense(api, { description: "Settled taxi", amountMinor: 3_000 });
  const checkpoint = await simplify(api);
  const before = await dumpDatabase(db);

  const removal = await api("/api/splits/expenses/delete", { splitExpenseId });

  assertLocked(removal, checkpoint.checkpointId, /deleting it/);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("an entry edit that would move a settled linked split is refused as a whole", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Settled linked groceries";
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description, amountMinor: 6_000 });
  const checkpoint = await simplify(api);
  assert.ok((await includedIds(db, checkpoint.checkpointId)).includes(splitExpenseId));
  const before = await dumpDatabase(db);

  // Amount edit: the linked split would follow the new amount.
  const amountEdit = await api("/api/entries/update", entryEdit(entryId, { description, amountMinor: 8_050 }));
  assertLocked(amountEdit, checkpoint.checkpointId, /entry/);
  // Shared save with a new share basis: the split shares would be rewritten.
  const shareEdit = await api("/api/entries/update", entryEdit(entryId, { description, amountMinor: 6_000 }, { ownershipType: "shared", ownerName: undefined, splitBasisPoints: 2_500 }));
  assertLocked(shareEdit, checkpoint.checkpointId, /shares/);
  // Shared save with a new date: the split date would be rewritten.
  const dateEdit = await api("/api/entries/update", entryEdit(entryId, { description, amountMinor: 6_000 }, { ownershipType: "shared", ownerName: undefined, splitBasisPoints: 5_000, date: "2026-05-18" }));
  assertLocked(dateEdit, checkpoint.checkpointId, /date/);

  // Nothing moved: not the entry, not the split, not the month totals.
  assertSameDatabase(await dumpDatabase(db), before);
  assert.deepEqual(await rows(db, "SELECT amount_minor, transaction_date FROM transactions WHERE id = ?", entryId), [{ amount_minor: 6_000, transaction_date: DATE }]);
});

test("an entry edit that leaves the settled split alone still saves", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Settled linked pharmacy";
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description, amountMinor: 6_000 });
  const checkpoint = await simplify(api);
  const splitBefore = await splitState(db, splitExpenseId);
  const checkpointBefore = await checkpointState(db, checkpoint.checkpointId);

  const directEdit = await api("/api/entries/update", entryEdit(entryId, { description: "Settled linked pharmacy (renamed)", amountMinor: 6_000 }, { categoryName: "Food & Drinks", note: "renamed" }));
  assert.equal(directEdit.status, 200, JSON.stringify(directEdit.payload));
  // A household shared save that keeps the amount, date, payer and 50/50 basis.
  const sharedEdit = await api("/api/entries/update", entryEdit(entryId, { description: "Settled linked pharmacy (renamed)", amountMinor: 6_000 }, { ownershipType: "shared", ownerName: undefined, splitBasisPoints: 5_000, categoryName: "Food & Drinks", note: "renamed" }));
  assert.equal(sharedEdit.status, 200, JSON.stringify(sharedEdit.payload));

  assert.deepEqual(await rows(db, "SELECT description, note FROM transactions WHERE id = ?", entryId), [{ description: "Settled linked pharmacy (renamed)", note: "renamed" }]);
  assert.deepEqual(await splitState(db, splitExpenseId), splitBefore);
  assert.deepEqual(await checkpointState(db, checkpoint.checkpointId), checkpointBefore);
});

test("expenses outside the settlement stay editable and deletable", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createSplitExpense(api, { description: "Settled before", amountMinor: 4_000 });
  const checkpoint = await simplify(api);
  const checkpointBefore = await checkpointState(db, checkpoint.checkpointId);
  // Both recorded after the simplification, so they are open, not settled.
  const openExpenseId = await createSplitExpense(api, { description: "Open after settlement", amountMinor: 3_000 });
  const linked = await createLinkedEntry(api, { description: "Open linked after settlement", amountMinor: 6_000 });
  assert.equal((await includedIds(db, checkpoint.checkpointId)).includes(openExpenseId), false);

  const update = await api("/api/splits/expenses/update", expenseEdit(openExpenseId, { description: "Open after settlement", amountMinor: 5_000 }));
  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual((await splitState(db, openExpenseId)).shares.map((share) => share.amount_minor), [2_500, 2_500]);

  const entryUpdate = await api("/api/entries/update", entryEdit(linked.entryId, { description: "Open linked after settlement", amountMinor: 8_000 }));
  assert.equal(entryUpdate.status, 200, JSON.stringify(entryUpdate.payload));
  assert.equal((await splitState(db, linked.splitExpenseId)).expense.total_amount_minor, 8_000);

  const removal = await api("/api/splits/expenses/delete", { splitExpenseId: openExpenseId });
  assert.equal(removal.status, 200, JSON.stringify(removal.payload));
  assert.ok((await splitState(db, openExpenseId)).expense.deleted_at);

  // The settlement itself did not move.
  assert.deepEqual(await checkpointState(db, checkpoint.checkpointId), checkpointBefore);
});

test("after Undo simplification the change saves and the next simplification uses the new amount", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Settled then corrected";
  const splitExpenseId = await createSplitExpense(api, { description, amountMinor: 6_000 });
  const first = await simplify(api);
  const refused = await api("/api/splits/expenses/update", expenseEdit(splitExpenseId, { description, amountMinor: 9_000 }));
  assertLocked(refused, first.checkpointId);

  const reopen = await api("/api/splits/checkpoints/reopen", { checkpointId: first.checkpointId });
  assert.equal(reopen.status, 200, JSON.stringify(reopen.payload));
  const update = await api("/api/splits/expenses/update", expenseEdit(splitExpenseId, { description, amountMinor: 9_000 }));
  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual((await splitState(db, splitExpenseId)).shares.map((share) => share.amount_minor), [4_500, 4_500]);

  const second = await simplify(api, "2026-05-21");
  assert.notEqual(second.checkpointId, first.checkpointId);
  assert.ok((await includedIds(db, second.checkpointId)).includes(splitExpenseId));
  // Tim paid, so Joyce owes his expense's other half: 15.00 more than before.
  const signed = (result) => (result.status === "internally_offset" ? 0 : result.amountMinor);
  const firstFromTim = (await checkpointState(db, first.checkpointId)).checkpoint.from_person_id === "person-tim";
  const secondFromTim = (await checkpointState(db, second.checkpointId)).checkpoint.from_person_id === "person-tim";
  const joyceOwesTim = (result, fromTim) => (fromTim ? -signed(result) : signed(result));
  assert.equal(joyceOwesTim(second, secondFromTim) - joyceOwesTim(first, firstFromTim), 1_500);
  assert.equal((await checkpointState(db, first.checkpointId)).checkpoint.status, "reopened");
});

test("paid, bank-matched and internally offset settlements lock their expenses too", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Settled and paid";
  const splitExpenseId = await createSplitExpense(api, { description, amountMinor: 6_000 });
  const checkpoint = await simplify(api);
  const edit = expenseEdit(splitExpenseId, { description, amountMinor: 7_000 });

  const paid = await api("/api/splits/checkpoints/mark-paid", { checkpointId: checkpoint.checkpointId });
  assert.equal(paid.status, 200, JSON.stringify(paid.payload));
  assertLocked(await api("/api/splits/expenses/update", edit), checkpoint.checkpointId, /marked paid/);

  const transferId = await createEntry(api, {
    date: "2026-05-22",
    description: "Settlement transfer",
    categoryName: "Transfer",
    amountMinor: checkpoint.amountMinor,
    entryType: "transfer",
    transferDirection: "out"
  });
  const match = await api("/api/splits/checkpoints/match", { checkpointId: checkpoint.checkpointId, transactionId: transferId });
  assert.equal(match.status, 200, JSON.stringify(match.payload));
  assert.equal(match.payload.status, "matched");
  assertLocked(await api("/api/splits/expenses/update", edit), checkpoint.checkpointId, /bank matched/);

  // A zero net simplification is still a settlement of these records.
  await db.prepare("UPDATE split_settlement_checkpoints SET status = 'internally_offset', amount_minor = 0 WHERE id = ?").bind(checkpoint.checkpointId).run();
  assertLocked(await api("/api/splits/expenses/delete", { splitExpenseId }), checkpoint.checkpointId);

  // A voided settlement no longer holds its records.
  await db.prepare("UPDATE split_settlement_checkpoints SET status = 'voided' WHERE id = ?").bind(checkpoint.checkpointId).run();
  const afterVoid = await api("/api/splits/expenses/update", edit);
  assert.equal(afterVoid.status, 200, JSON.stringify(afterVoid.payload));
});

test("a settle-up included in a settlement cannot change amount or be deleted, but its note can", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const created = await api("/api/splits/settlements/create", {
    groupId: null,
    date: DATE,
    fromPersonName: "Joyce",
    toPersonName: "Tim",
    amountMinor: 1_000,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    note: "cash back"
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const settlementId = created.payload.settlementId;
  // A settle-up closes its group batch; one in a still-open batch (as older
  // data has) is what a simplification includes.
  await db.prepare("UPDATE split_batches SET closed_on = NULL WHERE id = (SELECT split_batch_id FROM split_settlements WHERE id = ?)").bind(settlementId).run();
  const checkpoint = await simplify(api);
  assert.ok((await includedIds(db, checkpoint.checkpointId)).includes(settlementId));
  const before = await dumpDatabase(db);
  const settlementEdit = {
    settlementId,
    groupId: null,
    date: DATE,
    fromPersonName: "Joyce",
    toPersonName: "Tim",
    amountMinor: 1_500,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    note: "cash back"
  };

  assertLocked(await api("/api/splits/settlements/update", settlementEdit), checkpoint.checkpointId, /settle-up/);
  assertLocked(await api("/api/splits/settlements/update", { ...settlementEdit, amountMinor: 1_000, fromPersonName: "Tim", toPersonName: "Joyce" }), checkpoint.checkpointId, /who paid/);
  assertLocked(await api("/api/splits/settlements/delete", { settlementId }), checkpoint.checkpointId);
  assertSameDatabase(await dumpDatabase(db), before);

  const noteEdit = await api("/api/splits/settlements/update-note", { settlementId, note: "cash back, confirmed" });
  assert.equal(noteEdit.status, 200, JSON.stringify(noteEdit.payload));
});

test("rolling back an import leaves a settled split linked to its entry intact", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const csv = [
    "date,description,amount,account,category,note",
    "2026-05-19,SETTLED IMPORT DINNER,-60.00,UOB One,Groceries,"
  ].join("\n");
  const preview = await api("/api/imports/preview", { sourceLabel: "Lock CSV", sourceType: "csv", csv, ownershipType: "direct", ownerName: "Tim" });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const commit = await api("/api/imports/commit", { sourceLabel: "Lock CSV", sourceType: "csv", parserKey: "generic_csv", rows: preview.payload.preview.previewRows });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [{ id: entryId }] = await rows(db, "SELECT id FROM transactions WHERE import_id = ?", commit.payload.importId);
  const split = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  const checkpoint = await simplify(api);
  const splitBefore = await splitState(db, split.payload.splitExpenseId);
  const checkpointBefore = await checkpointState(db, checkpoint.checkpointId);
  assert.ok(checkpointBefore.items.some((item) => item.record_id === split.payload.splitExpenseId));

  // Rollback removes the imported entry; the split only loses its ledger link,
  // so the settled amount, shares and payer are untouched.
  const rollback = await api("/api/imports/rollback", { importId: commit.payload.importId });

  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE id = ?", entryId), []);
  assert.deepEqual(await rows(db, "SELECT linked_transaction_id FROM split_expenses WHERE id = ?", split.payload.splitExpenseId), [{ linked_transaction_id: null }]);
  assert.deepEqual(await splitState(db, split.payload.splitExpenseId), splitBefore);
  assert.deepEqual(await checkpointState(db, checkpoint.checkpointId), checkpointBefore);
});

// All-or-nothing: the split workspace commands this lock guards commit their
// writes in one batch, so a failure part way leaves the database unchanged.

test("a split expense edit that fails while writing its shares changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Atomic split edit";
  const splitExpenseId = await createSplitExpense(api, { description, amountMinor: 6_000 });
  // A new group has no batch yet, so the edit also creates one.
  const group = await api("/api/splits/groups/create", { name: "Atomic group", currency: "SGD", expenseSource: "mixed" });
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO split_expense_shares/);

  const update = await api("/api/splits/expenses/update", expenseEdit(splitExpenseId, { description, amountMinor: 8_000 }, { groupId: group.payload.groupId }), { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(update.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a split expense delete that fails while recording history changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const splitExpenseId = await createSplitExpense(api, { description: "Atomic split delete", amountMinor: 6_000 });
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO split_activity_history/);

  const removal = await api("/api/splits/expenses/delete", { splitExpenseId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(removal.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a settle-up edit or delete that fails part way changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const created = await api("/api/splits/settlements/create", {
    groupId: null,
    date: DATE,
    fromPersonName: "Joyce",
    toPersonName: "Tim",
    amountMinor: 1_000,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const settlementId = created.payload.settlementId;
  const before = await dumpDatabase(db);

  const faultyUpdate = failingStatement(db, /UPDATE split_batches/);
  const update = await api("/api/splits/settlements/update", {
    settlementId,
    groupId: null,
    date: DATE,
    fromPersonName: "Joyce",
    toPersonName: "Tim",
    amountMinor: 2_000,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  }, { database: faultyUpdate.db });
  assert.equal(faultyUpdate.state.fired, true);
  assert.notEqual(update.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);

  const faultyDelete = failingStatement(db, /INSERT INTO split_activity_history/);
  const removal = await api("/api/splits/settlements/delete", { settlementId }, { database: faultyDelete.db });
  assert.equal(faultyDelete.state.fired, true);
  assert.notEqual(removal.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("the Splits page marks settled records so the editor can explain the lock", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const splitExpenseId = await createSplitExpense(api, { description: "Marked settled", amountMinor: 2_000 });
  const checkpoint = await simplify(api);

  const splitsPage = await api(`/api/splits-page?view=person-tim&month=${MONTH}`);

  assert.equal(splitsPage.status, 200);
  const row = splitsPage.payload.splitsPage.activity.find((item) => item.id === splitExpenseId);
  assert.equal(row.settlementCheckpointId, checkpoint.checkpointId);
  assert.equal(row.settlementStatus, "settled");
});
