// Person view totals: in a person view, Summary months, the Month "Actual
// spend" card and the stored person month totals all count that person's own
// spend: their direct entries at the full amount plus their share of each
// split-linked entry. The scope narrows it (Direct ownership: direct entries
// only; Shared: split shares only; Direct + Shared: both). The household view
// counts every entry at its full amount whatever the scope. A person whose
// only activity in a month is split shares still gets a stored month total.
// Real local D1 (Miniflare) seeded with the demo household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  createEntry,
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

const VIEWS = ["household", "person-tim", "person-joyce"];
const SCOPES = ["direct", "shared", "direct_plus_shared"];

async function get(api, pathname) {
  const response = await api(pathname);
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  return response.payload;
}

function chartMinor(chart, label) {
  return chart.find((item) => item.label === label)?.valueMinor ?? 0;
}

// What Summary and Month show for one view, scope and month.
async function readView(api, view, scope, month) {
  const summary = await get(api, `/api/summary-page?view=${view}&month=${month}&scope=${scope}&summary_start=${month}&summary_end=${month}`);
  const monthPage = await get(api, `/api/month-page?view=${view}&month=${month}&scope=${scope}`);
  const summaryMonth = summary.summaryPage.months.find((item) => item.month === month);
  assert.ok(summaryMonth, `${view} ${scope}: Summary has ${month}`);
  return {
    summarySpend: summaryMonth.realExpensesMinor,
    summaryIncome: summaryMonth.actualIncomeMinor,
    summarySpendCard: summary.summaryPage.metricCards.find((card) => card.label === "Actual spend").amountMinor,
    summaryGroceries: chartMinor(summary.summaryPage.categoryShareChart, "Groceries"),
    summaryShopping: chartMinor(summary.summaryPage.categoryShareChart, "Shopping"),
    monthSpendCard: monthPage.monthPage.metricCards.find((card) => card.label === "Actual spend").amountMinor,
    monthSummarySpend: monthPage.summaryPage.months[0].realExpensesMinor
  };
}

function storedSpendByScope(totals) {
  return Object.fromEntries(totals.map((row) => [row.person_scope, row.total_expense_minor]));
}

// The stored month totals must be what a full recalculation gives, and no
// refresh may be left pending: the write's own refresh wrote them.
async function assertTotalsFresh(db, month) {
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), []);
  const stored = await snapshotTotals(db, month);
  await recalculateMonthlySnapshots(db, month);
  assert.deepEqual(await snapshotTotals(db, month), stored, "stored month totals are stale");
}

async function sharesOf(db, entryId) {
  return rows(db, `
    SELECT split_expense_shares.person_id, split_expense_shares.amount_minor
    FROM split_expense_shares
    INNER JOIN split_expenses ON split_expenses.id = split_expense_shares.split_expense_id
    WHERE split_expenses.linked_transaction_id = ? AND split_expenses.deleted_at IS NULL
    ORDER BY split_expense_shares.person_id
  `, entryId);
}

// A Tim-paid UOB One expense shared 25% Tim / 75% Joyce through a linked
// split, written the way a Shared owner entry save writes it.
async function createSharedEntry(api, db, { date, amountMinor }) {
  const entryId = await createEntry(api, {
    date,
    description: `Person totals shared ${date}`,
    amountMinor,
    ownershipType: "shared",
    splitBasisPoints: 2_500
  });
  assert.deepEqual(await sharesOf(db, entryId), [
    { person_id: "person-joyce", amount_minor: amountMinor * 0.75 },
    { person_id: "person-tim", amount_minor: amountMinor * 0.25 }
  ]);
  return entryId;
}

