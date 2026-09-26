// Travel split home amounts: a split recorded in its own currency (JPY) and
// matched to a home-currency (SGD) ledger row keeps its own total and shares,
// but every home-currency projection of that ledger row (the Entries viewer
// share, Month actuals, Summary, the stored person month totals) counts each
// person's share of the SGD ledger amount, never the JPY share amount as if
// it were SGD. The Splits category donut never adds different currencies
// together. Real local D1 (Miniflare) seeded with the demo household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  createSeededTemplate,
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
const DATE = "2026-05-14";
const DESCRIPTION = "TRAVEL HOME AMOUNT TOKYO DINNER";
// SGD 93.01 on the card for a JPY 10,000 (stored in hundredths) dinner.
const SGD_AMOUNT = 9_301;
const JPY_TOTAL = 1_000_000;

async function get(api, pathname) {
  const response = await api(pathname);
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  return response.payload;
}

// A card row imported into Tim's UOB One: a direct Tim expense until matched.
async function importCardRow(api, db, amountMinor = SGD_AMOUNT, description = DESCRIPTION) {
  const csv = [
    "date,description,amount,account,category,note",
    `${DATE},${description},-${(amountMinor / 100).toFixed(2)},UOB One,Food & Drinks,`
  ].join("\n");
  const preview = await api("/api/imports/preview", { sourceLabel: description, sourceType: "csv", csv, ownershipType: "direct", ownerName: "Tim" });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const commit = await api("/api/imports/commit", { sourceLabel: description, sourceType: "csv", parserKey: "generic_csv", rows: preview.payload.preview.previewRows });
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [entry] = await rows(db, "SELECT id, amount_minor, currency FROM transactions WHERE import_id = ?", commit.payload.importId);
  assert.equal(entry.amount_minor, amountMinor);
  assert.equal(entry.currency, "SGD");
  return entry;
}

