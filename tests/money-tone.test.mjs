import assert from "node:assert/strict";
import test from "node:test";

import {
  entryAmountTone,
  entryTotalsTones,
  flowTone,
  headroomTone,
  incomeVarianceTone,
  reconciliationTone,
  signTone,
  spendTone,
  splitViewerTone,
  statementDifferenceTone
} from "../src/domain/money-tone.ts";
import { buildSummaryPage } from "../src/domain/summary-projection.ts";
import { buildMonthPage } from "../src/domain/month-projection.ts";
import { buildMonthMetricCards } from "../src/client/month-helpers.js";
import { buildEntryRowDisplay } from "../src/client/entry-row-display.js";
import { buildOptimisticExpenseActivityItem, buildOptimisticSettlementActivityItem } from "../src/client/splits-optimistic.js";
import { metricCardToneClass, moneyToneClass } from "../src/client/money-tone-class.js";

// One money-tone rule for every page (design.md, "Money colour"): money in or
// a good outcome is "in" (mint), a deficit, over plan or a debt "short"
// (rose), an intention "plan" (sky), a needed check "caution" (butter), an
// ordinary outflow "out" and transfers or zero "neutral" (both plain ink).

const tonesByLabel = (cards) => Object.fromEntries(cards.map((card) => [card.label, card.tone]));

test("tone rules: sign, flow, headroom, spend and income against a plan", () => {
  assert.equal(signTone(1), "in");
  assert.equal(signTone(0), "neutral");
  assert.equal(signTone(-1), "short");

  // A list's signed flow: spending is a plain outflow, never short.
  assert.equal(flowTone(1), "in");
  assert.equal(flowTone(0), "neutral");
  assert.equal(flowTone(-1), "out");

  // Exactly on plan (or a fully allocated budget) is a met plan.
  assert.equal(headroomTone(0), "in");
  assert.equal(headroomTone(5_000), "in");
  assert.equal(headroomTone(-1), "short");

  assert.equal(spendTone(10_000, 10_000), "neutral");
  assert.equal(spendTone(9_999, 10_000), "neutral");
  assert.equal(spendTone(10_001, 10_000), "short");
  assert.equal(spendTone(0, 0), "neutral");
  assert.equal(spendTone(1, 0), "short");

  assert.equal(incomeVarianceTone(500_000, 500_000), "in");
  assert.equal(incomeVarianceTone(500_000, 520_000), "in");
  assert.equal(incomeVarianceTone(500_000, 499_999), "short");
});

test("entries: income and refunds are money in, expenses plain, transfers neutral", () => {
  assert.equal(entryAmountTone("income", 250_000), "in");
  assert.equal(entryAmountTone("expense", -4_210), "out");
  assert.equal(entryAmountTone("expense", 1_500), "in", "a refund is money in");
  assert.equal(entryAmountTone("transfer", -80_000), "neutral");
  assert.equal(entryAmountTone("transfer", 80_000), "neutral");

  const row = (entryType, amountMinor, transferDirection) => buildEntryRowDisplay({
    id: `e-${entryType}`, date: "2026-05-02", description: "row", accountName: "UOB One", categoryName: "Groceries",
    entryType, transferDirection, ownershipType: "direct", ownerName: "Tim", amountMinor,
    splits: [{ personId: "person-tim", personName: "Tim", amountMinor, ratioBasisPoints: 10_000 }]
  }, "person-tim", false);
  assert.equal(row("expense", 4_210).amountTone, "out");
  assert.equal(row("expense", 4_210).primarySignedAmountMinor, -4_210);
  assert.equal(row("income", 500_000).amountTone, "in");
  assert.equal(row("transfer", 80_000, "out").amountTone, "neutral");

  assert.deepEqual(entryTotalsTones({ incomeMinor: 500_000, netMinor: 120_000 }), {
    spend: "out", income: "in", difference: "in", transfers: "neutral", outflow: "out"
  });
  assert.deepEqual(entryTotalsTones({ incomeMinor: 0, netMinor: -4_500 }), {
    spend: "out", income: "neutral", difference: "short", transfers: "neutral", outflow: "out"
  });
  assert.equal(entryTotalsTones({ incomeMinor: 10, netMinor: 0 }).difference, "neutral");
});

