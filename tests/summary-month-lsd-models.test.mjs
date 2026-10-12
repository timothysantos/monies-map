import assert from "node:assert/strict";
import test from "node:test";

import { buildMonthMetricCards } from "../src/client/month-helpers.js";
import { buildMonthLeadModel } from "../src/client/month-lead-model.js";
import { buildIntentMonthCard } from "../src/client/summary-intent-outcome-model.js";

// The Month top and Summary's Intent vs Outcome cards (design.md, "Lead ·
// Support · Detail") read every figure from what the page already had: the
// Month metric cards and the month's Summary rollup, and the Summary month
// DTO. These pin the figures and tones, and the paths that must stay empty.

function monthCards({ plannedIncome = 600_000, planned = 500_000, actual = 420_000, savings = 180_000 } = {}) {
  return buildMonthMetricCards({
    incomeRows: [{ plannedMinor: plannedIncome }],
    planSections: [{ rows: [
      { label: "Savings", plannedMinor: savings, actualMinor: 0 },
      { label: "Food", plannedMinor: planned - savings, actualMinor: 0 }
    ] }],
    currentMonthSummary: { realExpensesMinor: actual }
  });
}

test("Month lead: the cards' spend, plan, target and remaining budget, with income and savings from the month rollup", () => {
  const model = buildMonthLeadModel(monthCards(), { actualIncomeMinor: 650_000, realizedSavingsMinor: 230_000 });
  assert.deepEqual(model, {
    spent: { amountMinor: 420_000, tone: "neutral" },
    plannedSpendMinor: 500_000,
    percentOfPlan: 84,
    headroom: { amountMinor: 80_000, isOver: false, tone: "in" },
    income: { amountMinor: 650_000, tone: "in", planMinor: 600_000 },
    saved: { amountMinor: 230_000, tone: "in", planMinor: 180_000 },
    plannedInvestMinor: 0,
    investedMinor: 0,
    savedMovedMinor: 0,
    remaining: {
      label: "Remaining budget",
      amountMinor: 100_000,
      tone: "in",
      detail: "To allocate",
      detailPopover: "Money is still unassigned. Add more planned rows to give the remaining budget a job."
    }
  });
});

test("Month lead over plan and overplanned: rose spend, over headroom, a rose Overplanned remaining budget", () => {
  const model = buildMonthLeadModel(monthCards({ plannedIncome: 0, actual: 610_000 }), { actualIncomeMinor: 0, realizedSavingsMinor: -610_000 });
  assert.equal(model.spent.tone, "short");
  assert.deepEqual(model.headroom, { amountMinor: 110_000, isOver: true, tone: "short" });
  assert.equal(model.percentOfPlan, 122);
  assert.deepEqual(model.saved, { amountMinor: -610_000, tone: "short", planMinor: 180_000 });
  assert.equal(model.remaining.amountMinor, -500_000);
  assert.equal(model.remaining.tone, "short");
  assert.equal(model.remaining.detail, "Overplanned");
});

test("Month lead waits for the cards: no lead from missing or partial cards", () => {
  assert.equal(buildMonthLeadModel([], null), null);
  assert.equal(buildMonthLeadModel(monthCards().filter((card) => card.label !== "Remaining budget"), null), null);
  assert.equal(buildMonthLeadModel(monthCards().filter((card) => card.label !== "Savings target"), null), null);
});

test("Month lead without a rollup counts no income received and savings as minus the spend", () => {
  const model = buildMonthLeadModel(monthCards(), null);
  assert.deepEqual(model.income, { amountMinor: 0, tone: "neutral", planMinor: 600_000 });
  assert.deepEqual(model.saved, { amountMinor: -420_000, tone: "short", planMinor: 180_000 });
});

const summaryMonth = {
  month: "2026-05",
  plannedIncomeMinor: 600_000,
  actualIncomeMinor: 650_000,
  estimatedExpensesMinor: 579_688,
  realExpensesMinor: 559_666,
  savingsGoalMinor: 180_000,
  realizedSavingsMinor: 90_334,
  note: "Month derived from current planning rows."
};

test("Intent card: the lead is spend against plan with the old headline variance; income chips; the table's rows as detail", () => {
  assert.deepEqual(buildIntentMonthCard(summaryMonth), {
    month: "2026-05",
    spent: { amountMinor: 559_666, tone: "neutral" },
    plannedSpendMinor: 579_688,
    percentOfPlan: 97,
    headroom: { amountMinor: 20_022, isOver: false, tone: "in" },
    progress: { valueMinor: 559_666, planMinor: 579_688 },
    plannedIncomeMinor: 600_000,
    actualIncomeMinor: 650_000,
    metrics: [
      { key: "income", plannedMinor: 600_000, actualMinor: 650_000, actualTone: "in", varianceMinor: 50_000, varianceTone: "in" },
      { key: "spend", plannedMinor: 579_688, actualMinor: 559_666, actualTone: "neutral", varianceMinor: 20_022, varianceTone: "in" },
      { key: "savings", plannedMinor: 180_000, actualMinor: 90_334, actualTone: "in", varianceMinor: -89_666, varianceTone: "short" }
    ],
    note: "Month derived from current planning rows."
  });
});

test("Intent card over plan is rose; no plan and no spend says neither under nor over", () => {
  const over = buildIntentMonthCard({ ...summaryMonth, realExpensesMinor: 693_354 });
  assert.equal(over.spent.tone, "short");
  assert.deepEqual(over.headroom, { amountMinor: 113_666, isOver: true, tone: "short" });
  const empty = buildIntentMonthCard({ ...summaryMonth, estimatedExpensesMinor: 0, realExpensesMinor: 0, note: undefined });
  assert.equal(empty.headroom, null);
  assert.equal(empty.percentOfPlan, null);
  assert.equal(empty.note, "");
  // Spending with no plan at all is over.
  const unplanned = buildIntentMonthCard({ ...summaryMonth, estimatedExpensesMinor: 0 });
  assert.equal(unplanned.percentOfPlan, null);
  assert.equal(unplanned.headroom.isOver, true);
  assert.equal(unplanned.spent.tone, "short");
});