async function createSplit(api, { currency, amountMinor, splitBasisPoints = 5_000, splitAmountMinor, groupId = null, paymentMethod = "card" }) {
  const created = await api("/api/splits/expenses/create", {
    groupId,
    date: DATE,
    description: "Tokyo dinner",
    categoryName: "Food & Drinks",
    payerPersonName: "Tim",
    amountMinor,
    currency,
    splitBasisPoints,
    splitAmountMinor,
    paymentMethod,
    paymentStatus: paymentMethod === "cash" ? "recorded" : "awaiting_statement"
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.splitExpenseId;
}

async function link(api, splitExpenseId, transactionId) {
  const match = await api("/api/splits/matches/link-expense", { splitExpenseId, transactionId });
  assert.equal(match.status, 200, JSON.stringify(match.payload));
}

async function sharesOf(db, splitExpenseId) {
  return rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", splitExpenseId);
}

function entryIn(page, entryId) {
  const entry = page.monthPage.entries.find((item) => item.id === entryId);
  assert.ok(entry, `entry ${entryId} is on the page`);
  return entry;
}

function totalsByScope(totals) {
  return Object.fromEntries(totals.map((row) => [row.person_scope, row.total_expense_minor]));
}

function monthActual(payload) {
  return payload.summaryPage.months.find((month) => month.month === MONTH)?.realExpensesMinor;
}

// Every home-currency number that counts a person's share of the entry.
async function homeCurrencyReadings(api, db, entryId = null) {
  const readings = {};
  for (const view of ["household", "person-tim", "person-joyce"]) {
    const entries = await get(api, `/api/entries-page?view=${view}&month=${MONTH}`);
    const month = await get(api, `/api/month-page?view=${view}&month=${MONTH}&scope=direct_plus_shared`);
    const summary = await get(api, `/api/summary-page?view=${view}&month=${MONTH}&scope=direct_plus_shared&summary_start=${MONTH}&summary_end=${MONTH}`);
    const monthEntry = month.monthPage.entries.find((item) => item.id === entryId);
    readings[view] = {
      entriesAmountMinor: entries.monthPage.entries.find((item) => item.id === entryId)?.amountMinor ?? null,
      monthAmountMinor: monthEntry?.amountMinor ?? null,
      monthFoodMinor: month.monthPage.categoryShareChart.find((item) => item.label === "Food & Drinks")?.valueMinor ?? 0,
      summaryActualMinor: monthActual(summary),
      summaryFoodMinor: summary.summaryPage.categoryShareChart.find((item) => item.label === "Food & Drinks")?.valueMinor ?? 0
    };
  }
  readings.storedTotals = totalsByScope(await snapshotTotals(db, MONTH));
  return readings;
}

// The stored month totals must be what a full recalculation gives.
async function assertTotalsFresh(db) {
  const stored = await snapshotTotals(db, MONTH);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
  await recalculateMonthlySnapshots(db, MONTH);
  assert.deepEqual(stored, await snapshotTotals(db, MONTH), "stored month totals are stale");
}

// Checks that, against a baseline read before the card row existed, every
// reading counts the entry at exactly the given amount per view: its full
// SGD amount for the household, each person's SGD share for a person.
function assertCountedAt(baseline, after, { household, tim, joyce }) {
  for (const [view, delta] of [["household", household], ["person-tim", tim], ["person-joyce", joyce]]) {
    assert.equal(after[view].monthFoodMinor - baseline[view].monthFoodMinor, delta, `${view} Month Food & Drinks`);
    assert.equal(after[view].summaryActualMinor - baseline[view].summaryActualMinor, delta, `${view} Summary actual`);
    assert.equal(after[view].summaryFoodMinor - baseline[view].summaryFoodMinor, delta, `${view} Summary Food & Drinks`);
    assert.equal(after.storedTotals[view] - baseline.storedTotals[view], delta, `${view} stored month total`);
  }
}

test("a JPY travel split matched to an SGD row counts each person's share of the SGD amount in Entries, Month, Summary and the stored month totals", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  // Start from the stored totals a full recalculation gives, so the
  // differences below come from this entry alone.
  await recalculateMonthlySnapshots(db, MONTH);
  const baseline = await homeCurrencyReadings(api, db);
  const entry = await importCardRow(api, db);
  const before = await homeCurrencyReadings(api, db, entry.id);
  assert.equal(before["person-tim"].entriesAmountMinor, SGD_AMOUNT);
  // The Entries page lists every household entry; before the match the
  // entry is Tim's direct expense at its full amount in any view.
  assert.equal(before["person-joyce"].entriesAmountMinor, SGD_AMOUNT);

  const splitExpenseId = await createSplit(api, { currency: "JPY", amountMinor: JPY_TOTAL });
  await link(api, splitExpenseId, entry.id);

  // The split keeps its own JPY total and shares.
  assert.deepEqual(await sharesOf(db, splitExpenseId), [
    { person_id: "person-joyce", ratio_basis_points: 5_000, amount_minor: 500_000 },
    { person_id: "person-tim", ratio_basis_points: 5_000, amount_minor: 500_000 }
  ]);
  // Each person's share of SGD 93.01: an even split floors the first
  // (owner) share and balances the odd cent to the second.
  const after = await homeCurrencyReadings(api, db, entry.id);
  assert.equal(after.household.entriesAmountMinor, SGD_AMOUNT);
  assert.equal(after["person-tim"].entriesAmountMinor, 4_650);
  assert.equal(after["person-tim"].monthAmountMinor, 4_650);
  assert.equal(after["person-joyce"].entriesAmountMinor, 4_651);
  assert.equal(after["person-joyce"].monthAmountMinor, 4_651);
  const entriesPage = await get(api, `/api/entries-page?view=person-tim&month=${MONTH}`);
  const linked = entryIn(entriesPage, entry.id);
  assert.equal(linked.totalAmountMinor, SGD_AMOUNT);
  assert.equal(linked.viewerSplitRatioBasisPoints, 5_000);
  assert.deepEqual(
    linked.linkedSplitShares.map(({ personId, ratioBasisPoints, amountMinor }) => ({ personId, ratioBasisPoints, amountMinor })).sort((a, b) => a.personId.localeCompare(b.personId)),
    [
      { personId: "person-joyce", ratioBasisPoints: 5_000, amountMinor: 4_651 },
      { personId: "person-tim", ratioBasisPoints: 5_000, amountMinor: 4_650 }
    ]
  );
  assertCountedAt(baseline, after, { household: SGD_AMOUNT, tim: 4_650, joyce: 4_651 });
  await assertTotalsFresh(db);
});

test("an uneven travel split converts by its share ratio and the SGD shares add up to the ledger amount", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  // Start from the stored totals a full recalculation gives, so the
  // differences below come from this entry alone.
  await recalculateMonthlySnapshots(db, MONTH);
  const baseline = await homeCurrencyReadings(api, db);
  const entry = await importCardRow(api, db);

  const splitExpenseId = await createSplit(api, { currency: "JPY", amountMinor: JPY_TOTAL, splitBasisPoints: 7_000 });
  await link(api, splitExpenseId, entry.id);

  assert.deepEqual((await sharesOf(db, splitExpenseId)).map((share) => share.amount_minor), [300_000, 700_000]);
  // 70% of 93.01 is 65.107: Tim 65.10, Joyce the balance 27.91.
  const after = await homeCurrencyReadings(api, db, entry.id);
  assert.equal(after["person-tim"].entriesAmountMinor, 6_510);
  assert.equal(after["person-joyce"].entriesAmountMinor, 2_791);
  assert.equal(after["person-tim"].entriesAmountMinor + after["person-joyce"].entriesAmountMinor, SGD_AMOUNT);
  assertCountedAt(baseline, after, { household: SGD_AMOUNT, tim: 6_510, joyce: 2_791 });
  await assertTotalsFresh(db);

  // A Shared owner save at a new SGD amount keeps the JPY shares and moves
  // the SGD shares with the ledger amount.
  const [row] = await rows(db, "SELECT transaction_date, description FROM transactions WHERE id = ?", entry.id);
  const save = await api("/api/entries/update", {
    entryId: entry.id,
    date: row.transaction_date,
    description: row.description,
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    amountMinor: 10_000,
    entryType: "expense",
    ownershipType: "shared",
    splitBasisPoints: 7_000,
    note: ""
  });
  assert.equal(save.status, 200, JSON.stringify(save.payload));
  assert.deepEqual((await sharesOf(db, splitExpenseId)).map((share) => share.amount_minor), [300_000, 700_000]);
  const saved = await homeCurrencyReadings(api, db, entry.id);
  assert.equal(saved["person-tim"].entriesAmountMinor, 7_000);
  assert.equal(saved["person-joyce"].entriesAmountMinor, 3_000);
  assertCountedAt(baseline, saved, { household: 10_000, tim: 7_000, joyce: 3_000 });
  await assertTotalsFresh(db);
});

