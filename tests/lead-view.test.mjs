import assert from "node:assert/strict";
import test from "node:test";

import { LEAD_VIEW_STORAGE_KEY, chooseLeadView, readLeadView, saveLeadView } from "../src/client/lead-view.js";
import { buildMonthMetricCards } from "../src/client/month-helpers.js";
import { buildMonthLeadModel } from "../src/client/month-lead-model.js";
import { buildSavingsBarModel } from "../src/client/savings-bar-model.js";
import { buildEarnedSpentMonths } from "../src/client/summary-earned-spent-model.js";
import { buildSummaryLeadModel } from "../src/client/summary-lead-model.js";

// The lead's Plan | Simple views (lead-view.js, design.md "Plan or Simple"):
// Simple shows earned and spent with no plan, from the same split as Plan,
// so the two never disagree. Without a remembered choice a period with a
// plan opens in Plan and one with none in Simple; the choice wins once made.

function summaryCards({ plannedIncome = 0, actualIncome = 650_000, plannedSpend = 0, actualSpend = 420_000, savingsTarget = 0, realizedSavings = 230_000 } = {}) {
  return [
    { label: "Planned income", amountMinor: plannedIncome, tone: "plan" },
    { label: "Actual income", amountMinor: actualIncome, tone: "in" },
    { label: "Planned spend", amountMinor: plannedSpend, tone: "plan" },
    { label: "Actual spend", amountMinor: actualSpend, tone: "neutral" },
    { label: "Savings target", amountMinor: savingsTarget, tone: "plan" },
    { label: "Realized savings", amountMinor: realizedSavings, tone: "in" }
  ];
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    values
  };
}

const blockedStorage = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("QuotaExceededError"); }
};

test("Simple's earned and spent are Plan's income and spend, and kept is Plan's Saved", () => {
  const model = buildSummaryLeadModel([
    ...summaryCards({ plannedIncome: 600_000, plannedSpend: 500_000, savingsTarget: 180_000, actualSpend: 470_000, realizedSavings: 180_000 }),
    { label: "Planned investments", amountMinor: 20_000, tone: "plan" }
  ], {
    categoryShare: [
      { key: "Food", label: "Food", valueMinor: 400_000 },
      { key: "Investments", label: "Investments", valueMinor: 30_000 },
      { key: "Savings", label: "Savings", valueMinor: 40_000 }
    ],
    investmentMoves: { intoMinor: 10_000, outOfMinor: 0 }
  });
  // $4,700 spent, $300 filed under Investments and $400 under Savings: $4,000
  // of spending, $400 invested (with the $100 transfer), $2,100 kept.
  assert.deepEqual(model.simple, {
    earned: { amountMinor: 650_000, tone: "in" },
    spent: { amountMinor: 400_000, tone: "neutral" }
  });
  assert.equal(model.simple.earned.amountMinor, model.income.amountMinor);
  assert.equal(model.simple.spent.amountMinor, model.spent.amountMinor);
  assert.equal(model.figures.invested, 40_000);
  assert.equal(model.figures.kept, 210_000);
  assert.equal(model.saved.amountMinor, model.figures.kept);
  assert.equal(model.hasPlan, true);
});

test("Simple's spent is rose only when more went out than came in, with no plan to be over", () => {
  const over = buildSummaryLeadModel(summaryCards({ actualIncome: 300_000, actualSpend: 420_000, realizedSavings: -120_000 }));
  assert.deepEqual(over.simple.spent, { amountMinor: 420_000, tone: "short" });
  // Plan's own tone is unchanged: with no plan, any spend is over it.
  assert.equal(over.spent.tone, "short");
  const nothingEarned = buildSummaryLeadModel(summaryCards({ actualIncome: 0, actualSpend: 0, realizedSavings: 0 }));
  assert.deepEqual(nothingEarned.simple, { earned: { amountMinor: 0, tone: "neutral" }, spent: { amountMinor: 0, tone: "neutral" } });
});

