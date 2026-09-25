// Split-linked entry amount edits: when a ledger entry that is linked to a
// split expense changes amount, the split expense total and its shares follow
// the new amount by the split's stored basis, in the entry's own batch. Runs
// against a real local D1 (Miniflare) seeded with the demo household.
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

// A Tim expense on UOB One, added to splits (50/50 by default).
async function createLinkedEntry(api, { description, amountMinor }) {
  const entryId = await createEntry(api, { date: DATE, description, amountMinor });
  const split = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  return { entryId, splitExpenseId: split.payload.splitExpenseId };
}

async function setSplitShare(api, { splitExpenseId, description, amountMinor, splitBasisPoints, splitAmountMinor }) {
  const update = await api("/api/splits/expenses/update", {
    splitExpenseId,
    groupId: null,
    date: DATE,
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor,
    splitBasisPoints,
    splitAmountMinor,
    homeAmountMinor: amountMinor,
    paymentMethod: "bank",
    paymentStatus: "certified"
  });
  assert.equal(update.status, 200, JSON.stringify(update.payload));
}

// The payload the Entries editor sends in a person view: every loaded entry
// is a direct entry, so a linked entry is saved as ownershipType "direct".
function entryEdit(entryId, { description, amountMinor }) {
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
    note: ""
  };
}

async function splitState(db, splitExpenseId) {
  const [expense] = await rows(db, "SELECT total_amount_minor, home_amount_minor, fx_rate_basis_points FROM split_expenses WHERE id = ?", splitExpenseId);
  const shares = await rows(db, `
    SELECT people.display_name AS person, split_expense_shares.ratio_basis_points AS ratio, split_expense_shares.amount_minor AS amount
    FROM split_expense_shares INNER JOIN people ON people.id = split_expense_shares.person_id
    WHERE split_expense_id = ?
    ORDER BY people.display_name
  `, splitExpenseId);
  return { expense, shares };
}

// Tim's open balance for non-group expenses as the Splits page shows it.
async function nonGroupBalance(api) {
  const splitsPage = await api(`/api/splits-page?view=person-tim&month=${MONTH}`);
  assert.equal(splitsPage.status, 200);
  return splitsPage.payload.splitsPage.groups.find((group) => group.id === "split-group-none").balanceMinor;
}

function scopeTotals(totals, scope) {
  return totals.find((row) => row.person_scope === scope);
}

test("editing a linked entry's amount in a person view moves the split total and shares by the stored ratio", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Linked quarter share";
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description, amountMinor: 6_000 });
  await setSplitShare(api, { splitExpenseId, description, amountMinor: 6_000, splitBasisPoints: 2_500 });
  assert.deepEqual((await splitState(db, splitExpenseId)).shares, [
    { person: "Joyce", ratio: 7_500, amount: 4_500 },
    { person: "Tim", ratio: 2_500, amount: 1_500 }
  ]);
  // Split workspace edits do not refresh month totals, so start from a
  // recalculated baseline where Tim's share is 15.00.
  await recalculateMonthlySnapshots(db, MONTH);
  const timBefore = scopeTotals(await snapshotTotals(db, MONTH), "person-tim");
  const balanceBefore = await nonGroupBalance(api);

  const update = await api("/api/entries/update", entryEdit(entryId, { description, amountMinor: 8_050 }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual(await rows(db, "SELECT amount_minor FROM transactions WHERE id = ?", entryId), [{ amount_minor: 8_050 }]);
  // 25% of 80.50 is 20.125: Tim keeps the floor, Joyce the remainder.
  assert.deepEqual(await splitState(db, splitExpenseId), {
    expense: { total_amount_minor: 8_050, home_amount_minor: 8_050, fx_rate_basis_points: null },
    shares: [
      { person: "Joyce", ratio: 7_500, amount: 6_038 },
      { person: "Tim", ratio: 2_500, amount: 2_012 }
    ]
  });

  // Every projection that shows Tim's share reads the new amount.
  const entriesPage = await api(`/api/entries-page?view=person-tim&month=${MONTH}`);
  assert.equal(entriesPage.status, 200);
  const timRow = entriesPage.payload.monthPage.entries.find((entry) => entry.id === entryId);
  assert.equal(timRow.amountMinor, 2_012);
  assert.equal(timRow.totalAmountMinor, 8_050);
  assert.equal(timRow.viewerSplitRatioBasisPoints, 2_500);

  const splitsPage = await api(`/api/splits-page?view=person-tim&month=${MONTH}`);
  assert.equal(splitsPage.status, 200);
  const activity = splitsPage.payload.splitsPage.activity.find((item) => item.id === splitExpenseId);
  assert.equal(activity.totalAmountMinor, 8_050);
  assert.equal(activity.viewerAmountMinor, 6_038);
  assert.deepEqual(activity.shares.map((share) => [share.personName, share.amountMinor]).sort(), [["Joyce", 6_038], ["Tim", 2_012]]);
  // Tim paid, so Joyce owes him her share: 60.38 now instead of 45.00.
  assert.equal(await nonGroupBalance(api) - balanceBefore, 6_038 - 4_500);

  // Month totals for Tim use his share, refreshed after the same write.
  const totalsAfterWrite = await snapshotTotals(db, MONTH);
  assert.equal(scopeTotals(totalsAfterWrite, "person-tim").total_expense_minor - timBefore.total_expense_minor, 2_012 - 1_500);
  await recalculateMonthlySnapshots(db, MONTH);
  assert.deepEqual(await snapshotTotals(db, MONTH), totalsAfterWrite);
});

