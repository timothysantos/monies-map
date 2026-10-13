import assert from "node:assert/strict";
import test from "node:test";

import { buildSummaryLeadModel, formatSummaryLeadRange } from "../src/client/summary-lead-model.js";

// The Summary page DTO's six metric cards (summary-projection.ts), in order.
function cards({ plannedIncome = 11_070_000, actualIncome = 11_070_000, plannedSpend = 3_780_752, actualSpend = 2_277_767, savingsTarget = 1_800_000, realizedSavings = 8_792_233 } = {}) {
  return [
    { label: "Planned income", amountMinor: plannedIncome, tone: "plan" },
    { label: "Actual income", amountMinor: actualIncome, tone: actualIncome > 0 ? "in" : "neutral" },
    { label: "Planned spend", amountMinor: plannedSpend, tone: "plan" },
    { label: "Actual spend", amountMinor: actualSpend, tone: actualSpend > plannedSpend ? "short" : "neutral" },
    { label: "Savings target", amountMinor: savingsTarget, tone: "plan" },
    { label: "Realized savings", amountMinor: realizedSavings, tone: realizedSavings > 0 ? "in" : realizedSavings < 0 ? "short" : "neutral" }
  ];
}

// The showcase's Ethan over Oct 2025 – Sep 2026 (the guide's summary-person
// shot): $22,777.67 spent; $37,807.52 planned, of which $18,000 is the
// savings target. The old lead said "$15,029.85 under plan" beside the spend
// job's "over by $2,970". Measured against the spend plan only, both say over.
test("the lead measures spending against the spend plan, so it agrees with the spend job", () => {
  assert.deepEqual(buildSummaryLeadModel(cards()), {
    spent: { amountMinor: 2_277_767, tone: "short" },
    plannedSpendMinor: 1_980_752,
    percentOfPlan: 115,
    headroom: { amountMinor: 297_015, isOver: true, tone: "short" },
    income: { amountMinor: 11_070_000, tone: "in", planMinor: 11_070_000 },
    saved: { amountMinor: 8_792_233, tone: "in", planMinor: 1_800_000 },
    // No "Planned investments" card and no category share: nothing invested or moved.
    figures: {
      income: 11_070_000,
      spending: 2_277_767,
      invested: 0,
      takenFromInvestments: 0,
      movedToSavings: 0,
      kept: 8_792_233,
      spendPlan: 1_980_752,
      savePlan: 1_800_000,
      investPlan: 0
    }
  });
});

test("money moved to Investments or Savings is not spend: the headline, its plan and Saved all follow the split", () => {
  const model = buildSummaryLeadModel([
    ...cards({ actualSpend: 2_577_767, realizedSavings: 8_492_233 }),
    { label: "Planned investments", amountMinor: 150_000, tone: "plan" }
  ], {
    categoryShare: [
      { key: "Food", label: "Food", valueMinor: 2_157_767 },
      { key: "Investments", label: "Investments", valueMinor: 120_000 },
      { key: "Savings", label: "Savings", valueMinor: 300_000 }
    ]
  });
  // Spending $21,577.67 against a spend plan of $37,807.52 - $18,000 - $1,500.
  assert.deepEqual(model.spent, { amountMinor: 2_157_767, tone: "short" });
  assert.equal(model.plannedSpendMinor, 1_830_752);
  assert.deepEqual(model.headroom, { amountMinor: 327_015, isOver: true, tone: "short" });
  // Saved is the bar's kept: the $3,000 moved to Savings is saved, not spent
  // (realized savings, $84,922.33, still counts it as spend).
  assert.deepEqual(model.saved, { amountMinor: 8_792_233, tone: "in", planMinor: 1_800_000 });
  assert.equal(model.saved.amountMinor, model.figures.kept);
  assert.equal(model.figures.invested, 120_000);
});

test("over plan the spend keeps its rose tone and the headroom says over, in rose", () => {
  const model = buildSummaryLeadModel(cards({ actualIncome: 120_000, plannedSpend: 100_000, savingsTarget: 0, actualSpend: 125_050, realizedSavings: -5_050 }));
  assert.equal(model.spent.tone, "short");
  assert.equal(model.percentOfPlan, 125);
  assert.deepEqual(model.headroom, { amountMinor: 25_050, isOver: true, tone: "short" });
  assert.equal(model.saved.tone, "short");
});

test("exactly on plan is a met plan (mint), with no plan there is no percent", () => {
  assert.deepEqual(buildSummaryLeadModel(cards({ plannedSpend: 50_000, savingsTarget: 0, actualSpend: 50_000 })).headroom, { amountMinor: 0, isOver: false, tone: "in" });

  // A plan that is only the savings target is no spend plan.
  const onlySavings = buildSummaryLeadModel(cards({ plannedSpend: 1_800_000, actualSpend: 1_500 }));
  assert.equal(onlySavings.plannedSpendMinor, 0);
  assert.equal(onlySavings.percentOfPlan, null);

  const noPlan = buildSummaryLeadModel(cards({ plannedSpend: 0, savingsTarget: 0, actualSpend: 1_500 }));
  assert.equal(noPlan.percentOfPlan, null);
  // Spending with no plan is over plan, as spendTone says.
  assert.deepEqual(noPlan.headroom, { amountMinor: 1_500, isOver: true, tone: "short" });

  const empty = buildSummaryLeadModel(cards({ plannedSpend: 0, savingsTarget: 0, actualSpend: 0 }));
  assert.equal(empty.percentOfPlan, null);
  assert.equal(empty.headroom, null);
});

test("a page without the six cards (still loading, or renamed) has no lead", () => {
  assert.equal(buildSummaryLeadModel([]), null);
  assert.equal(buildSummaryLeadModel(cards().filter((card) => card.label !== "Savings target")), null);
  assert.equal(buildSummaryLeadModel(cards().map((card) => card.label === "Actual spend" ? { ...card, amountMinor: undefined } : card)), null);
});

test("the range reads as one month or first – last", () => {
  assert.equal(formatSummaryLeadRange("2025-10", "2026-09"), "Oct 2025 – Sep 2026");
  assert.equal(formatSummaryLeadRange("2026-05", "2026-05"), "May 2026");
  assert.equal(formatSummaryLeadRange("", ""), "");
});
