import assert from "node:assert/strict";
import test from "node:test";

import { buildSavingsBarModel } from "../src/client/savings-bar-model.js";

// Amounts are minor units (cents). The model reuses the lead's own figures.
const build = (figures) => buildSavingsBarModel(figures);

test("a normal saving: spent and kept share the income bar and the sentence says what was kept", () => {
  const model = build({ incomeMinor: 24_700_000, spentMinor: 20_900_000, plannedSpendMinor: 28_897_300, savingsTargetMinor: 4_130_000 });
  assert.deepEqual(model.segments.map(({ key, tone, widthPercent, hatched }) => ({ key, tone, widthPercent: Number(widthPercent.toFixed(4)), hatched: Boolean(hatched) })), [
    { key: "spent", tone: "short", widthPercent: 84.6154, hatched: false },
    { key: "kept", tone: "in", widthPercent: 15.3846, hatched: false }
  ]);
  assert.equal(model.tickPercent, null);
  assert.deepEqual(model.segments.map((segment) => segment.popover), [
    "Spent $209,000 · 85% of income",
    "Kept $38,000 · 15% of income"
  ]);
  assert.equal(model.sentence, "You kept $38,000 of the $247,000 you earned (15%)");
  assert.equal(model.plan.line, "Plan: spend $288,973 and save $41,300.");
});

test("spent plus kept always adds to 100, even when both shares round half up", () => {
  // 14.5% kept would round to 15 and 85.5% spent to 86; they must not make 101.
  const model = build({ incomeMinor: 20_000, spentMinor: 17_100 });
  assert.deepEqual(model.segments.map((segment) => segment.popover), [
    "Spent $171 · 85% of income",
    "Kept $29 · 15% of income"
  ]);
});

test("the plan bar is on the income scale, planned spend first, and is cut at the bar's end", () => {
  const fits = build({ incomeMinor: 100_000, spentMinor: 60_000, plannedSpendMinor: 70_000, savingsTargetMinor: 20_000 });
  assert.deepEqual({ spend: fits.plan.spendPercent, save: fits.plan.savePercent }, { spend: 70, save: 20 });

  // Planned spend and goal together are more than the income earned.
  const tooBig = build({ incomeMinor: 100_000, spentMinor: 60_000, plannedSpendMinor: 80_000, savingsTargetMinor: 50_000 });
  assert.deepEqual({ spend: tooBig.plan.spendPercent, save: tooBig.plan.savePercent }, { spend: 80, save: 20 });
  assert.equal(tooBig.plan.line, "Plan: spend $800 and save $500.");

  const spendAlone = build({ incomeMinor: 100_000, spentMinor: 60_000, plannedSpendMinor: 130_000, savingsTargetMinor: 50_000 });
  assert.deepEqual({ spend: spendAlone.plan.spendPercent, save: spendAlone.plan.savePercent }, { spend: 100, save: 0 });
});

test("a plan with only one half says only that half, and no plan draws no plan bar", () => {
  assert.equal(build({ incomeMinor: 100_000, spentMinor: 1, plannedSpendMinor: 50_000 }).plan.line, "Plan: spend $500.");
  assert.equal(build({ incomeMinor: 100_000, spentMinor: 1, savingsTargetMinor: 50_000 }).plan.line, "Plan: save $500.");
  assert.equal(build({ incomeMinor: 100_000, spentMinor: 1 }).plan, null);
});

test("overspent beyond income: no kept part, an income tick, and the hatched part came out of savings", () => {
  const model = build({ incomeMinor: 24_700_000, spentMinor: 30_187_100, plannedSpendMinor: 28_897_300, savingsTargetMinor: 4_130_000 });
  assert.deepEqual(model.segments.map(({ key, hatched, widthPercent }) => ({ key, hatched: Boolean(hatched), widthPercent: Number(widthPercent.toFixed(4)) })), [
    { key: "spent", hatched: false, widthPercent: 81.823 },
    { key: "savings", hatched: true, widthPercent: 18.177 }
  ]);
  assert.ok(model.segments.every((segment) => segment.tone === "short"), "all rose");
  assert.ok(!model.segments.some((segment) => segment.key === "kept"));
  assert.equal(Number(model.tickPercent.toFixed(4)), 81.823);
  assert.deepEqual(model.segments.map((segment) => segment.popover), [
    "Spent $301,871 · 122% of income",
    "Came out of savings $54,871 · 22% of income"
  ]);
  assert.equal(model.sentence, "You spent $54,871 more than you earned");
  // The plan shares the longer scale (the spending).
  assert.equal(Number(model.plan.spendPercent.toFixed(4)), 95.7273);
});

test("spending exactly the income keeps nothing and is not overspent", () => {
  const model = build({ incomeMinor: 50_000, spentMinor: 50_000 });
  assert.deepEqual(model.segments.map((segment) => [segment.key, segment.widthPercent]), [["spent", 100]]);
  assert.equal(model.tickPercent, null);
  assert.equal(model.sentence, "You kept $0 of the $500 you earned (0%)");
});

test("nothing spent keeps all of the income", () => {
  const model = build({ incomeMinor: 50_000, spentMinor: 0 });
  assert.deepEqual(model.segments.map((segment) => [segment.key, segment.widthPercent]), [["kept", 100]]);
  assert.equal(model.sentence, "You kept $500 of the $500 you earned (100%)");
});

test("zero income with spending: the whole bar is hatched, with no tick and no percent of income", () => {
  const model = build({ incomeMinor: 0, spentMinor: 12_345, plannedSpendMinor: 10_000 });
  assert.deepEqual(model.segments.map(({ key, hatched, widthPercent, popover }) => ({ key, hatched, widthPercent, popover })), [
    { key: "savings", hatched: true, widthPercent: 100, popover: "Came out of savings $123" }
  ]);
  assert.equal(model.tickPercent, null);
  assert.equal(model.sentence, "You spent $123 more than you earned");
});

test("no income and no spending, or a refund-only period, draws nothing", () => {
  assert.equal(build({ incomeMinor: 0, spentMinor: 0, plannedSpendMinor: 5_000 }), null);
  assert.equal(build({ incomeMinor: -500, spentMinor: -300 }), null);
});

test("hidden money keeps the percentages and drops every amount and every sign word", () => {
  const model = buildSavingsBarModel({ incomeMinor: 24_700_000, spentMinor: 20_900_000, plannedSpendMinor: 28_897_300, savingsTargetMinor: 4_130_000, hidden: true, formatMoney: () => { throw new Error("hidden money must not be formatted"); } });
  assert.deepEqual(model.segments.map((segment) => segment.popover), ["Spent · 85% of income", "Kept · 15% of income"]);
  assert.equal(model.sentence, "Spent and kept, as a share of what you earned");
  assert.equal(model.plan, null);

  const over = buildSavingsBarModel({ incomeMinor: 100_000, spentMinor: 125_000, hidden: true, formatMoney: () => { throw new Error("hidden money must not be formatted"); } });
  assert.deepEqual(over.segments.map((segment) => segment.popover), ["Spent · 125% of income", "Came out of savings · 25% of income"]);
  assert.equal(over.sentence, "Spent and kept, as a share of what you earned");
  assert.doesNotMatch(JSON.stringify(over), /\$|more than|kept \d/);
});