test("a same-currency SGD split keeps its stored share amounts exactly, including an odd cent the formula would place elsewhere", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entry = await importCardRow(api, db, 10_001, "TRAVEL HOME AMOUNT SGD DINNER");
  const splitExpenseId = await createSplit(api, { currency: "SGD", amountMinor: 10_001 });
  await link(api, splitExpenseId, entry.id);
  // Give Tim the odd cent (the balancing rule would give it to Joyce), as the
  // split editor can when matching an external split record.
  await db.prepare("UPDATE split_expense_shares SET amount_minor = CASE person_id WHEN 'person-tim' THEN 5001 ELSE 5000 END WHERE split_expense_id = ?").bind(splitExpenseId).run();
  await recalculateMonthlySnapshots(db, MONTH);

  const tim = entryIn(await get(api, `/api/entries-page?view=person-tim&month=${MONTH}`), entry.id);
  const joyce = entryIn(await get(api, `/api/entries-page?view=person-joyce&month=${MONTH}`), entry.id);
  assert.equal(tim.amountMinor, 5_001);
  assert.equal(joyce.amountMinor, 5_000);
});

test("the Splits category donut never adds a JPY expense to the SGD chart; JPY open expenses chart on their own in JPY", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const splitsPage = (view) => get(api, `/api/splits-page?view=${view}&month=${MONTH}`);
  const before = await splitsPage("person-tim");
  const beforeHousehold = await splitsPage("household");
  assert.equal(before.splitsPage.donutChartsByCurrency, undefined);

  const created = await api("/api/splits/groups/create", { name: "Tokyo trip", currency: "JPY" });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const groupId = created.payload.groupId;
  await createSplit(api, { currency: "JPY", amountMinor: JPY_TOTAL, groupId, paymentMethod: "cash" });
  await createSplit(api, { currency: "JPY", amountMinor: 250_000, splitBasisPoints: 6_000, groupId, paymentMethod: "cash" });

  const after = await splitsPage("person-tim");
  const afterHousehold = await splitsPage("household");
  // The SGD donut is unchanged: no yen counted as dollars.
  assert.deepEqual(after.splitsPage.donutChart, before.splitsPage.donutChart);
  assert.deepEqual(afterHousehold.splitsPage.donutChart, beforeHousehold.splitsPage.donutChart);
  const [food] = await rows(db, "SELECT id FROM categories WHERE name = 'Food & Drinks'");
  // Tim paid both: he is owed Joyce's shares, ¥5,000 and ¥1,000.
  assert.deepEqual(after.splitsPage.donutChartsByCurrency, {
    JPY: [{ key: "Food & Drinks", categoryId: food.id, label: "Food & Drinks", valueMinor: 600_000, entryCount: 2 }]
  });
  assert.deepEqual(afterHousehold.splitsPage.donutChartsByCurrency, {
    JPY: [{ key: "Food & Drinks", categoryId: food.id, label: "Food & Drinks", valueMinor: 1_250_000, entryCount: 2 }]
  });
});
