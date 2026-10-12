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

test("the lead and its pills carry exactly the metric cards' figures and tones", () => {
  assert.deepEqual(buildSummaryLeadModel(cards()), {
    spent: { amountMinor: 2_277_767, tone: "neutral" },
    plannedSpendMinor: 3_780_752,
    percentOfPlan: 60,
    headroom: { amountMinor: 1_502_985, isOver: false, tone: "in" },
    progress: { valueMinor: 2_277_767, planMinor: 3_780_752 },
    income: { amountMinor: 11_070_000, tone: "in", planMinor: 11_070_000 },
    saved: { amountMinor: 8_792_233, tone: "in", planMinor: 1_800_000 }
  });
});

test("over plan the spend keeps its rose tone and the headroom says over, in rose", () => {
  const model = buildSummaryLeadModel(cards({ plannedSpend: 100_000, actualSpend: 125_050, realizedSavings: -5_000 }));
  assert.equal(model.spent.tone, "short");
  assert.equal(model.percentOfPlan, 125);
  assert.deepEqual(model.headroom, { amountMinor: 25_050, isOver: true, tone: "short" });
  assert.equal(model.saved.tone, "short");
});

test("exactly on plan is a met plan (mint), with no plan there is no percent", () => {
  assert.deepEqual(buildSummaryLeadModel(cards({ plannedSpend: 50_000, actualSpend: 50_000 })).headroom, { amountMinor: 0, isOver: false, tone: "in" });

  const noPlan = buildSummaryLeadModel(cards({ plannedSpend: 0, actualSpend: 1_500 }));
  assert.equal(noPlan.percentOfPlan, null);
  // Spending with no plan is over plan, as spendTone says.
  assert.deepEqual(noPlan.headroom, { amountMinor: 1_500, isOver: true, tone: "short" });

  const empty = buildSummaryLeadModel(cards({ plannedSpend: 0, actualSpend: 0 }));
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