test("a period has a plan when any planned figure is above zero, and none when every one is zero", () => {
  assert.equal(buildSummaryLeadModel(summaryCards()).hasPlan, false);
  assert.equal(buildSummaryLeadModel(summaryCards({ plannedIncome: 1 })).hasPlan, true);
  assert.equal(buildSummaryLeadModel(summaryCards({ plannedSpend: 1 })).hasPlan, true);
  assert.equal(buildSummaryLeadModel(summaryCards({ savingsTarget: 1 })).hasPlan, true);
  assert.equal(buildSummaryLeadModel([...summaryCards(), { label: "Planned investments", amountMinor: 1, tone: "plan" }]).hasPlan, true);
});

test("a month with plan lines has a plan even at zero; a month with none has no plan", () => {
  const withRows = { incomeRows: [], planSections: [{ rows: [{ label: "Food", plannedMinor: 0, actualMinor: 0 }] }], currentMonthSummary: { realExpensesMinor: 50_000 } };
  const withoutRows = { incomeRows: [], planSections: [{ rows: [] }], currentMonthSummary: { realExpensesMinor: 50_000 } };
  const rollup = { actualIncomeMinor: 80_000, realizedSavingsMinor: 30_000 };
  const planned = buildMonthLeadModel(buildMonthMetricCards(withRows), rollup, { planRows: withRows.planSections[0].rows });
  const unplanned = buildMonthLeadModel(buildMonthMetricCards(withoutRows), rollup, { planRows: [] });
  assert.equal(planned.hasPlan, true);
  assert.equal(unplanned.hasPlan, false);
  assert.deepEqual(unplanned.simple, { earned: { amountMinor: 80_000, tone: "in" }, spent: { amountMinor: 50_000, tone: "neutral" } });
});

test("the default is Plan with a plan and Simple without; a remembered choice wins either way", () => {
  assert.equal(chooseLeadView(null, true), "plan");
  assert.equal(chooseLeadView(null, false), "simple");
  // Still loading: Plan, as before, so the page does not swap when the figures arrive.
  assert.equal(chooseLeadView(null, null), "plan");
  assert.equal(chooseLeadView("simple", true), "simple");
  assert.equal(chooseLeadView("plan", false), "plan");
});

test("the choice is remembered on the device, and junk or blocked storage falls back to the default", () => {
  const storage = memoryStorage();
  assert.equal(readLeadView(storage), null);
  saveLeadView("simple", storage);
  assert.equal(storage.values.get(LEAD_VIEW_STORAGE_KEY), "simple");
  assert.equal(readLeadView(storage), "simple");
  assert.equal(readLeadView(memoryStorage({ [LEAD_VIEW_STORAGE_KEY]: "fancy" })), null);
  assert.equal(readLeadView(blockedStorage), null);
  assert.doesNotThrow(() => saveLeadView("plan", blockedStorage));
  assert.equal(readLeadView(undefined), null);
});

test("Simple's savings bar is Plan's bar without the plan bar or the plan in the legend", () => {
  const figures = { income: 650_000, spending: 400_000, invested: 40_000, takenFromInvestments: 0, movedToSavings: 40_000, kept: 210_000, spendPlan: 300_000, savePlan: 180_000, investPlan: 20_000 };
  const plan = buildSavingsBarModel({ figures });
  const simple = buildSavingsBarModel({ figures, withPlan: false });
  assert.notEqual(plan.plan, null);
  assert.match(plan.planLegend, /^Plan: spend/);
  assert.equal(simple.plan, null);
  assert.equal(simple.planLegend, null);
  // Everything else, the parts, their shares and the sentence, is the same.
  assert.deepEqual(simple.segments, plan.segments);
  assert.equal(simple.sentence, "You kept $2,100 and invested $400 of the $6,500 you earned");
  assert.equal(simple.sentence, plan.sentence);
  // Hidden money: no amounts either way.
  const hidden = buildSavingsBarModel({ figures, hidden: true, withPlan: false });
  assert.ok(hidden.segments.every((segment) => segment.legend.amount === null));
});

