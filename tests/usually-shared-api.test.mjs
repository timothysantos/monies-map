// Usually shared through the real Worker and a real local D1 seeded with the
// demo household (DOMAIN.md "Usually Shared"): the list is read-only and uses
// the single-entry rule's history; Add puts the shop's entries on Splits with
// the usual split through ONE all-or-nothing batch with an audit event; Undo
// takes them off again in one batch; every refusal changes nothing.
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
import { snapshotTotals } from "./support/d1-workspace.mjs";
import { recalculateMonthlySnapshots } from "../src/domain/app-repository-snapshots.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const SHOP = "Cold Storage Holland V";
const GROUP = "split-group-baby-river";

function daysAgo(days) {
  const date = new Date(`${todayInAppTimeZone()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

// Tim shared the shop in Baby River three times, 100 to 200 days ago, and
// bought there `fresh` more times in the last 30 days without adding them.
async function seed(api, { shop = SHOP, fresh = 2, shared = 3, unsharedOld = 1, owner = "Tim" } = {}) {
  await api("/api/ask/habits/setting", { enabled: false });
  const oldIds = [];
  for (let index = 0; index < shared + unsharedOld; index += 1) {
    const entryId = await createEntry(api, { date: daysAgo(120 + index * 20), description: shop, amountMinor: 2400 + index, ownerName: owner });
    if (index < shared) {
      const added = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: GROUP });
      assert.equal(added.status, 200, JSON.stringify(added.payload));
    }
    oldIds.push(entryId);
  }
  const freshIds = [];
  for (let index = 0; index < fresh; index += 1) {
    freshIds.push(await createEntry(api, { date: daysAgo(3 + index * 10), description: shop, amountMinor: 1000 + index * 100, ownerName: owner }));
  }
  return { oldIds, freshIds };
}

const addBody = (entryIds, extra = {}) => ({ groups: [{ splitGroupId: GROUP, payerShareBasisPoints: 5000, entryIds }], ...extra });

test("the list names each shop's unsplit entries with the usual group, share, person and evidence, and writes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { freshIds } = await seed(api);
  await api("/api/splits/usually-shared");
  const before = await dumpDatabase(db);
  const { status, payload } = await api("/api/splits/usually-shared");
  assertSameDatabase(await dumpDatabase(db), before);

  assert.equal(status, 200, JSON.stringify(payload));
  const group = payload.groups.find((candidate) => candidate.shopName === SHOP);
  assert.ok(group, JSON.stringify(payload.groups.map((candidate) => candidate.shopName)));
  assert.equal(group.groupId, GROUP);
  assert.equal(group.groupName, "Baby River");
  assert.equal(group.basisPoints, 5000);
  assert.equal(group.ownerName, "Tim");
  assert.equal(group.otherPersonName, "Joyce");
  assert.equal(group.matchedBy, "description");
  // The newest entry's evidence: of the other five at the shop (the
  // unshared old one and the other new one count as not shared), three
  // went to Baby River.
  assert.equal(group.evidenceCount, 3);
  assert.equal(group.matchedCount, 5);
  assert.deepEqual(group.entries.map((entry) => entry.id).sort(), [...freshIds].sort());
  assert.equal(group.totalMinor, 1000 + 1100);
  assert.equal(payload.entryCount, payload.groups.reduce((sum, candidate) => sum + candidate.entries.length, 0));
  assert.equal(payload.shopCount, payload.groups.length);
});

test("the list leaves out entries already on Splits, older than 90 days, Joyce's with no habit, income and shops rarely shared", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { freshIds } = await seed(api);
  // Already on Splits.
  const added = await api("/api/splits/expenses/from-entry", { entryId: freshIds[0], splitGroupId: GROUP });
  assert.equal(added.status, 200, JSON.stringify(added.payload));
  // Too old for the list (still history).
  await createEntry(api, { date: daysAgo(100), description: SHOP, amountMinor: 700 });
  // Never shared: one shared of four.
  await seed(api, { shop: "Rarely Shared Bakery", fresh: 1, shared: 1, unsharedOld: 3 });
  // Joyce buys at the shop but has never shared it.
  const joyceEntry = await createEntry(api, { date: daysAgo(4), description: SHOP, amountMinor: 900, ownerName: "Joyce" });

  const { payload } = await api("/api/splits/usually-shared");
  const ids = payload.groups.flatMap((group) => group.entries.map((entry) => entry.id));
  assert.equal(ids.includes(freshIds[0]), false, "already on Splits");
  assert.equal(ids.includes(freshIds[1]), true);
  assert.equal(ids.includes(joyceEntry), false, "Joyce has no habit at this shop");
  assert.equal(payload.groups.some((group) => group.shopName === "Rarely Shared Bakery"), false);
  assert.equal(payload.groups.flatMap((group) => group.entries).some((entry) => entry.date < daysAgo(90)), false);
});

test("Add puts every entry on Splits with the usual split in one write, with an audit event and fresh month totals; the entry itself is untouched", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { freshIds } = await seed(api);
  const entriesBefore = await rows(db, "SELECT * FROM transactions WHERE id IN (?, ?) ORDER BY id", ...freshIds);
  const auditBefore = (await rows(db, "SELECT COUNT(*) AS n FROM audit_events"))[0].n;

  const { status, payload } = await api("/api/splits/expenses/add-usual", addBody(freshIds));
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.addedCount, 2);
  assert.deepEqual(payload.refused, []);
  assert.equal(payload.undoSplitExpenseIds.length, 2);

  assert.deepEqual(await rows(db, "SELECT * FROM transactions WHERE id IN (?, ?) ORDER BY id", ...freshIds), entriesBefore);
  for (const entryId of freshIds) {
    const [split] = await rows(db, "SELECT id, split_group_id, payer_person_id, total_amount_minor, deleted_at FROM split_expenses WHERE linked_transaction_id = ?", entryId);
    assert.equal(split.split_group_id, GROUP);
    assert.equal(split.payer_person_id, "person-tim");
    assert.equal(split.deleted_at, null);
    const shares = await rows(db, "SELECT person_id, ratio_basis_points FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", split.id);
    assert.deepEqual(shares.map((share) => share.ratio_basis_points), [5000, 5000]);
  }
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM audit_events"))[0].n, auditBefore + 1);
  const [audit] = await rows(db, "SELECT action, detail FROM audit_events WHERE action = 'split_expenses_added_usual'");
  assert.match(audit.detail, /Added 2 entries to Splits/);

  const month = (await rows(db, "SELECT substr(transaction_date, 1, 7) AS month FROM transactions WHERE id = ?", freshIds[0]))[0].month;
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
  const stored = await snapshotTotals(db, month);
  await recalculateMonthlySnapshots(db, month);
  assert.deepEqual(stored, await snapshotTotals(db, month), "stored month totals are stale");

  const after = await api("/api/splits/usually-shared");
  assert.equal(after.payload.groups.some((group) => group.shopName === SHOP), false);
});

test("a payer who is the second person gets the usual share the right way round", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const oldIds = [];
  await api("/api/ask/habits/setting", { enabled: false });
  for (let index = 0; index < 3; index += 1) {
    const entryId = await createEntry(api, { date: daysAgo(130 + index * 10), description: "Joyce Bakery", amountMinor: 1000, ownerName: "Joyce" });
    // 70% Joyce / 30% Tim: the add route takes the first person's (Tim's) share.
    const added = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: GROUP, splitBasisPoints: 3000 });
    assert.equal(added.status, 200, JSON.stringify(added.payload));
    oldIds.push(entryId);
  }
  const fresh = await createEntry(api, { date: daysAgo(5), description: "Joyce Bakery", amountMinor: 2000, ownerName: "Joyce" });
  const list = await api("/api/splits/usually-shared");
  const group = list.payload.groups.find((candidate) => candidate.shopName === "Joyce Bakery");
  assert.equal(group.ownerName, "Joyce");
  assert.equal(group.basisPoints, 7000);

  const { status, payload } = await api("/api/splits/expenses/add-usual", { groups: [{ splitGroupId: GROUP, payerShareBasisPoints: group.basisPoints, entryIds: [fresh] }] });
  assert.equal(status, 200, JSON.stringify(payload));
  const shares = await rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", payload.added[0].splitExpenseId);
  assert.deepEqual(shares, [
    { person_id: "person-joyce", ratio_basis_points: 7000, amount_minor: 1400 },
    { person_id: "person-tim", ratio_basis_points: 3000, amount_minor: 600 }
  ]);
});

test("a statement-certified entry keeps its bank facts: only the split is added", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { freshIds } = await seed(api, { fresh: 1 });
  await db.prepare("UPDATE transactions SET bank_certification_status = 'statement_certified' WHERE id = ?").bind(freshIds[0]).run();
  const before = await rows(db, "SELECT * FROM transactions WHERE id = ?", freshIds[0]);
  const { status, payload } = await api("/api/splits/expenses/add-usual", addBody(freshIds));
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.addedCount, 1);
  assert.deepEqual(await rows(db, "SELECT * FROM transactions WHERE id = ?", freshIds[0]), before);
});

test("an entry that cannot be added is refused with its reason while the rest still go", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { freshIds, oldIds } = await seed(api);
  const income = await createEntry(api, { date: daysAgo(2), description: "Salary", entryType: "income", categoryName: "Other - Income", amountMinor: 5000 });
  const { status, payload } = await api("/api/splits/expenses/add-usual", addBody([freshIds[0], oldIds[0], income, "txn-missing"]));
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.addedCount, 1);
  assert.deepEqual(payload.added.map((row) => row.entryId), [freshIds[0]]);
  const reasons = Object.fromEntries(payload.refused.map((row) => [row.entryId, row.reason]));
  assert.match(reasons[oldIds[0]], /already linked/);
  assert.match(reasons[income], /Only expense entries/);
  assert.equal(reasons["txn-missing"], "Entry not found.");
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", freshIds[1]))[0].n, 0);
});

test("a group in another currency refuses its entries and says why", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { freshIds } = await seed(api, { fresh: 1 });
  const tokyo = await api("/api/splits/groups/create", { name: "Tokyo usual", currency: "JPY" });
  assert.equal(tokyo.status, 200, JSON.stringify(tokyo.payload));
  const { status, payload } = await api("/api/splits/expenses/add-usual", { groups: [{ splitGroupId: tokyo.payload.groupId, payerShareBasisPoints: 5000, entryIds: freshIds }] });
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.addedCount, 0);
  assert.match(payload.refused[0].reason, /This group uses JPY/);
});

test("more than 10 entries need the confirm count, more than 200 are refused, and a bad share or empty list changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { freshIds } = await seed(api, { fresh: 12 });
  const before = await dumpDatabase(db);

  const unconfirmed = await api("/api/splits/expenses/add-usual", addBody(freshIds));
  assert.equal(unconfirmed.status, 400);
  assert.match(unconfirmed.payload.error, /Confirm adding all 12 entries first/);
  const wrong = await api("/api/splits/expenses/add-usual", addBody(freshIds, { confirmedCount: 11 }));
  assert.equal(wrong.status, 400);
  const tooMany = await api("/api/splits/expenses/add-usual", addBody(Array.from({ length: 201 }, (_, index) => `txn-${index}`), { confirmedCount: 201 }));
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.payload.error, /At most 200/);
  for (const body of [
    { groups: [] },
    { groups: [{ splitGroupId: GROUP, payerShareBasisPoints: 10001, entryIds: [freshIds[0]] }] },
    { groups: [{ splitGroupId: GROUP, payerShareBasisPoints: "half", entryIds: [freshIds[0]] }] },
    { groups: [{ splitGroupId: GROUP, payerShareBasisPoints: 5000, entryIds: [freshIds[0], freshIds[0]] }] }
  ]) {
    const refused = await api("/api/splits/expenses/add-usual", body);
    assert.equal(refused.status, 400, JSON.stringify(body));
  }
  assertSameDatabase(await dumpDatabase(db), before);

  const confirmed = await api("/api/splits/expenses/add-usual", addBody(freshIds, { confirmedCount: 12 }));
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.payload));
  assert.equal(confirmed.payload.addedCount, 12);
});

test("Undo takes every added split back off in one write; a settled period refuses it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { freshIds } = await seed(api);
  const added = await api("/api/splits/expenses/add-usual", addBody(freshIds));
  const ids = added.payload.undoSplitExpenseIds;

  // A closed batch locks its records: Undo is refused as a whole.
  const [{ split_batch_id: batchId }] = await rows(db, "SELECT split_batch_id FROM split_expenses WHERE id = ?", ids[0]);
  const stateBefore = await dumpDatabase(db);
  await db.prepare("UPDATE split_batches SET closed_on = '2026-11-01' WHERE id = ?").bind(batchId).run();
  const locked = await api("/api/splits/expenses/remove-added", { splitExpenseIds: ids });
  assert.equal(locked.status, 409, JSON.stringify(locked.payload));
  assert.equal(locked.payload.code, "split_settlement_locked");
  assert.equal(locked.payload.batchId, batchId);
  await db.prepare("UPDATE split_batches SET closed_on = NULL WHERE id = ?").bind(batchId).run();
  assertSameDatabase(await dumpDatabase(db), stateBefore);

  const undone = await api("/api/splits/expenses/remove-added", { splitExpenseIds: ids });
  assert.equal(undone.status, 200, JSON.stringify(undone.payload));
  assert.equal(undone.payload.removedCount, 2);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE id IN (?, ?) AND deleted_at IS NULL", ...ids))[0].n, 0);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'split_expenses_removed_usual'"))[0].n, 1);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);

  const again = await api("/api/splits/expenses/remove-added", { splitExpenseIds: ids });
  assert.equal(again.status, 400);
  assert.match(again.payload.error, /already in activity history/);
  const list = await api("/api/splits/usually-shared");
  assert.equal(list.payload.groups.some((group) => group.shopName === SHOP), true, "the entries are back on the list");
});

test("the routes only answer their own methods and read bodies through the size limit", async (t) => {
  const { fetch } = await openSeededDatabase(t, template);
  assert.equal((await fetch("/api/splits/usually-shared", { method: "POST" })).status, 405);
  assert.equal((await fetch("/api/splits/expenses/add-usual")).status, 405);
  assert.equal((await fetch("/api/splits/expenses/remove-added")).status, 405);
  const big = await fetch("/api/splits/expenses/add-usual", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(200 * 1024) },
    body: JSON.stringify({ groups: [], pad: "x".repeat(200 * 1024) })
  });
  assert.equal(big.status, 413);
});

// --- all or nothing ---------------------------------------------------------

for (const [label, pattern] of [
  ["the second split's shares", /INSERT INTO split_expense_shares/],
  ["the audit event", /INSERT INTO audit_events/],
  ["the month refresh marker", /INSERT INTO monthly_snapshot_refreshes/]
]) {
  test(`Add that fails at ${label} changes nothing`, async (t) => {
    const { db, api } = await openSeededDatabase(t, template);
    const { freshIds } = await seed(api);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern, { skip: pattern.source.includes("shares") ? 2 : 0 });
    const result = await api("/api/splits/expenses/add-usual", addBody(freshIds), { database: faulty.db });
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
    const { freshIds } = await seed(api);
    const added = await api("/api/splits/expenses/add-usual", addBody(freshIds));
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern, { skip });
    const result = await api("/api/splits/expenses/remove-added", { splitExpenseIds: added.payload.undoSplitExpenseIds }, { database: faulty.db });
    assert.equal(faulty.state.fired, true);
    assert.notEqual(result.status, 200);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

test("two Adds of the same entries racing: one wins, the other changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { freshIds } = await seed(api);
  const [first, second] = await Promise.all([
    api("/api/splits/expenses/add-usual", addBody(freshIds)),
    api("/api/splits/expenses/add-usual", addBody(freshIds))
  ]);
  const added = [first, second].reduce((sum, response) => sum + (response.payload.addedCount ?? 0), 0);
  assert.equal(added, 2, JSON.stringify([first.payload, second.payload]));
  for (const entryId of freshIds) {
    assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", entryId))[0].n, 1);
  }
});