test("statements and splits: matched is in, off is short, lending is owed to you", () => {
  assert.equal(statementDifferenceTone(0), "in");
  assert.equal(statementDifferenceTone(-1), "short");
  assert.equal(statementDifferenceTone(4_280), "short");
  assert.equal(reconciliationTone("matched"), "in");
  assert.equal(reconciliationTone("mismatch"), "short");
  assert.equal(reconciliationTone("needs_checkpoint"), "caution");
  assert.equal(reconciliationTone(undefined), "neutral");

  assert.equal(splitViewerTone("expense", "person-tim", "person-tim"), "in", "you lent");
  assert.equal(splitViewerTone("expense", "person-tim", "person-joyce"), "short", "you borrowed");
  assert.equal(splitViewerTone("settlement", "person-tim", "person-tim"), "out", "you paid");
  assert.equal(splitViewerTone("settlement", "person-tim", "person-joyce"), "in", "you received");
  assert.equal(splitViewerTone("expense", "household", "person-tim"), "neutral");

  // The optimistic rows a save shows before the server answers carry the same tone.
  const people = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];
  const lent = buildOptimisticExpenseActivityItem({
    draft: { amountMinor: 6_000, payerPersonName: "Tim", description: "Dinner" }, viewId: "person-tim", people
  });
  assert.equal(lent.viewerDirectionLabel, "you lent");
  assert.equal(lent.viewerTone, "in");
  const borrowed = buildOptimisticExpenseActivityItem({
    draft: { amountMinor: 6_000, payerPersonName: "Joyce", description: "Dinner" }, viewId: "person-tim", people
  });
  assert.equal(borrowed.viewerTone, "short");
  const received = buildOptimisticSettlementActivityItem({
    draft: { amountMinor: 3_000, fromPersonName: "Joyce", toPersonName: "Tim" }, viewId: "person-tim", people
  });
  assert.equal(received.viewerDirectionLabel, "you received");
  assert.equal(received.viewerTone, "in");
});

test("a tone renders at one strength per element", () => {
  assert.equal(moneyToneClass("in"), "money-in");
  assert.equal(moneyToneClass("short", "soft"), "money-short money-soft");
  assert.equal(moneyToneClass("short", "emphasis"), "money-short money-emphasis");
  assert.equal(moneyToneClass(undefined), "money-neutral");
  // Metric cards tint outcomes and keep intentions text-only.
  assert.equal(metricCardToneClass("in"), "money-in money-soft");
  assert.equal(metricCardToneClass("plan"), "money-plan");
});

const month = (overrides) => ({
  month: "2026-05",
  plannedIncomeMinor: 0,
  actualIncomeMinor: 0,
  estimatedExpensesMinor: 0,
  realExpensesMinor: 0,
  savingsGoalMinor: 0,
  realizedSavingsMinor: 0,
  estimatedDiffMinor: 0,
  realDiffMinor: 0,
  note: "",
  ...overrides
});

const entry = (id, entryType, amountMinor) => ({
  id, date: "2026-05-10", description: id, accountName: "UOB One", categoryName: "Groceries",
  entryType, ownershipType: "direct", ownerName: "Tim", amountMinor, offsetsCategory: false,
  splits: [{ personId: "person-tim", personName: "Tim", amountMinor, ratioBasisPoints: 10_000 }]
});

function summaryCards(snapshot, entries) {
  const page = buildSummaryPage(
    "household",
    entries,
    { household: [snapshot] },
    {},
    [],
    "2026-05",
    ["2026-05"],
    ["2026-05"],
    {}
  );
  return page.metricCards;
}

