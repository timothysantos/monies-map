// "Add to Splits" in the picked rows' bar (Entries): one group and one share
// the person chose, for every picked entry, through the SAME all-or-nothing
// command Usually shared uses (addEntriesToSplitsRecord) with its own audit
// event and one-batch Undo. Every refusal changes nothing for that entry.
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
import { DEFAULT_HOUSEHOLD_ID } from "../src/domain/app-repository-constants.ts";
import { recalculateMonthlySnapshots } from "../src/domain/app-repository-snapshots.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const GROUP = "split-group-baby-river";
const ADD = "/api/splits/expenses/add-chosen";
const UNDO = "/api/splits/expenses/remove-added";

function daysAgo(days) {
  const date = new Date(`${todayInAppTimeZone()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function entries(api, count, extra = {}) {
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await createEntry(api, { date: daysAgo(2 + index), description: `Pick shop ${index}`, amountMinor: 1000 + index * 100, ...extra }));
  }
  return ids;
}

const body = (entryIds, extra = {}) => ({ splitGroupId: GROUP, payerShareBasisPoints: 5000, entryIds, ...extra });

test("Add puts every picked entry on the chosen group with the chosen share in one write, with its own audit event and fresh month totals", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await entries(api, 3);
  const entriesBefore = await rows(db, "SELECT * FROM transactions WHERE id IN (?, ?, ?) ORDER BY id", ...ids);
  const auditBefore = (await rows(db, "SELECT COUNT(*) AS n FROM audit_events"))[0].n;

  // Tim paid, Joyce owes all of it (Tim's own share is 0).
  const { status, payload } = await api(ADD, body(ids, { payerShareBasisPoints: 0 }));
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.addedCount, 3);
  assert.deepEqual(payload.refused, []);
  assert.deepEqual(payload.added.map((row) => row.splitGroupId), [GROUP, GROUP, GROUP]);
  assert.equal(payload.undoSplitExpenseIds.length, 3);

  assert.deepEqual(await rows(db, "SELECT * FROM transactions WHERE id IN (?, ?, ?) ORDER BY id", ...ids), entriesBefore);
  for (const entryId of ids) {
    const [split] = await rows(db, "SELECT id, split_group_id, payer_person_id, total_amount_minor FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", entryId);
    assert.equal(split.split_group_id, GROUP);
    assert.equal(split.payer_person_id, "person-tim");
    const shares = await rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", split.id);
    assert.deepEqual(shares, [
      { person_id: "person-joyce", ratio_basis_points: 10000, amount_minor: split.total_amount_minor },
      { person_id: "person-tim", ratio_basis_points: 0, amount_minor: 0 }
    ]);
  }
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM audit_events"))[0].n, auditBefore + 1);
  const [audit] = await rows(db, "SELECT action, detail FROM audit_events WHERE action = 'split_expenses_added_chosen'");
  assert.match(audit.detail, /Added 3 picked entries to Splits/);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'split_expenses_added_usual'"))[0].n, 0);

  const month = (await rows(db, "SELECT substr(transaction_date, 1, 7) AS month FROM transactions WHERE id = ?", ids[0]))[0].month;
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
  const stored = await snapshotTotals(db, month);
  await recalculateMonthlySnapshots(db, month);
  assert.deepEqual(stored, await snapshotTotals(db, month), "stored month totals are stale");
});

test("half each splits each entry evenly whoever paid it, and the payer is each entry's owner", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const [tim] = await entries(api, 1);
  const [joyce] = await entries(api, 1, { ownerName: "Joyce", description: "Joyce shop" });
  const { status, payload } = await api(ADD, body([tim, joyce]));
  assert.equal(status, 200, JSON.stringify(payload));
  const payers = await rows(db, "SELECT linked_transaction_id AS id, payer_person_id AS payer FROM split_expenses WHERE deleted_at IS NULL AND linked_transaction_id IN (?, ?)", tim, joyce);
  assert.deepEqual(Object.fromEntries(payers.map((row) => [row.id, row.payer])), { [tim]: "person-tim", [joyce]: "person-joyce" });
  const ratios = await rows(db, "SELECT ratio_basis_points FROM split_expense_shares WHERE split_expense_id IN (?, ?)", ...payload.added.map((row) => row.splitExpenseId));
  assert.deepEqual(ratios.map((row) => row.ratio_basis_points), [5000, 5000, 5000, 5000]);
});

test("the payer's share follows the payer: Joyce paying with a 30% share leaves Tim 70%", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const [joyce] = await entries(api, 1, { ownerName: "Joyce", description: "Joyce shop", amountMinor: 2000 });
  const { payload } = await api(ADD, body([joyce], { payerShareBasisPoints: 3000 }));
  const shares = await rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", payload.added[0].splitExpenseId);
  assert.deepEqual(shares, [
    { person_id: "person-joyce", ratio_basis_points: 3000, amount_minor: 600 },
    { person_id: "person-tim", ratio_basis_points: 7000, amount_minor: 1400 }
  ]);
});

test("an entry already on Splits is skipped with its reason and the rest still go", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await entries(api, 3);
  const first = await api("/api/splits/expenses/from-entry", { entryId: ids[0], splitGroupId: GROUP });
  assert.equal(first.status, 200, JSON.stringify(first.payload));
  const before = await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", ids[0]);
  const { status, payload } = await api(ADD, body(ids));
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.addedCount, 2);
  assert.deepEqual(payload.refused.map((row) => row.entryId), [ids[0]]);
  assert.match(payload.refused[0].reason, /already linked/);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", ids[0]), before);
});

test("income is refused with its reason", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const [expense] = await entries(api, 1);
  const income = await createEntry(api, { date: daysAgo(2), description: "Salary", entryType: "income", categoryName: "Other - Income", amountMinor: 5000 });
  const { payload } = await api(ADD, body([expense, income]));
  assert.equal(payload.addedCount, 1);
  assert.deepEqual(payload.refused, [{ entryId: income, reason: "Only expense entries can be added to splits." }]);
});

test("an entry whose owner is neither of the two people Splits shares between is refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const [ok, other] = await entries(api, 2);
  // The people table only allows an owner and a partner, so the guard is
  // proved with a third row written past that check.
  await db.prepare("PRAGMA ignore_check_constraints = ON").run();
  await db.prepare("INSERT INTO people (id, household_id, display_name, role) VALUES ('person-guest', ?, 'Guest', 'guest')").bind(DEFAULT_HOUSEHOLD_ID).run();
  await db.prepare("PRAGMA ignore_check_constraints = OFF").run();
  await db.prepare("UPDATE transactions SET owner_person_id = 'person-guest' WHERE id = ?").bind(other).run();
  const { payload } = await api(ADD, body([ok, other]));
  assert.equal(payload.addedCount, 1);
  assert.deepEqual(payload.refused, [{ entryId: other, reason: "Splits are shared between two people, and this entry was paid by someone else." }]);
});

test("a group in another currency refuses its entries and says why; an unknown group adds nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await entries(api, 2);
  const tokyo = await api("/api/splits/groups/create", { name: "Tokyo pick", currency: "JPY" });
  const jpy = await api(ADD, { splitGroupId: tokyo.payload.groupId, payerShareBasisPoints: 5000, entryIds: ids });
  assert.equal(jpy.status, 200, JSON.stringify(jpy.payload));
  assert.equal(jpy.payload.addedCount, 0);
  assert.match(jpy.payload.refused[0].reason, /This group uses JPY/);
  const before = await dumpDatabase(db);
  const missing = await api(ADD, { splitGroupId: "split-group-nowhere", payerShareBasisPoints: 5000, entryIds: ids });
  assert.equal(missing.payload.addedCount, 0);
  assert.equal(missing.payload.refused[0].reason, "Split group not found.");
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a statement-certified entry keeps its bank facts: only the split is added", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const [id] = await entries(api, 1);
  await db.prepare("UPDATE transactions SET bank_certification_status = 'statement_certified' WHERE id = ?").bind(id).run();
  const before = await rows(db, "SELECT * FROM transactions WHERE id = ?", id);
  const { status, payload } = await api(ADD, body([id]));
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.addedCount, 1);
  assert.deepEqual(await rows(db, "SELECT * FROM transactions WHERE id = ?", id), before);
});

test("a stale pick: an entry deleted meanwhile is refused as not found and the rest still go", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const ids = await entries(api, 2);
  const { payload } = await api(ADD, body([ids[0], "txn-gone", ids[1]]));
  assert.equal(payload.addedCount, 2);
  assert.deepEqual(payload.refused, [{ entryId: "txn-gone", reason: "Entry not found." }]);
});

test("more than 10 need the confirm count, more than 200 are refused, and a bad share, empty or repeated list changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await entries(api, 12);
  const before = await dumpDatabase(db);
  const unconfirmed = await api(ADD, body(ids));
  assert.equal(unconfirmed.status, 400);
  assert.match(unconfirmed.payload.error, /Confirm adding all 12 entries first/);
  assert.equal((await api(ADD, body(ids, { confirmedCount: 11 }))).status, 400);
  const tooMany = await api(ADD, body(Array.from({ length: 201 }, (_, index) => `txn-${index}`), { confirmedCount: 201 }));
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.payload.error, /At most 200/);
  for (const bad of [
    { entryIds: [] },
    { entryIds: [ids[0]], payerShareBasisPoints: 10001 },
    { entryIds: [ids[0]], payerShareBasisPoints: "half" },
    { entryIds: [ids[0]], payerShareBasisPoints: 2500.5 },
    { entryIds: [ids[0], ids[0]] }
  ]) {
    assert.equal((await api(ADD, { ...body([]), ...bad })).status, 400, JSON.stringify(bad));
  }
  assertSameDatabase(await dumpDatabase(db), before);
  const confirmed = await api(ADD, body(ids, { confirmedCount: 12 }));
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.payload));
  assert.equal(confirmed.payload.addedCount, 12);
});

test("Undo takes every added split back off in one write with its own audit event; a settled period refuses it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await entries(api, 2);
  const added = await api(ADD, body(ids));
  const splitIds = added.payload.undoSplitExpenseIds;
  const [{ split_batch_id: batchId }] = await rows(db, "SELECT split_batch_id FROM split_expenses WHERE id = ?", splitIds[0]);
  const stateBefore = await dumpDatabase(db);
  await db.prepare("UPDATE split_batches SET closed_on = '2026-11-01' WHERE id = ?").bind(batchId).run();
  const locked = await api(UNDO, { splitExpenseIds: splitIds, source: "chosen" });
  assert.equal(locked.status, 409, JSON.stringify(locked.payload));
  await db.prepare("UPDATE split_batches SET closed_on = NULL WHERE id = ?").bind(batchId).run();
  assertSameDatabase(await dumpDatabase(db), stateBefore);

  const undone = await api(UNDO, { splitExpenseIds: splitIds, source: "chosen" });
  assert.equal(undone.status, 200, JSON.stringify(undone.payload));
  assert.equal(undone.payload.removedCount, 2);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE id IN (?, ?) AND deleted_at IS NULL", ...splitIds))[0].n, 0);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'split_expenses_removed_chosen'"))[0].n, 1);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
  assert.equal((await api(UNDO, { splitExpenseIds: splitIds, source: "chosen" })).status, 400);
  // The entries can go on Splits again.
  assert.equal((await api(ADD, body(ids))).payload.addedCount, 2);
});

test("the route only answers POST and reads its body through the size limit", async (t) => {
  const { fetch } = await openSeededDatabase(t, template);
  assert.equal((await fetch(ADD)).status, 405);
  const big = await fetch(ADD, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(200 * 1024) },
    body: JSON.stringify({ entryIds: [], pad: "x".repeat(200 * 1024) })
  });
  assert.equal(big.status, 413);
});

// --- all or nothing ---------------------------------------------------------

for (const [label, pattern, skip] of [
  ["the second split's shares", /INSERT INTO split_expense_shares/, 2],
  ["the audit event", /INSERT INTO audit_events/, 0],
  ["the month refresh marker", /INSERT INTO monthly_snapshot_refreshes/, 0]
]) {
  test(`Add that fails at ${label} changes nothing`, async (t) => {
    const { db, api } = await openSeededDatabase(t, template);
    const ids = await entries(api, 2);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern, { skip });
    const result = await api(ADD, body(ids), { database: faulty.db });
    assert.equal(faulty.state.fired, true);
    assert.notEqual(result.status, 200);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

for (const [label, pattern, skip] of [
  ["the history events", /INSERT INTO split_activity_history/, 1],
  ["the archive of the last split", /UPDATE split_expenses SET deleted_at/, 1],
  ["the audit event", /INSERT INTO audit_events/, 0]
]) {
  test(`Undo that fails at ${label} changes nothing`, async (t) => {
    const { db, api } = await openSeededDatabase(t, template);
    const ids = await entries(api, 2);
    const added = await api(ADD, body(ids));
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern, { skip });
    const result = await api(UNDO, { splitExpenseIds: added.payload.undoSplitExpenseIds, source: "chosen" }, { database: faulty.db });
    assert.equal(faulty.state.fired, true);
    assert.notEqual(result.status, 200);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}