test("an even split stays even when the amount changes, whichever person had the odd cent", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const defaultSplit = await createLinkedEntry(api, { description: "Linked even default", amountMinor: 4_065 });
  const assignedSplit = await createLinkedEntry(api, { description: "Linked even assigned", amountMinor: 4_065 });
  // The editor's "Tim gets +$0.01" choice is an exact share amount.
  await setSplitShare(api, { splitExpenseId: assignedSplit.splitExpenseId, description: "Linked even assigned", amountMinor: 4_065, splitBasisPoints: 5_001, splitAmountMinor: 2_033 });
  assert.deepEqual((await splitState(db, defaultSplit.splitExpenseId)).shares, [
    { person: "Joyce", ratio: 5_001, amount: 2_033 },
    { person: "Tim", ratio: 4_999, amount: 2_032 }
  ]);
  assert.deepEqual((await splitState(db, assignedSplit.splitExpenseId)).shares, [
    { person: "Joyce", ratio: 4_999, amount: 2_032 },
    { person: "Tim", ratio: 5_001, amount: 2_033 }
  ]);

  for (const { entryId, description } of [
    { entryId: defaultSplit.entryId, description: "Linked even default" },
    { entryId: assignedSplit.entryId, description: "Linked even assigned" }
  ]) {
    const update = await api("/api/entries/update", entryEdit(entryId, { description, amountMinor: 8_051 }));
    assert.equal(update.status, 200, JSON.stringify(update.payload));
  }

  // 50% of 80.51: the deterministic remainder gives the odd cent to Joyce.
  const evenShares = [
    { person: "Joyce", ratio: 5_000, amount: 4_026 },
    { person: "Tim", ratio: 5_000, amount: 4_025 }
  ];
  assert.deepEqual((await splitState(db, defaultSplit.splitExpenseId)).shares, evenShares);
  assert.deepEqual((await splitState(db, assignedSplit.splitExpenseId)).shares, evenShares);
});

test("an exact-amount share becomes the same proportion of the new amount", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Linked exact share";
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description, amountMinor: 6_000 });
  await setSplitShare(api, { splitExpenseId, description, amountMinor: 6_000, splitAmountMinor: 2_000 });
  assert.deepEqual((await splitState(db, splitExpenseId)).shares, [
    { person: "Joyce", ratio: 6_667, amount: 4_000 },
    { person: "Tim", ratio: 3_333, amount: 2_000 }
  ]);

  const update = await api("/api/entries/update", entryEdit(entryId, { description, amountMinor: 9_000 }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  // The stored ratio (33.33%) carries over; Tim's share is not left at $20.
  assert.deepEqual((await splitState(db, splitExpenseId)).shares, [
    { person: "Joyce", ratio: 6_667, amount: 6_001 },
    { person: "Tim", ratio: 3_333, amount: 2_999 }
  ]);
});

test("an entry edit that keeps the amount leaves an assigned odd cent alone", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Linked odd cent kept";
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description, amountMinor: 4_065 });
  await setSplitShare(api, { splitExpenseId, description, amountMinor: 4_065, splitBasisPoints: 5_001, splitAmountMinor: 2_033 });
  const before = await splitState(db, splitExpenseId);

  const update = await api("/api/entries/update", entryEdit(entryId, { description: "Linked odd cent renamed", amountMinor: 4_065 }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual(await splitState(db, splitExpenseId), before);
});

test("a household view edit of a linked entry moves the split the same way", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Linked household edit";
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description, amountMinor: 6_000 });

  // The household editor sends the same direct payload with the total.
  const update = await api("/api/entries/update", entryEdit(entryId, { description, amountMinor: 7_001 }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual(await splitState(db, splitExpenseId), {
    expense: { total_amount_minor: 7_001, home_amount_minor: 7_001, fx_rate_basis_points: null },
    shares: [
      { person: "Joyce", ratio: 5_000, amount: 3_501 },
      { person: "Tim", ratio: 5_000, amount: 3_500 }
    ]
  });
  const householdPage = await api(`/api/entries-page?view=household&month=${MONTH}`);
  const householdRow = householdPage.payload.monthPage.entries.find((entry) => entry.id === entryId);
  assert.equal(householdRow.amountMinor, 7_001);
});

test("a cross-currency linked split keeps its own total and shares and updates only the home amount", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Linked travel split";
  const { entryId, splitExpenseId } = await createLinkedEntry(api, { description, amountMinor: 9_000 });
  // A JPY 10,000 split linked to an SGD 90.00 card row (as a statement match leaves it).
  await db.batch([
    db.prepare("UPDATE split_expenses SET currency = 'JPY', total_amount_minor = 10000, home_amount_minor = 9000, fx_rate_basis_points = 9000 WHERE id = ?").bind(splitExpenseId),
    db.prepare("UPDATE split_expense_shares SET amount_minor = 5000 WHERE split_expense_id = ?").bind(splitExpenseId)
  ]);
  const before = await splitState(db, splitExpenseId);

  const update = await api("/api/entries/update", entryEdit(entryId, { description, amountMinor: 9_300 }));

  assert.equal(update.status, 200, JSON.stringify(update.payload));
  const after = await splitState(db, splitExpenseId);
  assert.deepEqual(after.shares, before.shares);
  assert.deepEqual(after.expense, { total_amount_minor: 10_000, home_amount_minor: 9_300, fx_rate_basis_points: 9_300 });
});

test("a linked entry amount edit that fails while moving the split shares changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const description = "Linked atomic edit";
  const { entryId } = await createLinkedEntry(api, { description, amountMinor: 6_000 });
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE split_expense_shares/);

  const update = await api("/api/entries/update", entryEdit(entryId, { description, amountMinor: 8_050 }), { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(update.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});