test("Summary pills: intentions are plan, outcomes follow the plan", () => {
  const plan = month({ plannedIncomeMinor: 500_000, estimatedExpensesMinor: 300_000, savingsGoalMinor: 100_000 });
  const underPlan = summaryCards(plan, [entry("pay", "income", 500_000), entry("food", "expense", 200_000)]);
  assert.deepEqual(tonesByLabel(underPlan), {
    "Planned income": "plan",
    "Actual income": "in",
    "Planned spend": "plan",
    "Actual spend": "neutral",
    "Savings target": "plan",
    "Realized savings": "in"
  });
  assert.equal(underPlan.find((card) => card.label === "Realized savings").amountMinor, 300_000);

  // Exactly on plan stays neutral; one cent over turns the spend short.
  const onPlan = tonesByLabel(summaryCards(plan, [entry("pay", "income", 300_000), entry("food", "expense", 300_000)]));
  assert.equal(onPlan["Actual spend"], "neutral");
  assert.equal(onPlan["Realized savings"], "neutral", "zero savings is neither good nor bad");

  const overPlan = tonesByLabel(summaryCards(plan, [entry("pay", "income", 100_000), entry("food", "expense", 300_001)]));
  assert.equal(overPlan["Actual spend"], "short");
  assert.equal(overPlan["Realized savings"], "short");

  // No income recorded yet is not a good outcome.
  const noIncome = tonesByLabel(summaryCards(plan, []));
  assert.equal(noIncome["Actual income"], "neutral");
  assert.equal(noIncome["Actual spend"], "neutral");
});

const planRow = (label, plannedMinor, actualMinor) => ({ id: label, label, section: "budget_buckets", plannedMinor, actualMinor });

test("Month pills: remaining budget and spend gap are headroom, actual spend against plan", () => {
  const incomeRows = [{ plannedMinor: 400_000 }];
  const underPlan = buildMonthMetricCards({
    planSections: [{ rows: [planRow("Groceries", 150_000, 120_000), planRow("Savings", 100_000, 0)] }],
    incomeRows,
    currentMonthSummary: { realExpensesMinor: 120_000 }
  });
  assert.deepEqual(tonesByLabel(underPlan), {
    "Planned income": "plan",
    "Planned spend": "plan",
    "Remaining budget": "in",
    "Actual spend": "neutral",
    "Savings target": "plan",
    "Spend gap": "in"
  });

  // Fully allocated and exactly on plan: both headroom pills stay "in".
  const exact = tonesByLabel(buildMonthMetricCards({
    planSections: [{ rows: [planRow("Rent", 400_000, 400_000)] }],
    incomeRows,
    currentMonthSummary: { realExpensesMinor: 400_000 }
  }));
  assert.equal(exact["Remaining budget"], "in");
  assert.equal(exact["Spend gap"], "in");
  assert.equal(exact["Actual spend"], "neutral");

  // Overplanned and overspent.
  const overPlan = buildMonthMetricCards({
    planSections: [{ rows: [planRow("Rent", 450_000, 470_000)] }],
    incomeRows,
    currentMonthSummary: { realExpensesMinor: 470_000 }
  });
  const byLabel = Object.fromEntries(overPlan.map((card) => [card.label, card]));
  assert.equal(byLabel["Remaining budget"].amountMinor, -50_000);
  assert.equal(byLabel["Remaining budget"].tone, "short");
  assert.equal(byLabel["Remaining budget"].detail, "Overplanned");
  assert.equal(byLabel["Spend gap"].amountMinor, -20_000);
  assert.equal(byLabel["Spend gap"].tone, "short");
  assert.equal(byLabel["Actual spend"].tone, "short");
});

test("Month page DTO pills use the same tones", () => {
  const rows = [
    { id: "r1", month: "2026-05", section: "budget_buckets", label: "Groceries", categoryName: "Groceries", plannedMinor: 100_000, actualMinor: 0, ownershipType: "shared", splits: [] }
  ];
  const cards = (spendMinor) => buildMonthPage(
    "household", "direct_plus_shared", [], [], rows, [], "2026-05",
    month({ realExpensesMinor: spendMinor })
  ).metricCards;

  assert.deepEqual(tonesByLabel(cards(100_000)), {
    "Planned spend": "plan",
    "Actual spend": "neutral",
    "Variance": "in",
    "Savings target": "plan"
  });
  const over = tonesByLabel(cards(100_001));
  assert.equal(over["Actual spend"], "short");
  assert.equal(over.Variance, "short");
});
