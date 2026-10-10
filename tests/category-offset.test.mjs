// Money in under a spending category (a refund, a friend paying back their
// share) corrects that category's spending instead of counting as income.
// The category decides; there is no per-entry switch. Net is unchanged:
// the money moves from "income" to "less spending".
import assert from "node:assert/strict";
import test from "node:test";

import { isSpendingCategoryName, offsetsCategory, spendingMinor, incomeMinor } from "../src/domain/category-offset.ts";
import { buildDerivedSummaryMonth } from "../src/domain/summary-projection.ts";
import { buildDonutChart } from "../src/domain/donut-chart-projection.ts";
import { sumVisibleExpenseMinor } from "../src/domain/app-repository-helpers.ts";
import { deriveIncomeRowActuals, derivePlanRowActuals } from "../src/domain/month-projection.ts";
import { buildFinancialInsightFacts, buildMonthlyNarrativeFacts } from "../src/domain/ai-assistance-insights.ts";
import { getEntryTotals, getExpenseBreakdown } from "../src/client/entry-totals.js";

const split = (personId, personName, amountMinor, ratioBasisPoints = 10_000) => ({ personId, personName, amountMinor, ratioBasisPoints });

function entry(id, entryType, categoryName, amountMinor, extra = {}) {
  return {
    id, date: "2026-05-10", description: id, accountName: "UOB One", categoryName, entryType,
    ownershipType: "direct", ownerName: "Tim", amountMinor, offsetsCategory: false,
    splits: [split("person-tim", "Tim", amountMinor)], ...extra
  };
}

// Tennis court booked for four ($40), a friend pays back $10; dinner $60; salary $5,000.
const ENTRIES = [
  entry("court", "expense", "Sports & Hobbies", 4_000),
  entry("payback", "income", "Sports & Hobbies", 1_000),
  entry("dinner", "expense", "Food & Drinks", 6_000),
  entry("salary", "income", "Salary", 500_000)
];

test("only income under a spending category offsets it", () => {
  for (const name of ["Sports & Hobbies", "Food & Drinks", "Travel", "Fees", "Shopping", "Gifts", "Insurance"]) {
    assert.equal(isSpendingCategoryName(name), true, name);
  }
  for (const name of ["Income", "Salary", "Extra Income", "Other - Income", "Freelance Income", "Transfer", "Savings", "Investments", "Loans", "Other", "", undefined]) {
    assert.equal(isSpendingCategoryName(name), false, String(name));
  }
  assert.equal(offsetsCategory(entry("a", "income", "Travel", 1)), true);
  assert.equal(offsetsCategory(entry("b", "expense", "Travel", 1)), false);
  assert.equal(offsetsCategory(entry("c", "income", "Other", 1)), false);
  assert.equal(offsetsCategory(entry("d", "transfer", "Travel", 1, { transferDirection: "in" })), false);
  // The old stored switch no longer decides either way.
  assert.equal(offsetsCategory(entry("e", "income", "Salary", 1, { offsetsCategory: true })), false);
});

test("spendingMinor and incomeMinor split each entry's money the same way everywhere", () => {
  assert.deepEqual(ENTRIES.map((item) => [item.id, spendingMinor(item), incomeMinor(item)]), [
    ["court", 4_000, 0],
    ["payback", -1_000, 0],
    ["dinner", 6_000, 0],
    ["salary", 0, 500_000]
  ]);
  assert.equal(spendingMinor(ENTRIES[1], 250), -250, "a person's share is passed in");
});

test("Summary and Month totals: a payback lowers spending, not raises income, and net is unchanged", () => {
  const month = buildDerivedSummaryMonth("2026-05", ENTRIES);
  assert.equal(month.actualIncomeMinor, 500_000);
  assert.equal(month.realExpensesMinor, 9_000);
  assert.equal(month.realizedSavingsMinor, 500_000 + 1_000 - 4_000 - 6_000);
});

test("stored month totals subtract paybacks for the household and for a person's share", () => {
  assert.equal(sumVisibleExpenseMinor(ENTRIES, "household"), 9_000);
  assert.equal(sumVisibleExpenseMinor(ENTRIES, "person-tim"), 9_000);
  assert.equal(sumVisibleExpenseMinor(ENTRIES, "person-joyce"), 0);
});

test("category chart nets paybacks and never shows a category below zero", () => {
  const refundOnly = entry("agoda-refund", "income", "Travel", 172_850);
  const chart = buildDonutChart([...ENTRIES, refundOnly], []);
  assert.deepEqual(chart.map((slice) => [slice.label, slice.valueMinor, slice.entryCount]), [
    ["Food & Drinks", 6_000, 1],
    ["Sports & Hobbies", 3_000, 2]
  ]);
});

test("Month budget bucket and income rows: the payback reduces the bucket and is not income", () => {
  const bucket = { id: "b", section: "budget_buckets", categoryName: "Sports & Hobbies", label: "Sports & Hobbies", plannedMinor: 10_000, actualMinor: 0, ownershipType: "direct", ownerName: "Tim", splits: [] };
  const [row] = derivePlanRowActuals([bucket], ENTRIES, "household");
  assert.equal(row.actualMinor, 3_000);
  assert.deepEqual(row.actualEntryIds.sort(), ["court", "payback"]);

  const incomeRow = { id: "i", categoryName: "Income", label: "Income", plannedMinor: 500_000, actualMinor: 0 };
  const [income] = deriveIncomeRowActuals([incomeRow], ENTRIES, "household");
  assert.equal(income.actualMinor, 500_000);
});

test("Entries page totals and breakdown agree with Summary", () => {
  const totals = getEntryTotals(ENTRIES);
  assert.equal(totals.incomeMinor, 500_000);
  assert.equal(totals.spendMinor, 9_000);
  assert.equal(totals.grossSpendMinor, 9_000, "no person weighting, so no second figure in brackets");
  assert.deepEqual(getExpenseBreakdown(ENTRIES).map((item) => [item.label, item.valueMinor]), [
    ["Food & Drinks", 6_000],
    ["Sports & Hobbies", 3_000]
  ]);
});

test("insight facts count a payback as less spending", () => {
  const facts = buildFinancialInsightFacts({ contextLabel: "May", records: ENTRIES, formatMoney: (minor) => String(minor) });
  assert.deepEqual([facts.spend, facts.income, facts.net, facts.topCategoryName, facts.topCategoryAmount, facts.topMerchantName], ["9000", "500000", "491000", "Food & Drinks", "6000", "dinner"]);
  const narrative = buildMonthlyNarrativeFacts("2026-05", undefined, ENTRIES, (minor) => String(minor));
  assert.equal(narrative.spend, "9000");
  assert.equal(narrative.topCategoryName, "Food & Drinks");
  assert.equal(narrative.topCategoryAmount, "6000");
});

test("income under Other or an income category stays income (negative case)", () => {
  const items = [entry("rebate", "income", "Other - Income", 2_000), entry("unknown", "income", "Other", 3_000), ...ENTRIES];
  const month = buildDerivedSummaryMonth("2026-05", items);
  assert.equal(month.actualIncomeMinor, 505_000);
  assert.equal(month.realExpensesMinor, 9_000);
});