test("the seeded May: a person view's Summary month and Month actual spend equal that person's stored month total, the household view is unchanged", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const month = "2026-05";
  await recalculateMonthlySnapshots(db, month);
  // The seed's May has no split-linked entries, so Direct ownership and
  // Direct + Shared agree and Shared is empty.
  assert.deepEqual(storedSpendByScope(await snapshotTotals(db, month)), {
    household: 559_666,
    "person-joyce": 122_499,
    "person-tim": 437_167
  });
  const expected = {
    household: { direct: 559_666, shared: 559_666, direct_plus_shared: 559_666 },
    "person-tim": { direct: 437_167, shared: 0, direct_plus_shared: 437_167 },
    "person-joyce": { direct: 122_499, shared: 0, direct_plus_shared: 122_499 }
  };
  for (const view of VIEWS) {
    for (const scope of SCOPES) {
      const reading = await readView(api, view, scope, month);
      const want = expected[view][scope];
      assert.equal(reading.summarySpend, want, `${view} ${scope} Summary month`);
      assert.equal(reading.summarySpendCard, want, `${view} ${scope} Summary Actual spend card`);
      assert.equal(reading.monthSpendCard, want, `${view} ${scope} Month Actual spend card`);
      assert.equal(reading.monthSummarySpend, want, `${view} ${scope} Month summary month`);
    }
  }
});

test("direct entries, a split-linked entry and income count per person and scope the same way on Summary, Month and the stored month totals", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const month = "2026-07";
  await createEntry(api, { date: "2026-07-03", description: "Person totals Tim groceries", amountMinor: 10_000 });
  await createEntry(api, { date: "2026-07-04", description: "Person totals Joyce shopping", amountMinor: 3_000, accountName: "UOB Lady's", categoryName: "Shopping", ownerName: "Joyce" });
  await createEntry(api, { date: "2026-07-05", description: "Person totals Tim salary", amountMinor: 50_000, entryType: "income", categoryName: "Salary" });
  await createSharedEntry(api, db, { date: "2026-07-06", amountMinor: 8_000 });

  // Household: every entry at its full amount. Tim: 10,000 direct plus his
  // 2,000 share. Joyce: 3,000 direct plus her 6,000 share.
  assert.deepEqual(storedSpendByScope(await snapshotTotals(db, month)), {
    household: 21_000,
    "person-joyce": 9_000,
    "person-tim": 12_000
  });
  await assertTotalsFresh(db, month);

  const expected = {
    household: {
      direct: { spend: 21_000, income: 50_000, groceries: 18_000, shopping: 3_000 },
      shared: { spend: 21_000, income: 50_000, groceries: 18_000, shopping: 3_000 },
      direct_plus_shared: { spend: 21_000, income: 50_000, groceries: 18_000, shopping: 3_000 }
    },
    "person-tim": {
      direct: { spend: 10_000, income: 50_000, groceries: 10_000, shopping: 0 },
      shared: { spend: 2_000, income: 0, groceries: 2_000, shopping: 0 },
      direct_plus_shared: { spend: 12_000, income: 50_000, groceries: 12_000, shopping: 0 }
    },
    "person-joyce": {
      direct: { spend: 3_000, income: 0, groceries: 0, shopping: 3_000 },
      shared: { spend: 6_000, income: 0, groceries: 6_000, shopping: 0 },
      direct_plus_shared: { spend: 9_000, income: 0, groceries: 6_000, shopping: 3_000 }
    }
  };
  for (const view of VIEWS) {
    for (const scope of SCOPES) {
      const reading = await readView(api, view, scope, month);
      const want = expected[view][scope];
      assert.deepEqual(
        {
          summarySpend: reading.summarySpend,
          summarySpendCard: reading.summarySpendCard,
          monthSpendCard: reading.monthSpendCard,
          monthSummarySpend: reading.monthSummarySpend,
          summaryIncome: reading.summaryIncome,
          summaryGroceries: reading.summaryGroceries,
          summaryShopping: reading.summaryShopping
        },
        {
          summarySpend: want.spend,
          summarySpendCard: want.spend,
          monthSpendCard: want.spend,
          monthSummarySpend: want.spend,
          summaryIncome: want.income,
          summaryGroceries: want.groceries,
          summaryShopping: want.shopping
        },
        `${view} ${scope}`
      );
    }
  }
  // The expectations above add up per person (Direct ownership plus Shared
  // is Direct + Shared), and the two people's stored totals add up to the
  // household's because every entry here belongs to one of them.
  const stored = storedSpendByScope(await snapshotTotals(db, month));
  assert.equal(stored["person-tim"] + stored["person-joyce"], stored.household);
});
