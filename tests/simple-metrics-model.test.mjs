import assert from "node:assert/strict";
import test from "node:test";

import { buildSimpleMetrics, elapsedDays } from "../src/client/simple-metrics-model.js";
import { buildSummaryLeadModel } from "../src/client/summary-lead-model.js";

// The Simple view's facts under the savings bar (design.md "Plan or
// Simple"): kept (or dipped into savings) with its share of income, the
// daily spend over the period's days so far, and the top three spending
// categories with their share of spending. All from the lead's own split.

function cards({ income = 650_000, spend = 470_000 } = {}) {
  return [
    { label: "Planned income", amountMinor: 0, tone: "plan" },
    { label: "Actual income", amountMinor: income, tone: "in" },
    { label: "Planned spend", amountMinor: 0, tone: "plan" },
    { label: "Actual spend", amountMinor: spend, tone: "neutral" },
    { label: "Savings target", amountMinor: 0, tone: "plan" },
    { label: "Realized savings", amountMinor: income - spend, tone: "in" }
  ];
}

const share = [
  { key: "Food", label: "Food & Drinks", valueMinor: 200_000 },
  { key: "Home", label: "Home", valueMinor: 120_000 },
  { key: "Transport", label: "Transport", valueMinor: 50_000 },
  { key: "Shopping", label: "Shopping", valueMinor: 30_000 },
  { key: "Investments", label: "Investments", valueMinor: 30_000 },
  { key: "Savings", label: "Savings", valueMinor: 40_000 }
];

test("a finished month: kept with its share of income, daily spend over all its days, top three categories", () => {
  const { figures } = buildSummaryLeadModel(cards(), { categoryShare: share });
  const metrics = buildSimpleMetrics({ figures, categoryShare: share, startMonth: "2026-05", endMonth: "2026-05", today: "2026-10-14" });
  // $4,000 of spending (the $300 to Investments and $400 to Savings were
  // moved, not spent); $300 invested; $2,200 kept of $6,500 earned.
  assert.deepEqual(metrics, {
    kept: { key: "kept", tone: "in", amountMinor: 220_000, percent: 34 },
    // $4,000 over May's 31 days.
    dailySpend: { amountMinor: 12_903, days: 31, soFar: false },
    // Shares of the $4,000 of spending; Shopping is fourth and left out.
    topCategories: [
      { name: "Food & Drinks", percent: 50 },
      { name: "Home", percent: 30 },
      { name: "Transport", percent: 13 }
    ]
  });
});

test("a period still going counts its days up to today, and says so", () => {
  const { figures } = buildSummaryLeadModel(cards(), { categoryShare: share });
  const metrics = buildSimpleMetrics({ figures, categoryShare: share, startMonth: "2026-10", endMonth: "2026-10", today: "2026-10-14" });
  assert.deepEqual(metrics.dailySpend, { amountMinor: 28_571, days: 14, soFar: true });
  // A range: Jun 2025 – Sep 2026 is 487 days.
  assert.deepEqual(elapsedDays("2025-06", "2026-09", "2026-10-14"), { count: 487, soFar: false });
  assert.deepEqual(elapsedDays("2025-06", "2026-10", "2026-10-14"), { count: 501, soFar: true });
});

test("more out than in: dipped into savings, with no share and no kept", () => {
  const { figures } = buildSummaryLeadModel(cards({ income: 300_000, spend: 420_000 }));
  const metrics = buildSimpleMetrics({ figures, categoryShare: [{ key: "Food", label: "Food & Drinks", valueMinor: 420_000 }], startMonth: "2026-04", endMonth: "2026-04", today: "2026-10-14" });
  assert.deepEqual(metrics.kept, { key: "dipped", tone: "short", amountMinor: 120_000, percent: null });
  assert.deepEqual(metrics.topCategories, [{ name: "Food & Drinks", percent: 100 }]);
  // Nothing earned at all: kept has no share either.
  const nothingEarned = buildSimpleMetrics({ figures: buildSummaryLeadModel(cards({ income: 0, spend: 5_000 })).figures, startMonth: "2026-04", endMonth: "2026-04", today: "2026-10-14" });
  assert.deepEqual(nothingEarned.kept, { key: "dipped", tone: "short", amountMinor: 5_000, percent: null });
});

test("negatives: nothing earned or spent has no facts; no spending has no daily spend and no top; a period not begun has no days", () => {
  assert.equal(buildSimpleMetrics({ figures: buildSummaryLeadModel(cards({ income: 0, spend: 0 })).figures, startMonth: "2026-05", endMonth: "2026-05", today: "2026-10-14" }), null);
  const onlyIncome = buildSimpleMetrics({ figures: buildSummaryLeadModel(cards({ income: 100_000, spend: 0 })).figures, categoryShare: [], startMonth: "2026-05", endMonth: "2026-05", today: "2026-10-14" });
  assert.deepEqual(onlyIncome, { kept: { key: "kept", tone: "in", amountMinor: 100_000, percent: 100 }, dailySpend: null, topCategories: [] });
  // Only Investments and Savings in the share: no spending category to rank.
  const movedOnly = buildSimpleMetrics({ figures: buildSummaryLeadModel(cards({ spend: 70_000 }), { categoryShare: share.slice(4) }).figures, categoryShare: share.slice(4), startMonth: "2026-05", endMonth: "2026-05", today: "2026-10-14" });
  assert.deepEqual(movedOnly.topCategories, []);
  assert.equal(movedOnly.dailySpend, null);
  assert.deepEqual(elapsedDays("2026-11", "2026-11", "2026-10-14"), { count: 0, soFar: true });
  assert.deepEqual(elapsedDays(null, "2026-11", "2026-10-14"), { count: 0, soFar: false });
});