const summaryMonths = [
  { month: "2026-04", plannedIncomeMinor: 0, actualIncomeMinor: 500_000, estimatedExpensesMinor: 0, realExpensesMinor: 620_000, savingsGoalMinor: 0, realizedSavingsMinor: -120_000, estimatedDiffMinor: 0, realDiffMinor: 0, note: "" },
  { month: "2026-05", plannedIncomeMinor: 0, actualIncomeMinor: 650_000, estimatedExpensesMinor: 0, realExpensesMinor: 470_000, savingsGoalMinor: 0, realizedSavingsMinor: 180_000, estimatedDiffMinor: 0, realDiffMinor: 0, note: "" },
  { month: "2026-03", plannedIncomeMinor: 0, actualIncomeMinor: 0, estimatedExpensesMinor: 0, realExpensesMinor: 0, savingsGoalMinor: 0, realizedSavingsMinor: 0, estimatedDiffMinor: 0, realDiffMinor: 0, note: "" }
];
const shareByMonth = [
  { month: "2026-05", data: [{ key: "Food", label: "Food", valueMinor: 400_000 }, { key: "Investments", label: "Investments", valueMinor: 30_000 }, { key: "Savings", label: "Savings", valueMinor: 40_000 }] },
  { month: "2026-04", data: [{ key: "Food", label: "Food", valueMinor: 620_000 }] }
];

test("Earned vs spent by month: newest first, each month through the same split as the lead", () => {
  const rows = buildEarnedSpentMonths(summaryMonths, shareByMonth);
  assert.deepEqual(rows.map((row) => row.month), ["2026-05", "2026-04", "2026-03"]);
  assert.deepEqual(rows[0], {
    month: "2026-05",
    earnedMinor: 650_000,
    spentMinor: 400_000,
    investedMinor: 30_000,
    keptMinor: 220_000,
    isOver: false,
    spentPercent: 62,
    bar: [
      { key: "spent", tone: "short", widthPercent: 61.5 },
      { key: "invested", tone: "in", widthPercent: 4.6 },
      { key: "kept", tone: "in", widthPercent: 33.8 }
    ]
  });
  // The month's spend is the Month lead's spend for the same month.
  const monthLead = buildSummaryLeadModel(summaryCards({ actualIncome: 650_000, actualSpend: 470_000 }), { categoryShare: shareByMonth[0].data });
  assert.equal(rows[0].spentMinor, monthLead.simple.spent.amountMinor);
  assert.equal(rows[0].earnedMinor, monthLead.simple.earned.amountMinor);
});

test("an overspent month: rose spent to the income, then the part from savings, no kept part", () => {
  const april = buildEarnedSpentMonths(summaryMonths, shareByMonth)[1];
  assert.equal(april.isOver, true);
  assert.equal(april.keptMinor, -120_000);
  assert.equal(april.spentPercent, 124);
  assert.deepEqual(april.bar, [
    { key: "spent", tone: "short", widthPercent: 80.6 },
    { key: "savings", tone: "short", widthPercent: 19.4, hatched: true }
  ]);
});

test("a month with nothing earned or spent has no bar and no share; a month without a category share counts it all as spent", () => {
  const march = buildEarnedSpentMonths(summaryMonths, shareByMonth)[2];
  assert.deepEqual(march.bar, []);
  assert.equal(march.spentPercent, null);
  assert.equal(march.isOver, false);
  const [noShare] = buildEarnedSpentMonths([summaryMonths[1]], []);
  assert.equal(noShare.spentMinor, 470_000);
  assert.equal(noShare.investedMinor, 0);
  assert.deepEqual(buildEarnedSpentMonths([], []), []);
});
